-- =========================================================
-- Migración 9/10 del rediseño de Servicios/Detalle: adelanto mínimo y
-- plazo de cancelación configurables (hoy hardcodeados como [S/ X] y
-- [24 h] en el Detalle del servicio).
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Van en `estado_negocio` (singleton, ya usado para horario/contacto/
-- pagos — 44_estado_negocio.sql) y no en `servicios`: son una política
-- del NEGOCIO completo, no de un servicio puntual. `estado_negocio` ya
-- tiene GRANT de tabla completa a `authenticated` y su policy de SELECT
-- ya deja pasar a clientes web (105_estado_negocio_select_clientes.sql),
-- así que no hace falta nada más de RLS/grants.
--
-- adelanto_minimo null = el negocio no puso un mínimo propio todavía (el
-- Detalle sigue mostrando el placeholder [S/ X] hasta que se cargue).
-- =========================================================

begin;

alter table public.estado_negocio add column if not exists adelanto_minimo numeric(10, 2) check (adelanto_minimo is null or adelanto_minimo > 0);
alter table public.estado_negocio add column if not exists cancelacion_plazo_horas int check (cancelacion_plazo_horas is null or cancelacion_plazo_horas > 0);

commit;
