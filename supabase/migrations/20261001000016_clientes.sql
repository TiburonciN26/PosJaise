-- =========================================================
-- POS Negocio 2 — Fase 5: directorio de clientes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Solo ADMINISTRADOR por ahora (mismo criterio que gastos y
-- porcentajes: FOR ALL con es_admin()). La conexión con Ventas
-- y Mi Panel se hace en un paso posterior.
-- =========================================================

begin;

create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  dni        text,
  cumpleanos date,
  notas      text
);

alter table public.clientes enable row level security;

grant select, insert, update, delete on public.clientes to authenticated;

create policy clientes_admin_todo on public.clientes
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

commit;
