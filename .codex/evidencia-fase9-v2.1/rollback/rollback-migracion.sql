-- Reversión de supabase/migrations/20261012000003_migracion_medios_cambio_con_plazo.sql (Fase 9 V2.1).
-- Solo elimina las tres funciones de la herramienta de migración; no toca datos ni tablas. Antes de ejecutarlo, ninguna
-- operación de la herramienta debe quedar abierta en un manifiesto (las abiertas se resuelven con la barrera).
begin;
drop function if exists public.migracion_medios_barrera(text, text, uuid, timestamptz);
drop function if exists public.migracion_medios_cambiar(text, text, uuid, text, text, timestamptz);
drop function if exists public.migracion_medios_columna_permitida(text, text);
commit;
