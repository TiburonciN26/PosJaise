-- =========================================================
-- POS Negocio 2 — Split del rol ASISTENTE en CAJERA + ASISTENTE
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Hasta ahora "ASISTENTE" mezclaba dos trabajos distintos: caja
-- (Ventas/Inventario/Historial/Servicios) y atención de servicios
-- (Mi Panel, comisiones). Se separan en dos roles:
--   - CAJERA: mismo acceso que tenía ASISTENTE hasta hoy (Ventas,
--     Inventario, Historial, Servicios), sin Mi Panel.
--   - ASISTENTE (nuevo): dueño del sistema de comisiones (tabla
--     asistentes, Porcentajes, Mi Panel).
--   - Citas queda compartida por los dos: cualquiera de los dos ve,
--     agenda, cancela y reasigna cualquier cita, no solo las propias.
--
-- Todas las cuentas que HOY son 'ASISTENTE' pasan a 'CAJERA' (son las
-- que ya existen y hacen ese trabajo). Esto no toca
-- asistentes.usuario_id — el vínculo con el roster de comisiones
-- queda intacto aunque la cuenta pase a CAJERA, así que promover a
-- alguien puntual de vuelta a ASISTENTE después (con un UPDATE
-- aparte) reconecta todo solo, sin migración extra.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. usuarios.rol admite el tercer valor
-- ---------------------------------------------------------
alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
  check (rol in ('ADMINISTRADOR', 'CAJERA', 'ASISTENTE'));

-- ---------------------------------------------------------
-- 2. Renombrar las cuentas existentes
-- ---------------------------------------------------------
update public.usuarios set rol = 'CAJERA' where rol = 'ASISTENTE';

-- ---------------------------------------------------------
-- 3. Ventas/Historial — visibilidad de mismo-día era de "ASISTENTE",
-- ahora es de "CAJERA" (versión viva: 11_confirmar_visibilidad_ventas.sql)
-- ---------------------------------------------------------
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas
  for select to authenticated
  using (
    public.es_admin()
    or (public.rol_actual() = 'CAJERA' and public.es_hoy(fecha))
  );

drop policy if exists venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items
  for select to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          public.es_admin()
          or (public.rol_actual() = 'CAJERA' and public.es_hoy(v.fecha))
        )
    )
  );

-- ---------------------------------------------------------
-- 4. anular_venta(): el límite de "solo ventas de hoy" para no-admin
-- era de ASISTENTE, ahora es de CAJERA (versión viva:
-- 49_atenciones_en_ventas_y_descuento.sql — mismo cuerpo, un solo
-- cambio en la comparación de rol)
-- ---------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select estado, fecha into v_estado, v_fecha
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
end;
$$;

-- ---------------------------------------------------------
-- 5. Funciones de comisiones — "u.rol = 'ASISTENTE'" pasa a
-- "u.rol <> 'ADMINISTRADOR'": da el mismo resultado hacia adelante
-- (CAJERA ya no puede escribir en registro_servicios, sin acceso a Mi
-- Panel), pero no pierde datos históricos de gente cuyo rol cambió de
-- nombre en el paso 2.
-- ---------------------------------------------------------
create or replace function public.resumen_asistentes_periodo(p_desde timestamptz, p_hasta timestamptz)
returns table (
  usuario_id uuid,
  nombre text,
  servicios bigint,
  monto numeric,
  comision numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.usuario_id,
    u.nombre_completo as nombre,
    count(*) as servicios,
    coalesce(sum(r.precio), 0) as monto,
    coalesce(sum(r.pago_asistente), 0) as comision
  from public.registro_servicios r
  join public.usuarios u on u.id = r.usuario_id
  where r.fecha >= p_desde and r.fecha < p_hasta
    and r.estado <> 'CANCELADO'
    and u.rol <> 'ADMINISTRADOR'
  group by r.usuario_id, u.nombre_completo
$$;

create or replace function public.resumen_estadisticas(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_incluir_detalle boolean default true
)
returns table (
  ingreso_bruto numeric,
  cantidad_ventas bigint,
  costo_productos numeric,
  comisiones_pagadas numeric,
  tendencia jsonb,
  top_productos jsonb,
  top_servicios jsonb,
  metodos_pago jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ventas_periodo as (
    select v.id, v.fecha, v.total, v.metodo_pago
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.nombre, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol <> 'ADMINISTRADOR'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  ),
  costo_total as (
    select coalesce(sum(pv.costo * i.cantidad), 0) as costo
    from items_periodo i
    join public.productos_vista pv on pv.id = i.producto_id
    where i.tipo = 'PRODUCTO'
  ),
  tendencia_dias as (
    select (fecha at time zone 'America/Lima')::date as dia, coalesce(sum(total), 0) as monto
    from ventas_periodo
    group by 1
  ),
  top_prod as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'PRODUCTO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  top_serv as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'SERVICIO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  metodos as (
    select metodo_pago as metodo, count(*) as cantidad, coalesce(sum(total), 0) as monto
    from ventas_periodo
    group by metodo_pago
  )
  select
    coalesce((select sum(total) from ventas_periodo), 0) as ingreso_bruto,
    (select count(*) from ventas_periodo) as cantidad_ventas,
    (select costo from costo_total) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('fecha', dia, 'monto', monto) order by dia) from tendencia_dias),
        '[]'::jsonb
      )
    else '[]'::jsonb end as tendencia,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_prod),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_productos,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_serv),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_servicios,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)) from metodos),
        '[]'::jsonb
      )
    else '[]'::jsonb end as metodos_pago
$$;

create or replace function public.resumen_dashboard(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_productos numeric,
  ingreso_servicios numeric,
  costo_productos numeric,
  comisiones_pagadas numeric,
  descuentos numeric,
  productos_vendidos bigint,
  servicios_realizados bigint,
  cantidad_ventas bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ventas_periodo as (
    select v.id, v.total
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol <> 'ADMINISTRADOR'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  )
  select
    coalesce(sum(subtotal) filter (where tipo = 'PRODUCTO'), 0) as ingreso_productos,
    coalesce(sum(subtotal) filter (where tipo = 'SERVICIO'), 0) as ingreso_servicios,
    coalesce(
      (select sum(pv.costo * i.cantidad)
         from items_periodo i
         join public.productos_vista pv on pv.id = i.producto_id
        where i.tipo = 'PRODUCTO'),
      0
    ) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    coalesce(
      (select sum(subtotal) from items_periodo) - (select coalesce(sum(total), 0) from ventas_periodo),
      0
    ) as descuentos,
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas
  from items_periodo
$$;

-- ---------------------------------------------------------
-- 6. Citas — cajera y asistente ven/gestionan TODAS las citas, no
-- solo las propias (versión viva de las políticas: 47_citas.sql).
-- citas_delete_admin queda igual (admin-only).
-- ---------------------------------------------------------
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas
  for insert to authenticated
  with check (public.rol_actual() is not null);

drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas
  for update to authenticated
  using (public.rol_actual() is not null)
  with check (public.rol_actual() is not null);

-- ---------------------------------------------------------
-- 7. completar_cita(): se quita el chequeo de "la cita es tuya" (mismo
-- criterio que arriba) — versión viva: 54_citas_multiples_servicios.sql,
-- mismo cuerpo salvo ese bloque.
-- ---------------------------------------------------------
create or replace function public.completar_cita(
  p_cita_id     uuid,
  p_items       jsonb,
  p_cliente_id  uuid,
  p_fecha       timestamptz,
  p_nota        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita          record;
  v_item          jsonb;
  v_cita_servicio_id uuid;
  v_servicio_id   uuid;
  v_precio        numeric;
  v_registro_id   uuid;
  v_ids           jsonb := '[]'::jsonb;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null then
    raise exception 'La cita no existe';
  end if;

  if v_cita.estado in ('COMPLETADA', 'CANCELADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La cita no tiene servicios para completar';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cita_servicio_id := (v_item->>'cita_servicio_id')::uuid;
    v_precio := (v_item->>'precio')::numeric;

    if v_precio is null or v_precio < 0 then
      raise exception 'Precio inválido';
    end if;

    select servicio_id into v_servicio_id
    from public.cita_servicios
    where id = v_cita_servicio_id and cita_id = p_cita_id
    for update;

    if not found then
      raise exception 'Servicio de la cita no encontrado';
    end if;

    insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio, fecha, nota)
    values (auth.uid(), v_servicio_id, p_cliente_id, v_precio, coalesce(p_fecha, v_cita.fecha_hora), p_nota)
    returning id into v_registro_id;

    update public.cita_servicios
    set registro_servicio_id = v_registro_id
    where id = v_cita_servicio_id;

    v_ids := v_ids || to_jsonb(v_registro_id);
  end loop;

  update public.citas
  set estado = 'COMPLETADA'
  where id = p_cita_id;

  return v_ids;
end;
$$;

commit;
