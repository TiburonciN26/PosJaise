-- =========================================================
-- POS Negocio 2 — B6 de la 4ª auditoría: gastos.anio no tenía
-- CHECK en la base. ModalGasto.jsx valida "anio >= 2000" en el
-- formulario, pero eso es solo la UI — por la API directa se
-- podía insertar cualquier entero (negativo, año 30000, etc.).
-- Mismo rango 2000-2100 que ya valida el modal, con margen hacia
-- adelante.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

alter table public.gastos
  add constraint gastos_anio_check check (anio between 2000 and 2100);
