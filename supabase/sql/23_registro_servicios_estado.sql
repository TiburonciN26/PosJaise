-- =========================================================
-- POS Negocio 2 — Fase 6: cancelar (no eliminar) en Mi Panel
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Agrega estado ACTIVO/CANCELADO a registro_servicios, igual
-- criterio que ventas.estado. Un registro CANCELADO no se borra
-- y no cuenta en ningún total, pero queda visible para trazar
-- qué pasó.
--
-- RLS: la política única anterior (registro_servicios_acceso)
-- permitía DELETE a cualquier dueño de la fila. Ahora se separa:
-- SELECT/INSERT/UPDATE siguen abiertos a admin o dueño (dueño
-- necesita UPDATE para poder cancelar), pero DELETE queda
-- exclusivo del administrador — la asistente ya no puede borrar,
-- solo cancelar.
-- =========================================================

begin;

alter table public.registro_servicios
  add column estado text not null default 'ACTIVO' check (estado in ('ACTIVO', 'CANCELADO'));

drop policy if exists registro_servicios_acceso on public.registro_servicios;

create policy registro_servicios_select on public.registro_servicios
  for select to authenticated
  using (public.es_admin() or usuario_id = auth.uid());

create policy registro_servicios_insert on public.registro_servicios
  for insert to authenticated
  with check (public.es_admin() or usuario_id = auth.uid());

create policy registro_servicios_update on public.registro_servicios
  for update to authenticated
  using (public.es_admin() or usuario_id = auth.uid())
  with check (public.es_admin() or usuario_id = auth.uid());

create policy registro_servicios_delete_admin on public.registro_servicios
  for delete to authenticated
  using (public.es_admin());

commit;
