-- =========================================================
-- POS Negocio 2 — Fase 4: fix de zona horaria en es_hoy()
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Bug real: es_hoy() comparaba "ts::date = now()::date" usando
-- la zona horaria de la SESIÓN de Postgres (UTC por defecto),
-- no la hora de Perú (UTC-5). Como Perú va 5 horas detrás de UTC,
-- cualquier venta hecha después de las ~7pm hora Perú ya cae en
-- el día SIGUIENTE en UTC — haciendo que la asistente (limitada
-- a es_hoy()) dejara de ver ventas de la tarde/mañana del mismo
-- día real, mientras el admin (que no pasa por es_hoy) sí las veía.
--
-- Esto también afecta anular_venta(), que usa es_hoy() para
-- limitar a la asistente a anular solo ventas de hoy — se
-- corrige automáticamente al arreglar esta función, sin tocar
-- esa función aparte.
-- =========================================================

begin;

create or replace function public.es_hoy(ts timestamptz)
returns boolean
language sql
stable
as $$
  select (ts at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date;
$$;

commit;
