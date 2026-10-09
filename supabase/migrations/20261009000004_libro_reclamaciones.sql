-- Libro de Reclamaciones virtual (Ley 29571, Código de Protección y Defensa del
-- Consumidor; D.S. 011-2011-PCM y D.S. 101-2022-PCM, supervisa INDECOPI).
--
-- POR QUÉ así:
--  * Es el libro DEL NEGOCIO, dentro de la propia web: no hay API de terceros que lo
--    ofrezca; es una tabla propia + un formulario. Un visitante (sin sesión) debe poder
--    presentar un reclamo, así que `anon` recibe EXECUTE sobre una única función y
--    NINGÚN privilegio sobre la tabla.
--  * El registro es inmutable para quien lo presentó y para el personal: no hay
--    UPDATE ni DELETE concedidos a nadie. Lo único que cambia con el tiempo es la
--    respuesta del proveedor, y solo vía `responder_reclamo()` (solo administración).
--  * La hoja de reclamación exige los datos del proveedor (razón social, RUC y
--    domicilio del establecimiento). El domicilio ya existe (`estado_negocio.direccion`);
--    se agregan razón social y RUC, sin sembrar ningún valor: los carga el administrador.
--  * El plazo de respuesta es de 15 días hábiles (prorrogable por otros 15). Aquí se
--    calcula omitiendo sábados y domingos; los feriados NO se descuentan, así que la
--    fecha mostrada es siempre igual o anterior a la legal (nunca engaña a favor del
--    negocio).
--  * Anti-abuso básico: tope por documento y por hora, y límites de longitud. El
--    formulario web suma un campo trampa (honeypot).

begin;

-- 1. Datos del proveedor ----------------------------------------------------------

alter table public.estado_negocio
  add column if not exists razon_social text,
  add column if not exists ruc          text;

alter table public.estado_negocio
  drop constraint if exists estado_negocio_ruc_formato;
alter table public.estado_negocio
  add constraint estado_negocio_ruc_formato check (ruc is null or ruc ~ '^[0-9]{11}$');

create or replace function public.datos_proveedor_reclamos()
returns table (razon_social text, ruc text, direccion text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select razon_social, ruc, direccion
  from public.estado_negocio
  where id = 1;
$$;

revoke execute on function public.datos_proveedor_reclamos() from public;
grant execute on function public.datos_proveedor_reclamos() to anon, authenticated;

-- 2. Tabla del libro --------------------------------------------------------------

create table if not exists public.libro_reclamaciones (
  id                  uuid primary key default gen_random_uuid(),
  numero              bigint generated always as identity,
  codigo              text not null unique,
  creado_en           timestamptz not null default now(),
  fecha_limite        date not null,
  cliente_user_id     uuid references auth.users (id) on delete set null,

  -- Consumidor
  nombre              text not null,
  tipo_documento      text not null check (tipo_documento in ('DNI', 'CE', 'PASAPORTE')),
  numero_documento    text not null,
  domicilio           text not null,
  telefono            text,
  email               text not null,
  menor_de_edad       boolean not null default false,
  apoderado_nombre    text,

  -- Bien contratado
  bien_tipo           text not null check (bien_tipo in ('PRODUCTO', 'SERVICIO')),
  bien_descripcion    text not null,
  monto_reclamado     numeric(10, 2) check (monto_reclamado is null or monto_reclamado >= 0),

  -- Detalle
  tipo                text not null check (tipo in ('RECLAMO', 'QUEJA')),
  detalle             text not null,
  pedido              text not null,

  -- Atención del proveedor
  estado              text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ATENDIDO')),
  respuesta           text,
  respondido_en       timestamptz,
  respondido_por      uuid references auth.users (id) on delete set null
);

create index if not exists libro_reclamaciones_creado_idx
  on public.libro_reclamaciones (creado_en desc);
create index if not exists libro_reclamaciones_documento_idx
  on public.libro_reclamaciones (numero_documento, creado_en desc);

alter table public.libro_reclamaciones enable row level security;

revoke all on public.libro_reclamaciones from anon, authenticated;
grant select on public.libro_reclamaciones to authenticated;

drop policy if exists libro_reclamaciones_select_admin on public.libro_reclamaciones;
create policy libro_reclamaciones_select_admin on public.libro_reclamaciones
  for select to authenticated
  using (public.es_admin());

-- 3. Presentar un reclamo (visitante o clienta) -------------------------------------

create or replace function public.sumar_dias_habiles(p_desde date, p_dias integer)
returns date
language plpgsql
immutable
as $$
declare
  v_fecha date := p_desde;
  v_resto integer := p_dias;
begin
  while v_resto > 0 loop
    v_fecha := v_fecha + 1;
    if extract(isodow from v_fecha) < 6 then
      v_resto := v_resto - 1;
    end if;
  end loop;
  return v_fecha;
end;
$$;

create or replace function public.registrar_reclamo(p_datos jsonb)
returns table (codigo text, creado_en timestamptz, fecha_limite date)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre     text := btrim(coalesce(p_datos ->> 'nombre', ''));
  v_tipo_doc   text := upper(btrim(coalesce(p_datos ->> 'tipo_documento', '')));
  v_num_doc    text := upper(btrim(coalesce(p_datos ->> 'numero_documento', '')));
  v_domicilio  text := btrim(coalesce(p_datos ->> 'domicilio', ''));
  v_telefono   text := nullif(btrim(coalesce(p_datos ->> 'telefono', '')), '');
  v_email      text := lower(btrim(coalesce(p_datos ->> 'email', '')));
  v_menor      boolean := coalesce((p_datos ->> 'menor_de_edad')::boolean, false);
  v_apoderado  text := nullif(btrim(coalesce(p_datos ->> 'apoderado_nombre', '')), '');
  v_bien_tipo  text := upper(btrim(coalesce(p_datos ->> 'bien_tipo', '')));
  v_bien_desc  text := btrim(coalesce(p_datos ->> 'bien_descripcion', ''));
  v_monto      numeric(10, 2) := nullif(btrim(coalesce(p_datos ->> 'monto_reclamado', '')), '')::numeric;
  v_tipo       text := upper(btrim(coalesce(p_datos ->> 'tipo', '')));
  v_detalle    text := btrim(coalesce(p_datos ->> 'detalle', ''));
  v_pedido     text := btrim(coalesce(p_datos ->> 'pedido', ''));
  v_conforme   boolean := coalesce((p_datos ->> 'conformidad')::boolean, false);
  v_hoy        date := (now() at time zone 'America/Lima')::date;
  v_limite     date;
  v_numero     bigint;
  v_codigo     text;
  v_creado     timestamptz;
begin
  if not v_conforme then
    raise exception 'Debes confirmar la veracidad de la información.' using errcode = '22023';
  end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then
    raise exception 'Ingresa tu nombre completo.' using errcode = '22023';
  end if;
  if v_tipo_doc not in ('DNI', 'CE', 'PASAPORTE') then
    raise exception 'Tipo de documento no válido.' using errcode = '22023';
  end if;
  if (v_tipo_doc = 'DNI' and v_num_doc !~ '^[0-9]{8}$')
     or (v_tipo_doc <> 'DNI' and v_num_doc !~ '^[A-Z0-9]{6,20}$') then
    raise exception 'El número de documento no es válido.' using errcode = '22023';
  end if;
  if length(v_domicilio) < 5 or length(v_domicilio) > 200 then
    raise exception 'Ingresa tu domicilio.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then
    raise exception 'Ingresa un correo electrónico válido.' using errcode = '22023';
  end if;
  if v_telefono is not null and v_telefono !~ '^[0-9+() -]{6,20}$' then
    raise exception 'El teléfono no es válido.' using errcode = '22023';
  end if;
  if v_menor and (v_apoderado is null or length(v_apoderado) < 3) then
    raise exception 'Si eres menor de edad, indica el nombre de tu padre, madre o tutor.'
      using errcode = '22023';
  end if;
  if v_bien_tipo not in ('PRODUCTO', 'SERVICIO') then
    raise exception 'Indica si se trata de un producto o un servicio.' using errcode = '22023';
  end if;
  if length(v_bien_desc) < 3 or length(v_bien_desc) > 200 then
    raise exception 'Describe el producto o servicio.' using errcode = '22023';
  end if;
  if v_monto is not null and (v_monto < 0 or v_monto > 1000000) then
    raise exception 'El monto reclamado no es válido.' using errcode = '22023';
  end if;
  if v_tipo not in ('RECLAMO', 'QUEJA') then
    raise exception 'Elige si es un reclamo o una queja.' using errcode = '22023';
  end if;
  if length(v_detalle) < 10 or length(v_detalle) > 2000 then
    raise exception 'Cuéntanos el detalle (entre 10 y 2000 caracteres).' using errcode = '22023';
  end if;
  if length(v_pedido) < 5 or length(v_pedido) > 1000 then
    raise exception 'Indica qué solicitas (entre 5 y 1000 caracteres).' using errcode = '22023';
  end if;

  -- Tope por documento (spam/doble envío): 5 por hora.
  if (
    select count(*) from public.libro_reclamaciones l
    where l.numero_documento = v_num_doc and l.creado_en > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Ya registraste varios reclamos en la última hora. Intenta más tarde.'
      using errcode = '54000';
  end if;

  v_limite := public.sumar_dias_habiles(v_hoy, 15);
  v_creado := now();

  insert into public.libro_reclamaciones (
    codigo, creado_en, fecha_limite, cliente_user_id,
    nombre, tipo_documento, numero_documento, domicilio, telefono, email,
    menor_de_edad, apoderado_nombre,
    bien_tipo, bien_descripcion, monto_reclamado, tipo, detalle, pedido
  ) values (
    'PENDIENTE-' || gen_random_uuid()::text, v_creado, v_limite, auth.uid(),
    v_nombre, v_tipo_doc, v_num_doc, v_domicilio, v_telefono, v_email,
    v_menor, case when v_menor then v_apoderado else null end,
    v_bien_tipo, v_bien_desc, v_monto, v_tipo, v_detalle, v_pedido
  )
  returning numero into v_numero;

  v_codigo := 'LR-' || lpad(v_numero::text, 6, '0') || '-'
              || extract(year from (v_creado at time zone 'America/Lima'))::int;

  update public.libro_reclamaciones l set codigo = v_codigo where l.numero = v_numero;

  return query select v_codigo, v_creado, v_limite;
end;
$$;

revoke execute on function public.registrar_reclamo(jsonb) from public;
grant execute on function public.registrar_reclamo(jsonb) to anon, authenticated;

-- 4. Responder (solo administración) ------------------------------------------------

create or replace function public.responder_reclamo(p_id uuid, p_respuesta text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_respuesta text := btrim(coalesce(p_respuesta, ''));
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if length(v_respuesta) < 5 or length(v_respuesta) > 3000 then
    raise exception 'La respuesta debe tener entre 5 y 3000 caracteres.' using errcode = '22023';
  end if;

  update public.libro_reclamaciones
  set estado = 'ATENDIDO', respuesta = v_respuesta, respondido_en = now(), respondido_por = auth.uid()
  where id = p_id and estado = 'PENDIENTE';

  if not found then
    raise exception 'El reclamo no existe o ya fue atendido.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.responder_reclamo(uuid, text) from public;
grant execute on function public.responder_reclamo(uuid, text) to authenticated;

commit;
