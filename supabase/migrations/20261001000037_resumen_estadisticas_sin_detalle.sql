-- =========================================================
-- POS Negocio 2 — B5 de la 3ª auditoría: Estadísticas llama a
-- resumen_estadisticas() dos veces por carga (período actual +
-- anterior), pero el período ANTERIOR solo se usa para los 4 KPIs
-- comparativos (ingreso, ganancia, cantidad, ticket) — la
-- tendencia diaria, el top 5 de productos/servicios y los métodos
-- de pago que también calcula se descartan sin usar. Se agrega
-- p_incluir_detalle (default true, no rompe la firma para quien ya
-- la llama sin ese parámetro) — en false, esos 4 GROUP BY no se
-- ejecutan (el CASE evalúa perezoso: la rama no tomada no corre).
-- Redefine la función de 32_resumen_estadisticas.sql agregando un
-- parámetro — un CREATE OR REPLACE con una firma distinta crea una
-- función NUEVA sobrecargada en vez de reemplazar la vieja (en
-- Postgres la identidad de una función incluye sus tipos de
-- parámetro), y con esa de 2 parámetros todavía viva, una llamada
-- con 2 argumentos quedaría ambigua entre ambas. Por eso el DROP
-- explícito antes del CREATE.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

drop function if exists public.resumen_estadisticas(timestamptz, timestamptz);

create or replace function public.resumen_estadisticas(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_incluir_detalle boolean default true
)
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

grant execute on function public.resumen_estadisticas(timestamptz, timestamptz, boolean) to authenticated;
