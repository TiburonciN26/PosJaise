-- =========================================================
-- Inventario: «Últimos agregados» — fecha del último ingreso de cada producto.
--
-- Hasta ahora `productos` no guardaba cuándo se creó cada ficha y su id es uuid, así que no había forma de ordenar
-- «lo más reciente primero». Un producto «agregado» puede ser de dos maneras: una ficha nueva, o una ficha existente
-- a la que se le sumó stock (cada alta queda en `movimientos_stock`, ver `agregar_stock`). `ultimo_ingreso` es la más
-- reciente de las dos fechas.
--
--  1. `productos.creado_en`: default now() para las fichas NUEVAS. Las existentes quedan en null a propósito (no se
--     sabe cuándo se crearon; inventar una fecha las mezclaría con las realmente nuevas). Si tienen movimientos de
--     stock, su `ultimo_ingreso` sale de ahí; si no, quedan al final de la lista hasta que reciban stock.
--  2. `productos` concede SELECT por columna (ver CLAUDE.md), así que la columna nueva necesita su grant explícito.
--  3. Índice (producto_id, fecha desc) para que el max(fecha) por producto de la vista no recorra todo el historial.
--  4. `productos_vista` = definición de la migración 124 SIN cambios + `ultimo_ingreso` al final (create or replace
--     view solo permite agregar columnas al final). `greatest` ignora los null; si ambos faltan, devuelve null.
-- =========================================================

begin;

-- Dos pasos a propósito: `add column ... default now()` rellenaría TODAS las filas existentes con la fecha de esta
-- migración (Postgres aplica el default a lo ya guardado) y taparía el último movimiento real de cada producto.
alter table public.productos add column if not exists creado_en timestamptz;
alter table public.productos alter column creado_en set default now();

grant select (creado_en) on public.productos to authenticated;

create index if not exists idx_movimientos_producto_fecha
  on public.movimientos_stock (producto_id, fecha desc);

create or replace view public.productos_vista as
select
  p.id,
  p.codigo_barras,
  p.nombre,
  p.categoria,
  p.precio,
  case
    when es_admin() then p.costo
    else null::numeric
  end as costo,
  p.stock_actual,
  p.stock_minimo,
  p.proveedor,
  p.foto_url,
  p.activo,
  p.stock_actual > 0 and p.stock_actual <= p.stock_minimo as stock_bajo,
  p.stock_actual <= 0 as sin_stock,
  p.precio_antes,
  p.destacado,
  p.nuevo,
  p.en_inicio,
  p.subcategoria,
  p.descripcion,
  p.contenido,
  p.rinde,
  p.frecuencia,
  p.oferta_hasta,
  p.especificaciones,
  p.modo_uso,
  p.ideal_para,
  p.tips,
  p.ingredientes,
  p.libre_de,
  p.combo_con,
  greatest(
    p.creado_en,
    (select max(m.fecha) from public.movimientos_stock m where m.producto_id = p.id)
  ) as ultimo_ingreso
from public.productos p;

commit;
