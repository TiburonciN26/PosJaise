-- =========================================================
-- Migración 7/10 del rediseño de Servicios/Detalle: contenido editorial
-- por servicio — pasos, especificaciones, herramientas, materiales y
-- cuidados antes/después. Todo jsonb (README lo sugería como jsonb en
-- `servicios` o tablas aparte; se eligió jsonb: es contenido que se edita
-- entero desde ModalServicio.jsx, no se consulta ni filtra fila por
-- fila).
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Formas esperadas (las arma/lee el frontend, sin validación de forma en
-- la base — mismo criterio que el resto de columnas de texto libre):
--   pasos:             [{ nombre, minutos, texto }]
--   especificaciones:  [{ clave, valor }]
--   herramientas:      [{ nombre, descripcion }]
--   materiales:        [{ nombre, descripcion }]
--   cuidados_antes:    ["texto", "texto", ...]
--   cuidados_despues:  ["texto", "texto", ...]
-- =========================================================

begin;

alter table public.servicios add column if not exists pasos jsonb not null default '[]'::jsonb;
alter table public.servicios add column if not exists especificaciones jsonb not null default '[]'::jsonb;
alter table public.servicios add column if not exists herramientas jsonb not null default '[]'::jsonb;
alter table public.servicios add column if not exists materiales jsonb not null default '[]'::jsonb;
alter table public.servicios add column if not exists cuidados_antes jsonb not null default '[]'::jsonb;
alter table public.servicios add column if not exists cuidados_despues jsonb not null default '[]'::jsonb;

commit;
