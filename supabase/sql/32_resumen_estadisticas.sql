-- =========================================================
-- POS Negocio 2 — M3 de la 2ª auditoría: Estadísticas era la
-- única pantalla sin agregación en servidor. resumenPeriodo()
-- traía TODAS las ventas del período con venta_items embebidos,
-- dos veces (período actual + anterior), solo para sumar/agrupar
-- en el navegador (ingreso bruto, costo, tendencia diaria, top
-- productos/servicios, métodos de pago). Con un rango largo
-- (ej. un año personalizado) son dos consultas enormes.
--
-- Un solo RPC hace todas esas sumas/GROUP BY en Postgres (mismo
-- espíritu que resumen_historial/resumen_inventario, M2) y
-- devuelve una fila resumen: los KPIs escalares más 4 arrays
-- jsonb ya agregados (tendencia diaria, top 5 productos, top 5
-- servicios, métodos de pago) — nunca las filas crudas.
--
-- security invoker: respeta RLS igual que si el cliente
-- consultara ventas/venta_items directo, y productos_vista sigue
-- enmascarando "costo" a no-admin vía es_admin() (Estadísticas es
-- una pantalla exclusiva de ADMINISTRADOR, ver config/navegacion.js).
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

create or replace function public.resumen_estadisticas(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_bruto numeric,
  cantidad_ventas bigint,
  costo_productos numeric,
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
  costo_total as (
    select coalesce(sum(pv.costo * i.cantidad), 0) as costo
    from items_periodo i
    join public.productos_vista pv on pv.id = i.producto_id
    where i.tipo = 'PRODUCTO'
  ),
  -- Día calendario en Lima (zona fija UTC-5, sin horario de verano — mismo
  -- criterio que aLima()/OFFSET_LIMA_MS en el cliente).
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
    coalesce(
      (select jsonb_agg(jsonb_build_object('fecha', dia, 'monto', monto) order by dia) from tendencia_dias),
      '[]'::jsonb
    ) as tendencia,
    coalesce(
      (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_prod),
      '[]'::jsonb
    ) as top_productos,
    coalesce(
      (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_serv),
      '[]'::jsonb
    ) as top_servicios,
    coalesce(
      (select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)) from metodos),
      '[]'::jsonb
    ) as metodos_pago
$$;

grant execute on function public.resumen_estadisticas(timestamptz, timestamptz) to authenticated;
