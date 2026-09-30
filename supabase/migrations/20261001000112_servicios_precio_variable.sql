-- =========================================================
-- Migración 6/10 del rediseño de Servicios/Detalle: precio variable (con
-- nota) y cuánto dura el resultado.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

begin;

alter table public.servicios add column if not exists precio_variable boolean not null default false;
alter table public.servicios add column if not exists nota_precio text;
alter table public.servicios add column if not exists duracion_resultado text;

commit;
