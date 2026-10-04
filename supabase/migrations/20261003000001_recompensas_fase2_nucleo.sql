-- =========================================================
-- Recompensas — Fase 2, núcleo: libro de monedas/sellos, acreditación al
-- confirmar la venta, protección de costo por servicio, canje atómico e
-- idempotente y reversión por anulación.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Qué NO hace (a propósito):
--  * NO ejecuta ni define la transición ×5 de saldos antiguos. Eso exige
--    presentar antes la atribución exacta (ver recompensas_apertura_aportes,
--    tabla vacía que solo la transición poblará).
--  * NO cambia comisiones ni pagos a asistentes (ingreso_servicios_y_
--    comisiones sigue intacto). La protección de costo es un dato aparte.
--  * NO crea catálogo de ejemplo: recompensas_catalogo nace vacío.
--  * NO se activa sola: recompensas_config.activo = false. Mientras esté
--    apagado, confirmar_venta/anular_venta se comportan como antes (salvo
--    las validaciones nuevas del cupón, que son más estrictas pero con
--    defaults compatibles para los cupones ya emitidos).
--
-- Fuente canónica de configuración: recompensas_config (tasas, umbrales,
-- sellos). config_puntos y config_fidelizacion quedan SOLO como respaldo
-- histórico de la fórmula antigua y de la transición; ningún lector nuevo
-- debe consultarlas.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Configuración (fila única)
-- ---------------------------------------------------------
create table public.recompensas_config (
  id                 int primary key default 1,
  activo             boolean not null default false,
  corte              timestamptz,
  tasa_serv_monedas  numeric(12, 4) not null default 5  check (tasa_serv_monedas > 0),
  tasa_serv_soles    numeric(12, 4) not null default 20 check (tasa_serv_soles > 0),
  tasa_prod_monedas  numeric(12, 4) not null default 5  check (tasa_prod_monedas > 0),
  tasa_prod_soles    numeric(12, 4) not null default 40 check (tasa_prod_soles > 0),
  umbral_premium     numeric(14, 4) not null default 50  check (umbral_premium > 0),
  umbral_vip         numeric(14, 4) not null default 150,
  sellos_max         int not null default 20 check (sellos_max >= 1),
  sellos_por_premio  int not null default 5  check (sellos_por_premio >= 1),
  actualizado_en     timestamptz not null default now(),
  constraint recompensas_config_singleton check (id = 1),
  constraint recompensas_config_umbrales check (umbral_vip > umbral_premium)
);
insert into public.recompensas_config (id) values (1);

alter table public.recompensas_config enable row level security;
revoke all on public.recompensas_config from anon, authenticated;
grant select on public.recompensas_config to authenticated;
-- activo y corte NO se editan directo: solo por recompensas_establecer_activo().
grant update (tasa_serv_monedas, tasa_serv_soles, tasa_prod_monedas, tasa_prod_soles,
              umbral_premium, umbral_vip, sellos_max, sellos_por_premio, actualizado_en)
  on public.recompensas_config to authenticated;

create policy recompensas_config_select on public.recompensas_config
  for select to authenticated using (true);
create policy recompensas_config_update_admin on public.recompensas_config
  for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------
-- 2. Libros de movimientos (solo se escriben desde funciones del servidor)
-- ---------------------------------------------------------
create table public.recompensas_movimientos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes (id),
  tipo          text not null check (tipo in ('APERTURA', 'VENTA', 'VENTA_REVERSION', 'CANJE', 'AJUSTE')),
  monedas       numeric(18, 8) not null,           -- delta del saldo gastable
  clasificacion numeric(18, 8) not null default 0, -- delta de la clasificación acumulada
  venta_id      uuid references public.ventas (id),
  canje_id      uuid,
  clave         text not null unique,              -- idempotencia: una vez por (operación, efecto)
  detalle       jsonb,
  creado_en     timestamptz not null default now()
);
create index recompensas_movimientos_cliente_idx on public.recompensas_movimientos (cliente_id, creado_en);
create index recompensas_movimientos_venta_idx on public.recompensas_movimientos (venta_id);

create table public.recompensas_sellos_movs (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  tipo       text not null check (tipo in ('APERTURA', 'SELLO', 'SELLO_RETIRO', 'CANJE_SELLOS')),
  delta      int not null,
  dia        date,                                 -- día de Lima del sello
  venta_id   uuid references public.ventas (id),
  canje_id   uuid,
  clave      text not null unique,
  detalle    jsonb,
  creado_en  timestamptz not null default now()
);
create index recompensas_sellos_cliente_idx on public.recompensas_sellos_movs (cliente_id, creado_en);
create index recompensas_sellos_dia_idx on public.recompensas_sellos_movs (cliente_id, dia);

-- Mapa de aportes históricos incluidos en el saldo de apertura. Lo puebla
-- SOLO la transición (aún no definida). Permite que confirmar_venta omita
-- exactamente el aporte ya contado de una atención anterior al corte.
create table public.recompensas_apertura_aportes (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references public.clientes (id),
  origen               text not null,   -- ATENCION | VISITA_DIA | BONO_MANUAL | REDONDEO
  registro_servicio_id uuid references public.registro_servicios (id),
  dia                  date,
  puntos_antiguos      numeric(18, 8) not null,
  monedas              numeric(18, 8) not null,
  creado_en            timestamptz not null default now()
);
create unique index recompensas_apertura_aportes_atencion_uq
  on public.recompensas_apertura_aportes (registro_servicio_id) where registro_servicio_id is not null;

alter table public.recompensas_movimientos enable row level security;
alter table public.recompensas_sellos_movs enable row level security;
alter table public.recompensas_apertura_aportes enable row level security;
revoke all on public.recompensas_movimientos, public.recompensas_sellos_movs,
  public.recompensas_apertura_aportes from anon, authenticated;
grant select on public.recompensas_movimientos, public.recompensas_sellos_movs,
  public.recompensas_apertura_aportes to authenticated;

create policy recompensas_mov_select on public.recompensas_movimientos
  for select to authenticated using (cliente_id = public.mi_cliente_id() or public.es_admin());
create policy recompensas_sellos_select on public.recompensas_sellos_movs
  for select to authenticated using (cliente_id = public.mi_cliente_id() or public.es_admin());
create policy recompensas_apertura_select on public.recompensas_apertura_aportes
  for select to authenticated using (public.es_admin());

-- ---------------------------------------------------------
-- 3. Protección del costo por servicio (solo ADMINISTRADOR lee/escribe)
--    Fila presente = protección configurada explícitamente (ceros incluidos).
--    Sin fila = SIN CONFIGURAR (nunca se trata como costo cero).
-- ---------------------------------------------------------
create table public.servicios_proteccion (
  servicio_id    uuid primary key references public.servicios (id) on delete cascade,
  materiales     numeric(10, 2) not null default 0 check (materiales >= 0),
  asistente      numeric(10, 2) not null default 0 check (asistente >= 0),
  otros          numeric(10, 2) not null default 0 check (otros >= 0),
  total          numeric(10, 2) generated always as (materiales + asistente + otros) stored,
  actualizado_en timestamptz not null default now()
);
alter table public.servicios_proteccion enable row level security;
revoke all on public.servicios_proteccion from anon, authenticated;
grant select, insert, update, delete on public.servicios_proteccion to authenticated;
create policy servicios_proteccion_admin on public.servicios_proteccion
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Caja consulta (no edita): solo personal. La clienta nunca llama esto.
create or replace function public.proteccion_servicios_estado(p_servicio_ids uuid[])
returns table (servicio_id uuid, configurada boolean, piso numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id, (sp.servicio_id is not null), sp.total
  from public.servicios s
  left join public.servicios_proteccion sp on sp.servicio_id = s.id
  where public.rol_actual() is not null
    and s.id = any (p_servicio_ids);
$$;
revoke execute on function public.proteccion_servicios_estado(uuid[]) from public, anon;
grant execute on function public.proteccion_servicios_estado(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- 4. Catálogo (premios por monedas y por sellos) y canjes
-- ---------------------------------------------------------
create table public.recompensas_catalogo (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null check (btrim(nombre) <> ''),
  descripcion          text,
  activo               boolean not null default false,       -- nace apagado: requiere revisión
  origen               text not null check (origen in ('MONEDAS', 'SELLOS')),
  tipo                 text not null check (tipo in ('MONTO', 'PORCENTAJE', 'SERVICIO')),
  valor                numeric(10, 2) not null default 0 check (valor >= 0),
  servicio_id          uuid references public.servicios (id),
  alcance              text not null default 'TODO' check (alcance in ('TODO', 'SERVICIOS', 'PRODUCTOS')),
  minimo_compra        numeric(10, 2) check (minimo_compra is null or minimo_compra >= 0),
  tope                 numeric(10, 2) check (tope is null or tope >= 0),
  nivel_minimo         text not null default 'BASICO' check (nivel_minimo in ('BASICO', 'PREMIUM', 'VIP')),
  costo_basico         numeric(18, 4) check (costo_basico is null or costo_basico >= 0),
  costo_premium        numeric(18, 4) check (costo_premium is null or costo_premium >= 0),
  costo_vip            numeric(18, 4) check (costo_vip is null or costo_vip >= 0),
  cupo_global          int check (cupo_global is null or cupo_global >= 0),
  limite_por_clienta   int check (limite_por_clienta is null or limite_por_clienta >= 0),
  reclamo_desde        timestamptz,
  reclamo_hasta        timestamptz,
  cupon_vigencia_dias  int check (cupon_vigencia_dias is null or cupon_vigencia_dias > 0),
  cupon_vence_el       timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint recompensas_catalogo_servicio check (tipo <> 'SERVICIO' or servicio_id is not null),
  constraint recompensas_catalogo_pct check (tipo <> 'PORCENTAJE' or valor <= 100),
  constraint recompensas_catalogo_costo check (origen = 'SELLOS' or costo_basico is not null)
);
alter table public.recompensas_catalogo enable row level security;
revoke all on public.recompensas_catalogo from anon, authenticated;
grant select, insert, update, delete on public.recompensas_catalogo to authenticated;
create policy recompensas_catalogo_admin on public.recompensas_catalogo
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create table public.recompensas_canjes (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes (id),
  catalogo_id    uuid not null references public.recompensas_catalogo (id),
  clave_idem     text not null,
  origen         text not null,
  costo          numeric(18, 4) not null,   -- monedas o sellos, según origen (aplicado, no editable)
  nivel_aplicado text not null,
  cupon_id       uuid not null references public.cupones (id),
  creado_en      timestamptz not null default now(),
  unique (cliente_id, clave_idem)
);
create index recompensas_canjes_catalogo_idx on public.recompensas_canjes (catalogo_id);
alter table public.recompensas_canjes enable row level security;
revoke all on public.recompensas_canjes from anon, authenticated;
grant select on public.recompensas_canjes to authenticated;
create policy recompensas_canjes_select on public.recompensas_canjes
  for select to authenticated using (cliente_id = public.mi_cliente_id() or public.es_admin());

-- Condiciones congeladas en el cupón al emitirlo (editar el catálogo después
-- no altera un cupón ya emitido).
alter table public.cupones
  add column catalogo_id    uuid references public.recompensas_catalogo (id),
  add column nombre_premio  text,
  add column servicio_id    uuid references public.servicios (id),
  add column alcance        text not null default 'TODO' check (alcance in ('TODO', 'SERVICIOS', 'PRODUCTOS')),
  add column minimo_compra  numeric(10, 2),
  add column tope           numeric(10, 2),
  add column nivel_minimo   text not null default 'BASICO' check (nivel_minimo in ('BASICO', 'PREMIUM', 'VIP')),
  add column vigente_hasta  timestamptz,
  add column nivel_aplicado text,
  add column costo_aplicado numeric(18, 4);

alter table public.cupones drop constraint if exists cupones_tipo_descuento_check;
alter table public.cupones add constraint cupones_tipo_descuento_check
  check (tipo_descuento in ('MONTO_FIJO', 'PORCENTAJE', 'SERVICIO'));
alter table public.cupones drop constraint if exists cupones_origen_check;
alter table public.cupones add constraint cupones_origen_check
  check (origen in ('REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION', 'PROMOCION',
                    'RECOMPENSA_MONEDAS', 'RECOMPENSA_SELLOS'));

-- Trazabilidad por línea de cada venta (neto, descuento, piso aplicado,
-- monedas). Solo ADMINISTRADOR la lee: incluye el piso protegido.
create table public.recompensas_venta_detalle (
  id                  uuid primary key default gen_random_uuid(),
  venta_id            uuid not null references public.ventas (id),
  linea               int not null,
  tipo                text not null,
  servicio_id         uuid,
  producto_id         uuid,
  subtotal            numeric(12, 2) not null,
  descuento           numeric(12, 2) not null default 0,
  neto                numeric(12, 2) not null,
  proteccion          jsonb,
  monedas             numeric(18, 8),
  incluida_en_apertura boolean not null default false,
  unique (venta_id, linea)
);
alter table public.recompensas_venta_detalle enable row level security;
revoke all on public.recompensas_venta_detalle from anon, authenticated;
grant select on public.recompensas_venta_detalle to authenticated;
create policy recompensas_venta_detalle_admin on public.recompensas_venta_detalle
  for select to authenticated using (public.es_admin());

-- ---------------------------------------------------------
-- 5. Helpers internos (no expuestos a la API)
-- ---------------------------------------------------------
create or replace function public.recompensas_nivel_orden(p_nivel text)
returns int language sql immutable set search_path = public, pg_temp
as $$ select case p_nivel when 'VIP' then 3 when 'PREMIUM' then 2 else 1 end; $$;

create or replace function public.recompensas_saldos(p_cliente_id uuid)
returns table (monedas numeric, clasificacion numeric, nivel text, sellos int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with m as (
    select coalesce(sum(monedas), 0) as mon, coalesce(sum(clasificacion), 0) as cla
    from public.recompensas_movimientos where cliente_id = p_cliente_id
  ), s as (
    select coalesce(sum(delta), 0)::int as sel from public.recompensas_sellos_movs where cliente_id = p_cliente_id
  ), c as (select * from public.recompensas_config where id = 1)
  select m.mon, m.cla,
         case when m.cla >= c.umbral_vip then 'VIP'
              when m.cla >= c.umbral_premium then 'PREMIUM'
              else 'BASICO' end,
         s.sel
  from m, s, c;
$$;
revoke execute on function public.recompensas_saldos(uuid) from public, anon, authenticated;

-- Reparto proporcional de un descuento entre líneas elegibles (bases > 0),
-- a centavos; el resto de redondeo va a la última línea elegible para que la
-- suma sea exacta.
create or replace function public.recompensas_distribuir(p_bases numeric[], p_total numeric)
returns numeric[]
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  n int := coalesce(array_length(p_bases, 1), 0);
  suma numeric := 0;
  asignado numeric := 0;
  ultimo int := 0;
  res numeric[] := '{}';
  i int;
begin
  for i in 1..n loop
    suma := suma + p_bases[i];
    if p_bases[i] > 0 then ultimo := i; end if;
  end loop;
  for i in 1..n loop res[i] := 0; end loop;
  if suma <= 0 or p_total <= 0 then return res; end if;
  for i in 1..n loop
    if p_bases[i] <= 0 then
      res[i] := 0;
    elsif i = ultimo then
      res[i] := round(p_total - asignado, 2);
    else
      res[i] := round(p_total * p_bases[i] / suma, 2);
      asignado := asignado + res[i];
    end if;
  end loop;
  return res;
end;
$$;
revoke execute on function public.recompensas_distribuir(numeric[], numeric) from public, anon, authenticated;

-- Un sello por clienta y día de Lima; tope sellos_max; no retroactivo.
create or replace function public.recompensas_otorgar_sello(p_cliente_id uuid, p_venta_id uuid, p_dia date)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_neto_dia int;
  v_saldo int;
  v_max int;
begin
  select coalesce(sum(delta), 0) into v_neto_dia
  from public.recompensas_sellos_movs
  where cliente_id = p_cliente_id and dia = p_dia and tipo in ('SELLO', 'SELLO_RETIRO');
  if v_neto_dia > 0 then return; end if;

  select coalesce(sum(delta), 0) into v_saldo from public.recompensas_sellos_movs where cliente_id = p_cliente_id;
  select sellos_max into v_max from public.recompensas_config where id = 1;
  if v_saldo >= v_max then return; end if;

  insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, dia, venta_id, clave)
  values (p_cliente_id, 'SELLO', 1, p_dia, p_venta_id,
          'sello:' || p_cliente_id || ':' || p_dia || ':' || p_venta_id)
  on conflict (clave) do nothing;
end;
$$;
revoke execute on function public.recompensas_otorgar_sello(uuid, uuid, date) from public, anon, authenticated;

-- Al anular: retira el sello del día solo si ya no queda otra venta válida con
-- servicios ese día, y una sola vez (net por día > 0).
create or replace function public.recompensas_revisar_sello(p_cliente_id uuid, p_venta_id uuid, p_dia date)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_neto_dia int;
begin
  select coalesce(sum(delta), 0) into v_neto_dia
  from public.recompensas_sellos_movs
  where cliente_id = p_cliente_id and dia = p_dia and tipo in ('SELLO', 'SELLO_RETIRO');
  if v_neto_dia <= 0 then return; end if;

  if exists (
    select 1
    from public.ventas v
    join public.venta_items i on i.venta_id = v.id and i.tipo = 'SERVICIO'
    where v.cliente_id = p_cliente_id
      and v.estado <> 'ANULADA'
      and v.id <> p_venta_id
      and (v.fecha at time zone 'America/Lima')::date = p_dia
  ) then
    return;
  end if;

  insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, dia, venta_id, clave, detalle)
  values (p_cliente_id, 'SELLO_RETIRO', -1, p_dia, p_venta_id,
          'sello-retiro:' || p_cliente_id || ':' || p_dia || ':' || p_venta_id,
          jsonb_build_object('motivo', 'venta anulada'))
  on conflict (clave) do nothing;
end;
$$;
revoke execute on function public.recompensas_revisar_sello(uuid, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 6. Activación (solo ADMINISTRADOR). Fija el corte la primera vez.
-- ---------------------------------------------------------
create or replace function public.recompensas_establecer_activo(p_activo boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede activar Recompensas.';
  end if;
  update public.recompensas_config
  set activo = p_activo,
      corte = case when p_activo then coalesce(corte, now()) else corte end,
      actualizado_en = now()
  where id = 1;
end;
$$;
revoke execute on function public.recompensas_establecer_activo(boolean) from public, anon;
grant execute on function public.recompensas_establecer_activo(boolean) to authenticated;

-- ---------------------------------------------------------
-- 7. confirmar_venta: misma firma y comportamiento base que
--    20261002000003; agrega validación completa del cupón (un cupón por
--    venta, vigencia, nivel, alcance, mínimo, tope, exceso), reparto del
--    descuento por línea, piso de protección por servicio y acreditación de
--    monedas/sello (solo con recompensas_config.activo y clienta vinculada).
-- ---------------------------------------------------------
create or replace function public.confirmar_venta(p_metodo_pago text, p_monto_recibido numeric, p_items jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0, p_descuento_monto numeric DEFAULT 0, p_monto_pos_tarjeta numeric DEFAULT NULL::numeric, p_codigo_cupon text DEFAULT NULL::text, p_costo_delivery numeric DEFAULT 0)
 RETURNS TABLE(venta_id uuid, codigo text, total numeric, items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_venta_id uuid;
  v_codigo text;
  v_total numeric := 0;
  v_item jsonb;
  v_cantidad int;
  v_precio numeric;
  v_nombre text;
  v_stock_actual int;
  v_items_resueltos jsonb := '[]'::jsonb;
  v_registro_servicio_id uuid;
  v_registro_servicio_estado text;
  v_registro_servicio_venta_id uuid;
  v_servicio_id uuid;
  v_registro_cliente_id uuid;
  v_registro_usuario_id uuid;
  v_asistente_id uuid;
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
  v_cupon_tipo_descuento text;
  v_cupon_valor numeric;
  v_cupon_pct_aplicado numeric := 0;
  v_credito_referidor numeric;
  v_cupon_referente_id uuid;
  -- Fase 2
  v_cupon public.cupones;
  v_cfg public.recompensas_config;
  v_n int;
  v_i int;
  v_bases numeric[];
  v_desc numeric[];
  v_elig_total numeric;
  v_desc_total numeric := 0;
  v_servicio_ya boolean := false;
  v_subtotal_linea numeric;
  v_linea jsonb;
  v_tipo_linea text;
  v_piso numeric;
  v_prot public.servicios_proteccion;
  v_nivel text;
  v_neto numeric;
  v_neto_serv numeric := 0;
  v_neto_prod numeric := 0;
  v_monedas numeric;
  v_monedas_linea numeric;
  v_excluida boolean;
  v_tiene_servicio boolean := false;
  v_vinculada boolean := false;
  v_dia date;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no puede estar vacío';
  end if;

  if p_descuento_pct is null then
    p_descuento_pct := 0;
  end if;
  if p_descuento_monto is null then
    p_descuento_monto := 0;
  end if;
  if p_descuento_pct < 0 or p_descuento_pct > 100 then
    raise exception 'El descuento debe estar entre 0%% y 100%%';
  end if;
  if p_descuento_monto < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;

  p_codigo_cupon := nullif(btrim(coalesce(p_codigo_cupon, '')), '');

  if p_codigo_cupon is not null and (p_descuento_pct > 0 or p_descuento_monto > 0) then
    raise exception 'No puedes combinar un cupón con otro descuento';
  end if;
  if p_codigo_cupon is null and p_descuento_pct > 0 and p_descuento_monto > 0 then
    raise exception 'El descuento debe ser por porcentaje o por monto fijo, no ambos';
  end if;

  if p_monto_pos_tarjeta is not null and p_monto_pos_tarjeta < 0 then
    raise exception 'El monto a digitar en POS no puede ser negativo';
  end if;

  if p_costo_delivery is null or p_costo_delivery < 0 then
    p_costo_delivery := 0;
  end if;

  select * into v_cfg from public.recompensas_config where id = 1;

  if p_codigo_cupon is not null then
    update public.cupones
    set estado = 'CANJEADO', canjeado_en = now()
    where public.cupones.codigo = upper(p_codigo_cupon)
      and public.cupones.estado = 'DISPONIBLE'
      and (public.cupones.vigente_hasta is null or public.cupones.vigente_hasta > now())
    returning id, cliente_id, origen into v_cupon_id, v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_id is null then
      if exists (select 1 from public.cupones c
                 where c.codigo = upper(p_codigo_cupon) and c.estado = 'DISPONIBLE'
                   and c.vigente_hasta is not null and c.vigente_hasta <= now()) then
        raise exception 'Este cupón ya venció';
      end if;
      raise exception 'Cupón inválido o ya usado';
    end if;

    if p_cliente_id is not null and p_cliente_id <> v_cupon_cliente_id then
      raise exception 'Este cupón pertenece a otro cliente';
    end if;

    p_cliente_id := v_cupon_cliente_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_registro_cliente_id := null;
    v_registro_usuario_id := null;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un item del ticket';
    end if;

    if (v_item->>'tipo') = 'PRODUCTO' then
      select nombre, precio, stock_actual
        into v_nombre, v_precio, v_stock_actual
      from public.productos
      where id = (v_item->>'producto_id')::uuid
      for update;

      if v_nombre is null then
        raise exception 'El producto "%" ya no existe', v_item->>'nombre';
      end if;

      if v_stock_actual < v_cantidad then
        raise exception 'Stock insuficiente para "%" (quedan %, pediste %)',
          v_nombre, v_stock_actual, v_cantidad;
      end if;

      v_servicio_id := null;
      v_registro_servicio_id := null;

    elsif (v_item->>'tipo') = 'SERVICIO' then
      if v_cantidad <> 1 then
        raise exception 'Cada atención se vende de a una';
      end if;

      v_registro_servicio_id := (v_item->>'registro_servicio_id')::uuid;
      if v_registro_servicio_id is null then
        raise exception 'Falta la atención a vender para un servicio del ticket';
      end if;

      select rs.estado, rs.venta_id, rs.precio, rs.servicio_id, rs.cliente_id, rs.usuario_id, s.nombre
        into v_registro_servicio_estado, v_registro_servicio_venta_id, v_precio, v_servicio_id,
             v_registro_cliente_id, v_registro_usuario_id, v_nombre
      from public.registro_servicios rs
      join public.servicios s on s.id = rs.servicio_id
      where rs.id = v_registro_servicio_id
      for update of rs;

      if v_nombre is null then
        raise exception 'Esa atención ya no existe';
      end if;

      if v_registro_servicio_estado <> 'ACTIVO' or v_registro_servicio_venta_id is not null then
        raise exception 'Esa atención ya no está disponible para vender';
      end if;

    else
      raise exception 'Tipo de item desconocido: %', v_item->>'tipo';
    end if;

    v_total := v_total + v_cantidad * v_precio;

    v_items_resueltos := v_items_resueltos || jsonb_build_object(
      'tipo', v_item->>'tipo',
      'producto_id', v_item->>'producto_id',
      'servicio_id', v_servicio_id,
      'registro_servicio_id', v_registro_servicio_id,
      'cliente_id', v_registro_cliente_id,
      'usuario_id', v_registro_usuario_id,
      'nombre', v_nombre,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio,
      'subtotal', v_cantidad * v_precio
    );
  end loop;

  -- ---- Descuento: se reparte por línea elegible --------------------------
  v_n := jsonb_array_length(v_items_resueltos);
  v_bases := array_fill(0::numeric, array[v_n]);

  if p_codigo_cupon is not null then
    select * into v_cupon from public.cupones where id = v_cupon_id;
    v_cupon_tipo_descuento := v_cupon.tipo_descuento;
    v_cupon_valor := v_cupon.valor;

    if public.recompensas_nivel_orden(v_cupon.nivel_minimo) >
       public.recompensas_nivel_orden((select s.nivel from public.recompensas_saldos(v_cupon_cliente_id) s)) then
      raise exception 'Este cupón requiere nivel % o superior', v_cupon.nivel_minimo;
    end if;

    for v_i in 0..v_n - 1 loop
      v_linea := v_items_resueltos -> v_i;
      v_tipo_linea := v_linea->>'tipo';
      if v_cupon.tipo_descuento = 'SERVICIO' then
        if v_tipo_linea = 'SERVICIO' and not v_servicio_ya
           and (v_linea->>'servicio_id')::uuid = v_cupon.servicio_id then
          v_bases[v_i + 1] := (v_linea->>'subtotal')::numeric;
          v_servicio_ya := true;
        end if;
      elsif v_cupon.alcance = 'TODO'
         or (v_cupon.alcance = 'SERVICIOS' and v_tipo_linea = 'SERVICIO')
         or (v_cupon.alcance = 'PRODUCTOS' and v_tipo_linea = 'PRODUCTO') then
        v_bases[v_i + 1] := (v_linea->>'subtotal')::numeric;
      end if;
    end loop;

    select coalesce(sum(x), 0) into v_elig_total from unnest(v_bases) as x;
    if v_elig_total <= 0 then
      raise exception 'Este cupón no aplica a los productos o servicios de esta compra.';
    end if;
    if v_cupon.minimo_compra is not null and v_elig_total < v_cupon.minimo_compra then
      raise exception 'Este cupón requiere una compra mínima de S/ % en los productos o servicios a los que aplica.', v_cupon.minimo_compra;
    end if;

    if v_cupon.tipo_descuento = 'PORCENTAJE' then
      v_cupon_pct_aplicado := v_cupon.valor;
      v_desc_total := round(v_elig_total * v_cupon.valor / 100, 2);
      if v_cupon.tope is not null and v_desc_total > v_cupon.tope then
        v_desc_total := v_cupon.tope;
      end if;
    elsif v_cupon.tipo_descuento = 'SERVICIO' then
      -- Premio de servicio: cubre el precio efectivo menos el piso protegido.
      select * into v_prot from public.servicios_proteccion where servicio_id = v_cupon.servicio_id;
      if v_prot.servicio_id is null then
        raise exception 'Este servicio no admite cupones hasta que se configure su protección.';
      end if;
      v_desc_total := greatest(v_elig_total - v_prot.total, 0);
    else
      p_descuento_monto := v_cupon.valor;
      if p_descuento_monto > v_elig_total then
        raise exception 'Este cupón supera el importe al que puede aplicarse. Puedes utilizarlo en otra compra.';
      end if;
      v_desc_total := p_descuento_monto;
    end if;
  elsif p_descuento_pct > 0 then
    for v_i in 0..v_n - 1 loop
      v_bases[v_i + 1] := (v_items_resueltos -> v_i ->> 'subtotal')::numeric;
    end loop;
    v_desc_total := v_total - round(v_total * (1 - p_descuento_pct / 100), 2);
  elsif p_descuento_monto > 0 then
    if p_descuento_monto > v_total then
      raise exception 'El descuento (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    for v_i in 0..v_n - 1 loop
      v_bases[v_i + 1] := (v_items_resueltos -> v_i ->> 'subtotal')::numeric;
    end loop;
    v_desc_total := p_descuento_monto;
  end if;

  v_desc := public.recompensas_distribuir(v_bases, v_desc_total);

  -- ---- Protección del costo por servicio (por partida) -------------------
  for v_i in 0..v_n - 1 loop
    v_linea := v_items_resueltos -> v_i;
    if v_linea->>'tipo' = 'SERVICIO' and v_desc[v_i + 1] > 0 then
      select * into v_prot from public.servicios_proteccion
      where servicio_id = (v_linea->>'servicio_id')::uuid;

      if v_prot.servicio_id is null then
        if p_codigo_cupon is not null then
          raise exception 'El servicio "%" no admite cupones hasta que se configure su protección.', v_linea->>'nombre';
        end if;
        -- descuento manual sobre servicio sin protección configurada: comportamiento previo
      elsif (v_linea->>'subtotal')::numeric - v_desc[v_i + 1] < v_prot.total then
        if p_codigo_cupon is not null then
          raise exception 'Este cupón supera el importe al que puede aplicarse. Puedes utilizarlo en otra compra.';
        end if;
        raise exception 'El descuento deja el servicio "%" por debajo de su cobro mínimo.', v_linea->>'nombre';
      end if;
    end if;
  end loop;

  v_total := round(v_total - v_desc_total, 2);

  -- Delivery se suma DESPUÉS del cupón/descuento — nunca se descuenta.
  v_total := v_total + p_costo_delivery;

  if p_metodo_pago = 'Efectivo' then
    if p_monto_recibido is null or p_monto_recibido < v_total then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total;
    end if;
  else
    p_monto_recibido := null;
  end if;

  if p_metodo_pago <> 'Tarjeta' then
    p_monto_pos_tarjeta := null;
  end if;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas
    (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct, descuento_monto, monto_pos_tarjeta, cupon_id)
  values
    (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id,
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then v_cupon_pct_aplicado
       when p_codigo_cupon is null then p_descuento_pct
       else 0
     end,
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then 0
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'SERVICIO' then v_desc_total
       else coalesce(p_descuento_monto, 0)
     end,
     p_monto_pos_tarjeta, v_cupon_id)
  returning id into v_venta_id;

  if v_cupon_id is not null then
    update public.cupones set venta_id = v_venta_id where id = v_cupon_id;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      select referido_por into v_cupon_referente_id from public.clientes where id = v_cupon_cliente_id;

      if v_cupon_referente_id is not null then
        select credito_referidor into v_credito_referidor from public.config_referidos where id = 1;

        insert into public.cupones (cliente_id, codigo, origen, valor, referido_id)
        values (
          v_cupon_referente_id, public.generar_codigo_cupon(), 'REFERIDO_RECOMPENSA',
          v_credito_referidor, v_cupon_cliente_id
        );

        insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
        values (
          v_cupon_referente_id,
          'REFERIDO',
          '¡Ganaste un cupón por referir!',
          'Un cliente que invitaste ya canjeó su cupón de bienvenida. Ganaste un cupón de S/' ||
            v_credito_referidor || ' — muéstralo en tu próxima visita.',
          '/mi-perfil/referidos'
        );
      end if;
    end if;
  end if;

  -- ---- Elegibilidad para acreditar (clienta con cuenta web vinculada) ----
  if v_cfg.activo and p_cliente_id is not null then
    select (cliente_web_id is not null) into v_vinculada
    from public.clientes where id = p_cliente_id for update;
    v_vinculada := coalesce(v_vinculada, false);
  end if;

  for v_i in 0..v_n - 1 loop
    v_item := v_items_resueltos -> v_i;
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_subtotal_linea := (v_item->>'subtotal')::numeric;
    v_neto := v_subtotal_linea - v_desc[v_i + 1];
    v_excluida := false;
    v_prot := null;
    v_monedas_linea := null;

    if (v_item->>'tipo') = 'PRODUCTO' then
      update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = (v_item->>'producto_id')::uuid;

      insert into public.venta_items
        (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'PRODUCTO', (v_item->>'producto_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

      v_neto_prod := v_neto_prod + v_neto;
    else
      v_tiene_servicio := true;
      v_asistente_id := null;
      if (v_item->>'usuario_id') is not null then
        select id into v_asistente_id
        from public.asistentes
        where usuario_id = (v_item->>'usuario_id')::uuid
        limit 1;
      end if;

      insert into public.venta_items
        (venta_id, tipo, servicio_id, cliente_id, asistente_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'SERVICIO', (v_item->>'servicio_id')::uuid,
         (v_item->>'cliente_id')::uuid, v_asistente_id, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

      update public.registro_servicios
      set venta_id = v_venta_id
      where id = (v_item->>'registro_servicio_id')::uuid;

      select * into v_prot from public.servicios_proteccion
      where servicio_id = (v_item->>'servicio_id')::uuid;

      -- Atención anterior al corte cuyo aporte ya está en el saldo de apertura:
      -- no se acredita otra vez (solo ese servicio; el resto de la venta sí).
      select exists (select 1 from public.recompensas_apertura_aportes a
                     where a.registro_servicio_id = (v_item->>'registro_servicio_id')::uuid)
        into v_excluida;

      if not v_excluida then
        v_neto_serv := v_neto_serv + v_neto;
      end if;
    end if;

    insert into public.recompensas_venta_detalle
      (venta_id, linea, tipo, servicio_id, producto_id, subtotal, descuento, neto, proteccion, incluida_en_apertura)
    values
      (v_venta_id, v_i + 1, v_item->>'tipo',
       nullif(v_item->>'servicio_id', '')::uuid, nullif(v_item->>'producto_id', '')::uuid,
       v_subtotal_linea, v_desc[v_i + 1], v_neto,
       case when v_prot.servicio_id is not null then jsonb_build_object(
         'materiales', v_prot.materiales, 'asistente', v_prot.asistente,
         'otros', v_prot.otros, 'total', v_prot.total) end,
       v_excluida);
  end loop;

  -- ---- Acreditación (una sola vez por venta: clave única) ----------------
  if v_cfg.activo and v_vinculada then
    v_monedas := round(
        v_neto_serv * v_cfg.tasa_serv_monedas / v_cfg.tasa_serv_soles
      + v_neto_prod * v_cfg.tasa_prod_monedas / v_cfg.tasa_prod_soles, 8);

    insert into public.recompensas_movimientos
      (cliente_id, tipo, monedas, clasificacion, venta_id, clave, detalle)
    values
      (p_cliente_id, 'VENTA', v_monedas, v_monedas, v_venta_id, 'venta:' || v_venta_id || ':acredita',
       jsonb_build_object('neto_servicios', v_neto_serv, 'neto_productos', v_neto_prod,
                          'tasa_serv', v_cfg.tasa_serv_monedas || '/' || v_cfg.tasa_serv_soles,
                          'tasa_prod', v_cfg.tasa_prod_monedas || '/' || v_cfg.tasa_prod_soles))
    on conflict (clave) do nothing;

    if v_tiene_servicio then
      v_dia := (now() at time zone 'America/Lima')::date;
      perform public.recompensas_otorgar_sello(p_cliente_id, v_venta_id, v_dia);
    end if;
  end if;

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$function$;

-- ---------------------------------------------------------
-- 8. anular_venta: mismo comportamiento que 20261002000004 + reversión
--    única de monedas/clasificación, revisión del sello del día y
--    devolución del cupón solo si sigue vigente (conserva su vencimiento).
-- ---------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
  v_cliente_id uuid;
  v_mov record;
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select estado, fecha, cliente_id into v_estado, v_fecha, v_cliente_id
  from public.ventas
  where id = p_venta_id
  for update;

  if v_estado is null then
    raise exception 'La venta no existe';
  end if;

  if v_estado = 'ANULADA' then
    raise exception 'Esta venta ya está anulada';
  end if;

  if v_rol = 'CAJERA' and not public.es_hoy(v_fecha) then
    raise exception 'Solo puedes anular ventas de hoy';
  end if;

  update public.ventas
  set estado = 'ANULADA'
  where id = p_venta_id;

  for v_item in
    select producto_id, cantidad
    from public.venta_items
    where venta_id = p_venta_id and tipo = 'PRODUCTO'
  loop
    update public.productos
    set stock_actual = stock_actual + v_item.cantidad
    where id = v_item.producto_id;
  end loop;

  update public.registro_servicios
  set venta_id = null
  where venta_id = p_venta_id;

  select cupon_id into v_cupon_id from public.ventas where id = p_venta_id;

  if v_cupon_id is not null then
    -- Vigente: vuelve a disponible con su vencimiento original. Vencido: queda
    -- como estaba (consumido) y no se reactiva. Las monedas del canje original
    -- NO se devuelven.
    update public.cupones
    set estado = 'DISPONIBLE', canjeado_en = null, venta_id = null
    where id = v_cupon_id
      and (vigente_hasta is null or vigente_hasta > now())
    returning cliente_id, origen into v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      update public.cupones
      set estado = 'ANULADO'
      where origen = 'REFERIDO_RECOMPENSA'
        and referido_id = v_cupon_cliente_id
        and estado = 'DISPONIBLE';
    end if;
  end if;

  -- Reversión de monedas y clasificación ganadas por esta venta (una sola vez;
  -- el saldo puede quedar negativo, nunca bloquea la anulación).
  for v_mov in
    select * from public.recompensas_movimientos
    where venta_id = p_venta_id and tipo = 'VENTA'
  loop
    insert into public.recompensas_movimientos
      (cliente_id, tipo, monedas, clasificacion, venta_id, clave, detalle)
    values
      (v_mov.cliente_id, 'VENTA_REVERSION', -v_mov.monedas, -v_mov.clasificacion, p_venta_id,
       'venta:' || p_venta_id || ':revierte',
       jsonb_build_object('revierte', v_mov.id))
    on conflict (clave) do nothing;
  end loop;

  if v_cliente_id is not null then
    perform public.recompensas_revisar_sello(
      v_cliente_id, p_venta_id, (v_fecha at time zone 'America/Lima')::date);
  end if;

  -- QA-027: el pedido web respaldado por esta venta ya no tiene venta vigente.
  update public.pedidos_web
  set estado = 'CANCELADO', actualizado_en = now()
  where venta_id = p_venta_id
    and estado <> 'CANCELADO';
end;
$function$;

-- ---------------------------------------------------------
-- 9. Canje atómico e idempotente (monedas y sellos)
-- ---------------------------------------------------------
create or replace function public._recompensas_emitir_canje(
  p_cliente_id uuid, p_catalogo_id uuid, p_clave text, p_origen text)
returns table (canje_id uuid, cupon_id uuid, codigo text, costo numeric, repetido boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.recompensas_config;
  v_cat public.recompensas_catalogo;
  v_canje public.recompensas_canjes;
  v_cupon public.cupones;
  v_s record;
  v_costo numeric;
  v_nivel text;
  v_usados int;
  v_usados_cli int;
  v_vence timestamptz;
  v_codigo text;
  v_canje_id uuid := gen_random_uuid();
  v_tipo_desc text;
  v_piso numeric;
begin
  if p_clave is null or btrim(p_clave) = '' or length(p_clave) > 100 then
    raise exception 'Falta la clave de la operación.';
  end if;

  -- Serializa las operaciones de ESTA clienta (saldo/sellos).
  perform 1 from public.clientes where id = p_cliente_id for update;

  select * into v_canje from public.recompensas_canjes
  where cliente_id = p_cliente_id and clave_idem = p_clave;
  if v_canje.id is not null then
    if v_canje.catalogo_id <> p_catalogo_id then
      raise exception 'Esa clave de operación ya se usó con otra recompensa.';
    end if;
    return query
      select v_canje.id, v_canje.cupon_id, c.codigo, v_canje.costo, true
      from public.cupones c where c.id = v_canje.cupon_id;
    return;
  end if;

  select * into v_cfg from public.recompensas_config where id = 1;
  if not v_cfg.activo then
    raise exception 'Recompensas todavía no está activo.';
  end if;

  -- Serializa el cupo de ESTA recompensa (último cupo bajo concurrencia).
  select * into v_cat from public.recompensas_catalogo
  where id = p_catalogo_id for update;
  if v_cat.id is null or not v_cat.activo or v_cat.origen <> p_origen then
    raise exception 'Esa recompensa no está disponible.';
  end if;
  if v_cat.reclamo_desde is not null and now() < v_cat.reclamo_desde then
    raise exception 'Esa recompensa todavía no se puede reclamar.';
  end if;
  if v_cat.reclamo_hasta is not null and now() > v_cat.reclamo_hasta then
    raise exception 'El período para reclamar esa recompensa terminó.';
  end if;

  select * into v_s from public.recompensas_saldos(p_cliente_id);
  v_nivel := v_s.nivel;
  if public.recompensas_nivel_orden(v_cat.nivel_minimo) > public.recompensas_nivel_orden(v_nivel) then
    raise exception 'Esa recompensa requiere nivel % o superior.', v_cat.nivel_minimo;
  end if;

  if v_cat.tipo = 'SERVICIO' then
    select total into v_piso from public.servicios_proteccion where servicio_id = v_cat.servicio_id;
    if v_piso is null then
      raise exception 'Esa recompensa no está disponible por ahora.';
    end if;
  end if;

  select count(*) into v_usados from public.recompensas_canjes where catalogo_id = p_catalogo_id;
  if v_cat.cupo_global is not null and v_usados >= v_cat.cupo_global then
    raise exception 'Esa recompensa se agotó.';
  end if;
  select count(*) into v_usados_cli from public.recompensas_canjes
  where catalogo_id = p_catalogo_id and cliente_id = p_cliente_id;
  if v_cat.limite_por_clienta is not null and v_usados_cli >= v_cat.limite_por_clienta then
    raise exception 'Ya alcanzaste el límite de esta recompensa.';
  end if;

  if p_origen = 'SELLOS' then
    v_costo := v_cfg.sellos_por_premio;
    if v_s.sellos < v_costo then
      raise exception 'Necesitas % sellos para reclamar un premio.', v_costo;
    end if;
  else
    v_costo := case v_nivel
      when 'VIP' then coalesce(v_cat.costo_vip, v_cat.costo_premium, v_cat.costo_basico)
      when 'PREMIUM' then coalesce(v_cat.costo_premium, v_cat.costo_basico)
      else v_cat.costo_basico end;
    if v_s.monedas < v_costo then
      raise exception 'No tienes monedas suficientes para esta recompensa.';
    end if;
  end if;

  v_vence := case
    when v_cat.cupon_vigencia_dias is not null and v_cat.cupon_vence_el is not null
      then least(now() + make_interval(days => v_cat.cupon_vigencia_dias), v_cat.cupon_vence_el)
    when v_cat.cupon_vigencia_dias is not null then now() + make_interval(days => v_cat.cupon_vigencia_dias)
    else v_cat.cupon_vence_el end;

  v_tipo_desc := case v_cat.tipo when 'MONTO' then 'MONTO_FIJO' else v_cat.tipo end;
  v_codigo := public.generar_codigo_cupon();

  insert into public.cupones
    (cliente_id, codigo, origen, valor, tipo_descuento, catalogo_id, nombre_premio, servicio_id,
     alcance, minimo_compra, tope, nivel_minimo, vigente_hasta, nivel_aplicado, costo_aplicado)
  values
    (p_cliente_id, v_codigo,
     case p_origen when 'SELLOS' then 'RECOMPENSA_SELLOS' else 'RECOMPENSA_MONEDAS' end,
     v_cat.valor, v_tipo_desc, v_cat.id, v_cat.nombre, v_cat.servicio_id,
     v_cat.alcance, v_cat.minimo_compra, v_cat.tope, v_cat.nivel_minimo, v_vence, v_nivel, v_costo)
  returning * into v_cupon;

  insert into public.recompensas_canjes
    (id, cliente_id, catalogo_id, clave_idem, origen, costo, nivel_aplicado, cupon_id)
  values (v_canje_id, p_cliente_id, p_catalogo_id, p_clave, p_origen, v_costo, v_nivel, v_cupon.id);

  if p_origen = 'SELLOS' then
    insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, canje_id, clave, detalle)
    values (p_cliente_id, 'CANJE_SELLOS', -v_costo::int, v_canje_id, 'canje:' || v_canje_id,
            jsonb_build_object('premio', v_cat.nombre));
  else
    insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clasificacion, canje_id, clave, detalle)
    values (p_cliente_id, 'CANJE', -v_costo, 0, v_canje_id, 'canje:' || v_canje_id,
            jsonb_build_object('premio', v_cat.nombre, 'nivel', v_nivel));
  end if;

  return query select v_canje_id, v_cupon.id, v_codigo, v_costo, false;
end;
$$;
revoke execute on function public._recompensas_emitir_canje(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.canjear_recompensa(p_catalogo_id uuid, p_clave text)
returns table (canje_id uuid, cupon_id uuid, codigo text, costo numeric, repetido boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_cliente uuid := public.mi_cliente_id();
begin
  if v_cliente is null then
    raise exception 'Inicia sesión con tu cuenta de clienta para canjear.';
  end if;
  return query select * from public._recompensas_emitir_canje(v_cliente, p_catalogo_id, p_clave, 'MONEDAS');
end;
$$;
revoke execute on function public.canjear_recompensa(uuid, text) from public, anon;
grant execute on function public.canjear_recompensa(uuid, text) to authenticated;

create or replace function public.canjear_premio_sellos(p_catalogo_id uuid, p_clave text)
returns table (canje_id uuid, cupon_id uuid, codigo text, costo numeric, repetido boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_cliente uuid := public.mi_cliente_id();
begin
  if v_cliente is null then
    raise exception 'Inicia sesión con tu cuenta de clienta para canjear.';
  end if;
  return query select * from public._recompensas_emitir_canje(v_cliente, p_catalogo_id, p_clave, 'SELLOS');
end;
$$;
revoke execute on function public.canjear_premio_sellos(uuid, text) from public, anon;
grant execute on function public.canjear_premio_sellos(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 10. Lecturas de la clienta: saldo, catálogo (sin costos internos) y
--     movimientos explicados.
-- ---------------------------------------------------------
create or replace function public.mi_saldo_recompensas()
returns table (activo boolean, monedas numeric, clasificacion numeric, nivel text,
               umbral_premium numeric, umbral_vip numeric,
               sellos int, sellos_max int, sellos_por_premio int, sellos_llenos boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.activo, s.monedas, s.clasificacion, s.nivel, c.umbral_premium, c.umbral_vip,
         s.sellos, c.sellos_max, c.sellos_por_premio, s.sellos >= c.sellos_max
  from public.recompensas_config c,
       lateral public.recompensas_saldos(public.mi_cliente_id()) s
  where c.id = 1 and public.mi_cliente_id() is not null;
$$;
revoke execute on function public.mi_saldo_recompensas() from public, anon;
grant execute on function public.mi_saldo_recompensas() to authenticated;

create or replace function public.mi_catalogo_recompensas(p_origen text default 'MONEDAS')
returns table (id uuid, nombre text, descripcion text, origen text, tipo text, valor numeric,
               servicio_nombre text, alcance text, minimo_compra numeric, tope numeric,
               nivel_minimo text, costo numeric, reclamo_desde timestamptz, reclamo_hasta timestamptz,
               cupon_vigencia_dias int, cupon_vence_el timestamptz, cupo_restante int,
               limite_por_clienta int, reclamados_por_mi int, pago_minimo numeric,
               canjeable boolean, motivo text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with yo as (
    select public.mi_cliente_id() as cid
  ), s as (
    select * from yo, lateral public.recompensas_saldos(yo.cid) where yo.cid is not null
  ), cfg as (select * from public.recompensas_config where id = 1)
  select cat.id, cat.nombre, cat.descripcion, cat.origen, cat.tipo, cat.valor, sv.nombre,
         cat.alcance, cat.minimo_compra, cat.tope, cat.nivel_minimo,
         k.costo, cat.reclamo_desde, cat.reclamo_hasta, cat.cupon_vigencia_dias, cat.cupon_vence_el,
         case when cat.cupo_global is null then null
              else greatest(cat.cupo_global - (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id), 0)::int end,
         cat.limite_por_clienta,
         (select count(*)::int from public.recompensas_canjes z where z.catalogo_id = cat.id and z.cliente_id = s.cid),
         case when cat.tipo = 'SERVICIO' then sp.total end,
         r.ok, r.motivo
  from public.recompensas_catalogo cat
  cross join cfg
  join s on true
  left join public.servicios sv on sv.id = cat.servicio_id
  left join public.servicios_proteccion sp on sp.servicio_id = cat.servicio_id
  cross join lateral (
    select case when cat.origen = 'SELLOS' then cfg.sellos_por_premio::numeric
                else case s.nivel when 'VIP' then coalesce(cat.costo_vip, cat.costo_premium, cat.costo_basico)
                                  when 'PREMIUM' then coalesce(cat.costo_premium, cat.costo_basico)
                                  else cat.costo_basico end end as costo
  ) k
  cross join lateral (
    select
      case
        when not cfg.activo then 'Recompensas todavía no está activo.'
        when cat.reclamo_desde is not null and now() < cat.reclamo_desde then 'Todavía no se puede reclamar.'
        when cat.reclamo_hasta is not null and now() > cat.reclamo_hasta then 'El período para reclamar terminó.'
        when public.recompensas_nivel_orden(cat.nivel_minimo) > public.recompensas_nivel_orden(s.nivel)
          then 'Requiere nivel ' || cat.nivel_minimo || '.'
        when cat.tipo = 'SERVICIO' and sp.servicio_id is null then 'No disponible por ahora.'
        when cat.cupo_global is not null and (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id) >= cat.cupo_global then 'Agotada.'
        when cat.limite_por_clienta is not null and (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id and z.cliente_id = s.cid) >= cat.limite_por_clienta then 'Ya alcanzaste el límite.'
        when cat.origen = 'SELLOS' and s.sellos < cfg.sellos_por_premio then 'Necesitas ' || cfg.sellos_por_premio || ' sellos.'
        when cat.origen = 'MONEDAS' and s.monedas < k.costo then 'No tienes monedas suficientes.'
        else null
      end as motivo,
      true as ok_base
  ) m
  cross join lateral (select (m.motivo is null) as ok, m.motivo as motivo) r
  where cat.activo and cat.origen = p_origen
  order by k.costo, cat.nombre;
$$;
revoke execute on function public.mi_catalogo_recompensas(text) from public, anon;
grant execute on function public.mi_catalogo_recompensas(text) to authenticated;

create or replace function public.mis_movimientos_recompensas()
returns table (id uuid, fecha timestamptz, tipo text, descripcion text, monedas numeric,
               clasificacion numeric, saldo numeric, venta_codigo text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.id, m.creado_en, m.tipo,
         case m.tipo
           when 'APERTURA' then 'Saldo inicial convertido a monedas'
           when 'VENTA' then 'Monedas ganadas por tu compra ' || coalesce(v.codigo, '')
           when 'VENTA_REVERSION' then 'Se descontaron las monedas de una compra anulada ' || coalesce(v.codigo, '')
           when 'CANJE' then 'Canje: ' || coalesce(m.detalle->>'premio', 'recompensa')
           else 'Ajuste' end,
         m.monedas, m.clasificacion,
         sum(m.monedas) over (order by m.creado_en, m.id),
         v.codigo
  from public.recompensas_movimientos m
  left join public.ventas v on v.id = m.venta_id
  where m.cliente_id = public.mi_cliente_id()
  order by m.creado_en desc, m.id desc;
$$;
revoke execute on function public.mis_movimientos_recompensas() from public, anon;
grant execute on function public.mis_movimientos_recompensas() to authenticated;

create or replace function public.mis_sellos_recompensas()
returns table (id uuid, fecha timestamptz, tipo text, descripcion text, delta int, saldo int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.id, m.creado_en, m.tipo,
         case m.tipo
           when 'APERTURA' then 'Sellos pendientes anteriores'
           when 'SELLO' then 'Sello por tu visita del ' || to_char(m.dia, 'DD/MM/YYYY')
           when 'SELLO_RETIRO' then 'Se descontó un sello por una venta anulada. Tus próximos sellos compensarán este ajuste.'
           else 'Premio reclamado: ' || coalesce(m.detalle->>'premio', 'recompensa') end,
         m.delta,
         (sum(m.delta) over (order by m.creado_en, m.id))::int
  from public.recompensas_sellos_movs m
  where m.cliente_id = public.mi_cliente_id()
  order by m.creado_en desc, m.id desc;
$$;
revoke execute on function public.mis_sellos_recompensas() from public, anon;
grant execute on function public.mis_sellos_recompensas() to authenticated;

-- ---------------------------------------------------------
-- 11. El canje antiguo de Fidelización (sin costo) queda cerrado una vez
--     activas las Recompensas: los sellos se gastan en Mis sellos.
-- ---------------------------------------------------------
create or replace function public.generar_cupon_fidelizacion()
returns table (codigo text, valor numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id      uuid;
  v_visitas_totales int;
  v_reclamadas      int;
  v_disponibles     int;
  v_porcentaje      numeric;
  v_codigo          text;
begin
  if (select activo from public.recompensas_config where id = 1) then
    raise exception 'Reclama tus premios de sellos desde Recompensas → Mis sellos.';
  end if;

  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de generar un cupón.';
  end if;

  select count(distinct (fecha at time zone 'America/Lima')::date)::int into v_visitas_totales
  from public.registro_servicios
  where cliente_id = v_cliente_id and estado = 'ACTIVO';

  select fidelizacion_recompensas_reclamadas into v_reclamadas
  from public.clientes
  where id = v_cliente_id
  for update;

  v_disponibles := (v_visitas_totales / 5) - coalesce(v_reclamadas, 0);

  if v_disponibles <= 0 then
    raise exception 'Todavía no completaste una tarjeta de 5 visitas.';
  end if;

  select porcentaje_recompensa into v_porcentaje from public.config_fidelizacion where id = 1;

  update public.clientes
  set fidelizacion_recompensas_reclamadas = fidelizacion_recompensas_reclamadas + 1
  where id = v_cliente_id;

  v_codigo := public.generar_codigo_cupon();

  insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento)
  values (v_cliente_id, v_codigo, 'FIDELIZACION', v_porcentaje, 'PORCENTAJE');

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    v_cliente_id,
    'FIDELIZACION',
    '¡Generaste un cupón!',
    'Tu cupón de ' || v_porcentaje || '% de descuento ya está listo. Muéstralo en tu próxima visita.',
    '/fidelizacion'
  );

  return query select v_codigo, v_porcentaje;
end;
$$;

commit;
