-- =========================================================
-- POS Negocio 2 — Fase 6: comisión snapshot en Mi Panel
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Igual que venta_items (porcentaje_aplicado/pago_asistente),
-- registro_servicios ahora guarda un snapshot del % de la
-- asistente y su pago calculado al momento de registrar/editar
-- la atención. Quedan NULL si no había % asignado en ese
-- momento (no se asume 0, para distinguir "sin dato" de "0%").
-- =========================================================

begin;

alter table public.registro_servicios
  add column porcentaje_aplicado numeric(5, 2),
  add column pago_asistente numeric(10, 2);

commit;
