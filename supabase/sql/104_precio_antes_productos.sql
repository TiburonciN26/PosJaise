-- =========================================================
-- POS Negocio 2 — Productos: precio_antes (precio de oferta)
-- Ejecutar en Supabase → SQL Editor → New query
-- Migración 5 de 5 de Fase 3 del rediseño del carrito
-- (docs/diseno-carrito/README.md) — la última de las planeadas
-- originalmente. `CarritoCliente.jsx` ya tiene TODA la lógica visual
-- lista desde la Fase 1 (etiqueta de %, precio tachado, descuento en
-- el resumen) pero la traía hardcodeada en `null` porque esta columna
-- todavía no existía.
--
-- `productos_vista` (42_... / lint ya preexistente "Security Definer
-- View", no tocado acá) tiene una lista explícita de columnas — hace
-- falta agregar `precio_antes` ahí también, o Inventario (que lee de
-- la vista, no de la tabla) nunca la vería. `create or replace view`
-- puede AGREGAR columnas, pero solo al FINAL de la lista — Postgres
-- compara por posición, no por nombre, así que insertarla entre
-- `precio` y `costo` correría a `costo` un lugar y Postgres lo lee
-- como "le cambiaste el nombre a esa columna" (error real que salió
-- al probar esto tal cual). Va al final de la lista por eso, no por
-- estética.
--
-- No hace falta ningún GRANT nuevo: `authenticated` ya tiene SELECT a
-- nivel de tabla/vista completa (no por columna) desde que se creó
-- `productos`/`productos_vista` — una columna nueva queda cubierta
-- sola (memoria del proyecto: los GRANTs no automáticos aplican a
-- TABLAS nuevas, no a columnas nuevas en una tabla ya otorgada).
-- =========================================================

begin;

alter table public.productos
  add column if not exists precio_antes numeric(10, 2)
    check (precio_antes is null or precio_antes > 0);

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
  precio_antes
from public.productos;

commit;
