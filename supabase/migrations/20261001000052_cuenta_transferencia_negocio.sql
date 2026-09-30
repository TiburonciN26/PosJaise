-- =========================================================
-- POS Negocio 2 — Cuenta bancaria para transferencias
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 44_estado_negocio.sql ya se haya corrido.
--
-- Mismo patrón que "abierto" en estado_negocio: una fila singleton que
-- todos los dispositivos leen y siguen en tiempo real (Realtime). La
-- diferencia acá es de contenido: el N.° de cuenta/operación que se le
-- muestra al cliente para que transfiera, visible para cualquier usuario
-- autenticado (admin o asistente) pero editable solo por el admin — las
-- políticas de RLS ya existentes sobre estado_negocio (select para
-- cualquiera, update solo admin) cubren la columna nueva sin cambios.
-- =========================================================

begin;

alter table public.estado_negocio
  add column if not exists cuenta_transferencia text null;

commit;
