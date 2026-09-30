-- =========================================================
-- POS Negocio 2 — Pestaña Web: pago obligatorio (adelanto) al agendar
-- una cita desde /citas/carrito
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 75_citas_web.sql, 82_citas_adelanto.sql y
-- 115_estado_negocio_adelanto.sql ya se hayan corrido.
--
-- Parte del rediseño "Carrito de servicios"
-- (docs/diseno-carrito-servicios/README.md). Decisiones confirmadas con
-- el usuario (AskUserQuestion):
-- - El adelanto es SIEMPRE obligatorio. El monto exigido es
--   estado_negocio.adelanto_minimo; si el negocio no lo configuró
--   (null), se exige el 100% (el total de los servicios elegidos).
-- - Sin cupones todavía (queda para una tarea aparte).
-- - Sin "cualquier asistente disponible" — se sigue eligiendo uno
--   específico, igual que hoy.
--
-- Mismo patrón que pedidos_web (100_pedidos_web_pago.sql): se guarda la
-- INTENCIÓN de pago (comprobante subido, sin verificar) — la cita entra
-- como PENDIENTE igual que siempre; verificar el comprobante y mostrar
-- un botón "Verificar pago" en el POS queda fuera de esta tarea (no fue
-- pedido), pero las columnas ya quedan listas para esa función futura.
--
-- agendar_cita_web(uuid, timestamptz, uuid[], text) cambia de firma —
-- se DROPea esa versión de 4 parámetros: su único llamador,
-- ModalAgendarCitaCliente.jsx, se borra en este mismo cambio (el nuevo
-- carrito de servicios lo reemplaza).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Bucket privado para comprobantes de adelanto de citas — mismo
-- criterio que comprobantes-pedidos-web: solo la propia clienta y el
-- personal pueden leerlo.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprobantes-citas-web', 'comprobantes-citas-web', false)
on conflict (id) do nothing;

create policy comprobantes_citas_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes-citas-web'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy comprobantes_citas_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes-citas-web'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin())
  );

-- ---------------------------------------------------------
-- 2. Columnas nuevas en citas — tabla que YA da SELECT/INSERT/UPDATE a
-- nivel de tabla completa a `authenticated` (no es como productos, que
-- da por columna), así que ALTER TABLE ADD COLUMN no necesita ningún
-- GRANT extra acá.
-- ---------------------------------------------------------
alter table public.citas
  add column if not exists metodo_pago text
    check (metodo_pago in ('YAPE', 'PLIN', 'TRANSFERENCIA')),
  add column if not exists comprobante_url text,
  add column if not exists pago_verificado boolean not null default false,
  add column if not exists pago_verificado_en timestamptz,
  add column if not exists pago_verificado_por uuid references public.usuarios (id);

-- ---------------------------------------------------------
-- 3. agendar_cita_web — ahora exige método de pago + comprobante +
-- adelanto (mismas validaciones de siempre, más las nuevas).
-- ---------------------------------------------------------
drop function if exists public.agendar_cita_web(uuid, timestamptz, uuid[], text);

create or replace function public.agendar_cita_web(
  p_asistente_id    uuid,
  p_fecha_hora      timestamptz,
  p_servicio_ids    uuid[],
  p_metodo_pago     text,
  p_comprobante_url text,
  p_adelanto        numeric,
  p_nota            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id      uuid;
  v_cita_id         uuid;
  v_duracion_total  int;
  v_precio_total    numeric(10, 2);
  v_adelanto_minimo numeric(10, 2);
  v_minimo_exigido  numeric(10, 2);
  v_disponible      boolean;
  v_servicio_id     uuid;
  v_duracion        int;
  v_precio          numeric;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de agendar una cita';
  end if;

  if p_servicio_ids is null or array_length(p_servicio_ids, 1) is null then
    raise exception 'Elige al menos un servicio';
  end if;

  if not exists (
    select 1 from public.asistentes a
    where a.id = p_asistente_id
      and a.activo = true
      and (
        a.usuario_id is null
        or exists (select 1 from public.usuarios u where u.id = a.usuario_id and u.rol <> 'CAJERA')
      )
  ) then
    raise exception 'Ese asistente no está disponible';
  end if;

  if p_fecha_hora is null or p_fecha_hora <= now() then
    raise exception 'La fecha debe ser futura';
  end if;

  select coalesce(sum(duracion_min), 0), coalesce(sum(precio), 0)
    into v_duracion_total, v_precio_total
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_duracion_total = 0 then
    raise exception 'Servicio inválido';
  end if;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      p_asistente_id, (p_fecha_hora at time zone 'America/Lima')::date, v_duracion_total
    ) h
    where h.inicio = p_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  if p_metodo_pago not in ('YAPE', 'PLIN', 'TRANSFERENCIA') then
    raise exception 'Método de pago inválido.';
  end if;

  if p_comprobante_url is null or btrim(p_comprobante_url) = '' then
    raise exception 'Sube la captura de tu adelanto para confirmar la reserva.';
  end if;

  select adelanto_minimo into v_adelanto_minimo from public.estado_negocio where id = 1;
  v_minimo_exigido := coalesce(v_adelanto_minimo, v_precio_total);

  if p_adelanto is null or p_adelanto < v_minimo_exigido then
    raise exception 'El adelanto debe ser de al menos S/ %.', v_minimo_exigido;
  end if;

  insert into public.citas (
    cliente_id, asistente_id, creado_por, creado_por_cliente_web_id, fecha_hora, nota, estado,
    metodo_pago, comprobante_url, adelanto
  )
  values (
    v_cliente_id, p_asistente_id, null, auth.uid(), p_fecha_hora, p_nota, 'PENDIENTE',
    p_metodo_pago, p_comprobante_url, p_adelanto
  )
  returning id into v_cita_id;

  foreach v_servicio_id in array p_servicio_ids loop
    select duracion_min, precio into v_duracion, v_precio
    from public.servicios
    where id = v_servicio_id and activo = true;

    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (v_cita_id, v_servicio_id, coalesce(v_duracion, 30), v_precio);
  end loop;

  return v_cita_id;
end;
$$;

grant execute on function public.agendar_cita_web(uuid, timestamptz, uuid[], text, text, numeric, text) to authenticated;
revoke execute on function public.agendar_cita_web(uuid, timestamptz, uuid[], text, text, numeric, text) from public;

commit;
