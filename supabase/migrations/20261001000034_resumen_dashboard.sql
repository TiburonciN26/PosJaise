-- =========================================================
-- POS Negocio 2 — A3 de la 3ª auditoría: Dashboard era la
-- última pantalla de agregación sin server-side (M3 de la 2ª
-- auditoría solo cubrió Estadísticas). Traía TODAS las ventas
-- del período con venta_items embebidos + una consulta extra a
-- productos_vista, solo para sumar en el navegador.
--
-- Este RPC devuelve los 6 escalares que Dashboard necesita
-- (Estadísticas no los pide separados por tipo, por eso no se
-- reutiliza resumen_estadisticas). Mismo criterio que los demás:
-- security invoker respeta RLS, y el costo llega vía
-- productos_vista (enmascarado a null para no-admin — Dashboard
-- es una pantalla exclusiva de ADMINISTRADOR de todas formas).
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

create or replace function public.resumen_dashboard(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_productos numeric,
  ingreso_servicios numeric,
  costo_productos numeric,
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
    select v.id
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
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
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas
  from items_periodo
$$;

grant execute on function public.resumen_dashboard(timestamptz, timestamptz) to authenticated;
