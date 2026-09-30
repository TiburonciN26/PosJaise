-- =========================================================
-- Migración 1/8 del rediseño de Productos/Detalle (docs/diseno-productos/
-- README.md): "Destacado", "Nuevo", "Novedades y lo más vendido" (inicio)
-- y la etiqueta de subcategoría de la tarjeta — los 4 se marcan A MANO
-- desde el POS (ModalProducto.jsx), decisión confirmada con el usuario
-- (mismo criterio que servicios.en_tendencia, migración 108).
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Ojo: `productos` da SELECT por columna (para ocultar `costo`, ver
-- 03_rls.sql) — cada columna nueva necesita su propio
-- `grant select (col) on productos to authenticated`, si no la primera
-- consulta que la pida responde 403 ENTERA (ver CLAUDE.md y el fix real
-- de 106_grant_select_precio_antes.sql).
-- =========================================================

begin;

alter table public.productos add column if not exists destacado boolean not null default false;
alter table public.productos add column if not exists nuevo boolean not null default false;
alter table public.productos add column if not exists en_inicio boolean not null default false;
alter table public.productos add column if not exists subcategoria text;

grant select (destacado, nuevo, en_inicio, subcategoria) on public.productos to authenticated;

commit;
