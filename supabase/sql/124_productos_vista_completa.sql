-- =========================================================
-- Migración 8/8 del rediseño de Productos/Detalle: `productos_vista`
-- (03_rls.sql/104_precio_antes_productos.sql) reconstruida con todas las
-- columnas nuevas de 117/118/121/122 — Inventario.jsx y el resto del POS
-- leen el catálogo desde esta vista, no de la tabla cruda, así que una
-- columna que no esté acá no se ve del lado del personal aunque el
-- GRANT de la tabla ya la deje leer.
--
-- `create or replace view` no puede reordenar columnas existentes, solo
-- agregar al final — por eso todo lo nuevo va después de `precio_antes`
-- (la última que había), no intercalado por tema.
-- =========================================================

begin;

create or replace view public.productos_vista as
select
  id,
  codigo_barras,
  nombre,
  categoria,
  precio,
  case
    when es_admin() then costo
    else null::numeric
  end as costo,
  stock_actual,
  stock_minimo,
  proveedor,
  foto_url,
  activo,
  stock_actual > 0 and stock_actual <= stock_minimo as stock_bajo,
  stock_actual <= 0 as sin_stock,
  precio_antes,
  destacado,
  nuevo,
  en_inicio,
  subcategoria,
  descripcion,
  contenido,
  rinde,
  frecuencia,
  oferta_hasta,
  especificaciones,
  modo_uso,
  ideal_para,
  tips,
  ingredientes,
  libre_de,
  combo_con
from public.productos;

commit;
