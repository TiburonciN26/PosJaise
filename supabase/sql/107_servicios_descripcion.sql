-- =========================================================
-- Migración 1/10 del rediseño de Servicios/Detalle (docs/diseno-servicios/
-- README.md, "Backend que falta"): descripción propia por servicio.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Hoy el hero de Servicios y el párrafo del Detalle usan un texto
-- genérico armado solo con la categoría ("Uno de nuestros servicios de
-- Cabello más solicitados...") porque no había ningún campo de texto
-- propio del servicio. Con esta columna, ModalServicio.jsx (POS) deja
-- escribir una descripción real y el portal cliente la usa si existe,
-- cayendo al texto genérico solo cuando sigue vacía (servicios viejos,
-- todavía no editados).
--
-- Grant: `servicios` ya tiene SELECT/INSERT/UPDATE/DELETE a nivel de
-- TABLA completa para `authenticated` (04_grants.sql) — a diferencia de
-- `productos`, que los otorga por columna (ver 106_grant_select_precio_
-- antes.sql). Por eso un ALTER TABLE ADD COLUMN acá alcanza solo, sin un
-- GRANT explícito aparte.
-- =========================================================

begin;

alter table public.servicios add column if not exists descripcion text;

commit;
