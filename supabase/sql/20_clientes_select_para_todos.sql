-- =========================================================
-- POS Negocio 2 — Fase 6: clientes visibles para todos (lectura)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- La política anterior (clientes_admin_todo) solo dejaba ver
-- clientes al administrador, así que una asistente no podía
-- seleccionar clientes al "Registrar atención" en Mi Panel.
--
-- Se separa en el mismo patrón que productos/servicios: SELECT
-- para cualquier usuario autenticado, y INSERT/UPDATE/DELETE
-- solo para el administrador (la vista Clientes sigue siendo
-- admin-only, eso no cambia — solo la lectura se abre).
-- =========================================================

begin;

drop policy if exists clientes_admin_todo on public.clientes;

create policy clientes_select on public.clientes
  for select to authenticated
  using (true);

create policy clientes_insert_admin on public.clientes
  for insert to authenticated
  with check (public.es_admin());

create policy clientes_update_admin on public.clientes
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy clientes_delete_admin on public.clientes
  for delete to authenticated
  using (public.es_admin());

commit;
