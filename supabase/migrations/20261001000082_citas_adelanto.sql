-- =========================================================
-- POS Negocio 2 — Adelanto/abono en Citas
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Un cliente puede dejar un adelanto (abono) al agendar su cita.
-- Es solo un dato informativo de la cita en sí — no toca ventas ni
-- registro_servicios, ni se descuenta de nada automáticamente al
-- completar (eso lo maneja quien cobra, a mano, igual que hoy).
-- =========================================================

begin;

alter table public.citas
  add column if not exists adelanto numeric(10, 2) null
    check (adelanto is null or adelanto >= 0);

commit;
