-- =========================================================
-- POS Negocio 2 — Fase 5: campos adicionales de asistentes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- La tabla asistentes solo tenía nombres_completos, telefono y
-- activo. Se agregan email, dirección, contacto de emergencia,
-- cumpleaños y fecha de ingreso — todos opcionales (igual que
-- telefono, que ya era opcional desde el inicio).
-- =========================================================

begin;

alter table public.asistentes
  add column email text,
  add column direccion text,
  add column contacto_emergencia text,
  add column cumpleanos date,
  add column fecha_ingreso date;

commit;
