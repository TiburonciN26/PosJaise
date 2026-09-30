-- =========================================================
-- POS Negocio 2 — Clientes: campo Sexo (Femenino/Masculino)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Opcional (nullable) — el dato no siempre se conoce al registrar un
-- cliente nuevo; el admin lo va completando después editando cada ficha.
-- Un check constraint sobre columna nullable no rechaza NULL (solo valores
-- que no sean ninguna de las dos opciones), así que no hace falta "or
-- sexo is null" aparte.
-- =========================================================

begin;

alter table public.clientes
  add column if not exists sexo text null;

alter table public.clientes
  drop constraint if exists clientes_sexo_check;

alter table public.clientes
  add constraint clientes_sexo_check check (sexo in ('Femenino', 'Masculino'));

commit;
