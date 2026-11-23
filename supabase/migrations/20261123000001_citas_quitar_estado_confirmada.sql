-- =========================================================
-- Citas: se quita el estado CONFIRMADA
--
-- Existía en el CHECK y en las etiquetas, pero ninguna pantalla del POS ni de la web lo asignaba (solo se filtraba por él), así que
-- era un estado fantasma: una cita en CONFIRMADA no tenía botones para cancelarla ni completarla. Queda el ciclo
-- PENDIENTE → COMPLETADA / CANCELADA / NO_ASISTIO.
--   · Las citas que estuvieran en CONFIRMADA pasan a PENDIENTE (es lo más cercano: «por atender»).
--   · El CHECK deja de aceptar CONFIRMADA.
-- citas_sin_comision() sigue mirando ('PENDIENTE','CONFIRMADA'): inofensivo (ya no habrá filas CONFIRMADA); se limpiará cuando
-- esa función se vuelva a tocar por otro motivo.
-- =========================================================

begin;

update public.citas set estado = 'PENDIENTE' where estado = 'CONFIRMADA';

alter table public.citas drop constraint citas_estado_check;
alter table public.citas
  add constraint citas_estado_check
  check (estado in ('PENDIENTE', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'));

commit;
