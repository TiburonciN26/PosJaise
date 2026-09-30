-- =========================================================
-- POS Negocio 2 — Fase 5: plantillas de gastos fijos recurrentes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- gastos_recurrentes: catálogo de plantillas (Local, Internet...),
-- NO son gastos de un mes en concreto. "Generar gastos fijos del
-- mes" las lee y crea una fila real en "gastos" por cada una.
--
-- El índice único parcial evita que el mismo gasto fijo quede
-- duplicado en el mismo mes/año (los variables no se restringen,
-- pueden repetirse — se cargan a mano cada vez).
-- =========================================================

begin;

create table public.gastos_recurrentes (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  monto  numeric(10, 2) not null default 0,
  activo boolean not null default true
);

alter table public.gastos_recurrentes enable row level security;

grant select, insert, update, delete on public.gastos_recurrentes to authenticated;

create policy gastos_recurrentes_admin_todo on public.gastos_recurrentes
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create unique index gastos_fijo_mes_anio_unique
  on public.gastos (nombre, mes, anio)
  where tipo = 'FIJO';

commit;
