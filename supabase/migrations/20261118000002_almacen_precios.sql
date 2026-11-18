-- Almacén: columnas «Precio» y «Total» en la tabla de la pestaña (pedido de la dueña, 2026-11-18).
--
-- Los artículos no guardan un precio propio: lo que costó cada cosa vive en los INGRESOS (almacen_movimientos.costo_total,
-- desde 20261118 se anota por precio unitario y el total se calcula). Esta función da, por artículo, el precio unitario
-- del ÚLTIMO ingreso (costo_total / cantidad): «lo que nos costó la última vez que compramos». El total de la tabla es
-- stock_actual × ese precio, y se calcula en el front.
--
-- Por qué una función y no una vista o una columna:
--   * almacen_movimientos no tiene GRANT ni políticas (20261112000011): los costos solo los ve la administradora, y solo
--     a través de funciones security definer. Esta sigue el mismo criterio que historial_almacen_articulo(): al resto del
--     personal no le devuelve filas.
--   * Calcularlo al vuelo evita otra columna en almacen_articulos que habría que mantener al día en cada ingreso (y que
--     llenaría Auditoría de ruido).
-- Usa el índice almacen_movimientos_articulo_fecha (articulo_id, fecha desc) para el DISTINCT ON.

begin;

create or replace function public.precios_almacen()
returns table (articulo_id uuid, precio_unitario numeric, fecha_ultimo_ingreso timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (m.articulo_id)
         m.articulo_id,
         m.costo_total / m.cantidad,
         m.fecha
  from public.almacen_movimientos m
  where public.es_admin()
    and m.tipo = 'INGRESO'
    and m.costo_total is not null
    and m.cantidad > 0
  order by m.articulo_id, m.fecha desc;
$$;

revoke execute on function public.precios_almacen() from public, anon;
grant execute on function public.precios_almacen() to authenticated;

commit;
