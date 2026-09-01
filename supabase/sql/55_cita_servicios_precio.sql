-- =========================================================
-- POS Negocio 2 — Precio por servicio agendado en una cita
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 54_citas_multiples_servicios.sql ya se haya corrido.
--
-- El carrito del modal "Nueva cita" ahora también captura un precio por
-- línea (prellenado del catálogo, editable) — antes una cita no llevaba
-- precio en absoluto, solo se pedía al completarla. Guardarlo acá permite
-- que, al completar la cita, se sugiera el precio que se acordó al
-- agendar en vez de siempre el precio actual del catálogo.
-- =========================================================

begin;

alter table public.cita_servicios
  add column if not exists precio numeric(10, 2) null;

alter table public.cita_servicios
  drop constraint if exists cita_servicios_precio_check;

alter table public.cita_servicios
  add constraint cita_servicios_precio_check
    check (precio is null or precio >= 0);

commit;
