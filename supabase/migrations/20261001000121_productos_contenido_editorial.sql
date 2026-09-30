-- =========================================================
-- Migración 5/8 del rediseño de Productos/Detalle: contenido editorial
-- del Detalle — modo de uso, ideal para / tips, ingredientes clave y
-- libre de. Mismo criterio que 113_servicios_pasos_specs_cuidados.sql:
-- todo jsonb, se edita entero desde ModalProducto.jsx, no se consulta ni
-- filtra fila por fila.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Formas esperadas (las arma/lee el frontend, sin validación de forma en
-- la base):
--   especificaciones: [{ clave, valor }]        (ej. Marca, Tipo de cabello, Aroma, Vence, Registro sanitario)
--   modo_uso:         [{ nombre, texto }]        (pasos numerados: Lava, Aplica, Deja actuar, Enjuaga)
--   ideal_para:       ["texto", "texto", ...]
--   tips:             ["texto", "texto", ...]
--   ingredientes:     [{ nombre, texto }]
--   libre_de:         ["Sulfatos", "Parabenos", ...]
-- =========================================================

begin;

alter table public.productos add column if not exists especificaciones jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists modo_uso jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists ideal_para jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists tips jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists ingredientes jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists libre_de jsonb not null default '[]'::jsonb;

grant select (especificaciones, modo_uso, ideal_para, tips, ingredientes, libre_de) on public.productos to authenticated;

commit;
