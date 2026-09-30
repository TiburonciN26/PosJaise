-- =========================================================
-- Migración 2/8 del rediseño de Productos/Detalle: descripción y los
-- datos clave del Detalle que faltaban (Contenido, Rinde), más
-- frecuencia de uso y hasta cuándo dura la oferta.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- `oferta_hasta` es solo informativo (texto para la clienta, "Precio de
-- oferta hasta el DD/MM") — nada la vence sola; si se quiere que el
-- precio_antes se limpie automáticamente al vencer, hace falta un cron
-- aparte, fuera de esta migración.
-- =========================================================

begin;

alter table public.productos add column if not exists descripcion text;
alter table public.productos add column if not exists contenido text;
alter table public.productos add column if not exists rinde text;
alter table public.productos add column if not exists frecuencia text;
alter table public.productos add column if not exists oferta_hasta date;

grant select (descripcion, contenido, rinde, frecuencia, oferta_hasta) on public.productos to authenticated;

commit;
