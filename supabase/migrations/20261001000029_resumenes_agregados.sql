-- =========================================================
-- POS Negocio 2 — M2 de la auditoría: paginación real en
-- Historial/Inventario/Clientes.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Al paginar esas listas (traer solo N filas por página en vez
-- de la tabla entera), los totales que se mostraban arriba
-- (Total recaudado, Bajo stock, Valor de inventario, etc.) ya
-- no se pueden calcular sumando el array cargado en el
-- navegador — solo reflejarían la página visible, no el total
-- real del período/catálogo. Estas dos funciones hacen la suma
-- en Postgres (SUM/COUNT), devuelven un solo resultado chico,
-- y no dependen de cuántas filas haya.
--
-- security invoker (no definer): corren con los permisos del
-- que llama, así que respetan las mismas políticas RLS que ya
-- aplican si el usuario consultara las tablas directamente
-- (asistente ve ventas de hoy nada más; costo/ganancias vía
-- productos_vista se enmascara solo para no-admin igual que hoy).
-- =========================================================

-- El filtro "Bajo stock" compara stock_actual contra stock_minimo — dos
-- columnas de la misma fila. PostgREST no permite comparar columna contra
-- columna en un filtro (solo columna contra un valor literal), así que se
-- expone ya calculado como booleano en la vista para poder filtrar con
-- .eq('stock_bajo', true) desde el cliente.
create or replace view public.productos_vista
with (security_invoker = false)
as
select
  id,
  codigo_barras,
  nombre,
  categoria,
  precio,
  case when public.es_admin() then costo end as costo,
  stock_actual,
  stock_minimo,
  proveedor,
  foto_url,
  activo,
  (stock_actual > 0 and stock_actual <= stock_minimo) as stock_bajo,
  (stock_actual <= 0) as sin_stock
from public.productos;

grant select on public.productos_vista to authenticated;

create or replace function public.resumen_historial(p_desde timestamptz, p_hasta timestamptz)
returns table (
  cantidad_ventas bigint,
  total_recaudado numeric,
  productos_vendidos bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.ventas v
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta) as cantidad_ventas,
    (select coalesce(sum(v.total), 0) from public.ventas v
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta) as total_recaudado,
    (select coalesce(sum(vi.cantidad), 0) from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
      where vi.tipo = 'PRODUCTO' and v.estado = 'ACTIVA'
        and v.fecha >= p_desde and v.fecha < p_hasta) as productos_vendidos
$$;

grant execute on function public.resumen_historial(timestamptz, timestamptz) to authenticated;

-- Incluye "categorias" (lista de categorías distintas ya usadas) para que el
-- selector de categoría del modal de producto no dependa de tener cargada
-- toda la tabla en el navegador — antes salía de productos.map(...) sobre el
-- array completo.
create or replace function public.resumen_inventario()
returns table (
  total bigint,
  bajo_stock bigint,
  sin_stock bigint,
  valor_total numeric,
  ganancias numeric,
  capital_invertido numeric,
  categorias text[]
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) as total,
    count(*) filter (where stock_bajo) as bajo_stock,
    count(*) filter (where sin_stock) as sin_stock,
    coalesce(sum(precio * stock_actual), 0) as valor_total,
    coalesce(sum((precio - coalesce(costo, 0)) * stock_actual), 0) as ganancias,
    coalesce(sum(coalesce(costo, 0) * stock_actual), 0) as capital_invertido,
    (select coalesce(array_agg(distinct categoria order by categoria), array[]::text[])
       from public.productos_vista where categoria is not null) as categorias
  from public.productos_vista
$$;

grant execute on function public.resumen_inventario() to authenticated;
