-- =========================================================
-- POS Negocio 2 — Fase 5: restricción de tipo en gastos
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Refuerza a nivel de base de datos lo que ahora exige la UI:
-- tipo solo puede ser 'FIJO' o 'VARIABLE' (mismo criterio que
-- ya usamos para rol, estado, metodo_pago, etc.).
-- =========================================================

begin;

alter table public.gastos
  add constraint gastos_tipo_check check (tipo in ('FIJO', 'VARIABLE'));

commit;
