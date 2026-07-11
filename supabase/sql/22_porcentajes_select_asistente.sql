-- =========================================================
-- POS Negocio 2 — Fase 6: fix RLS de porcentajes para asistentes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- porcentajes_admin_todo (FOR ALL con es_admin()) bloqueaba a la
-- propia asistente de leer SU % al registrar una atención en Mi
-- Panel: Supabase no devuelve error, solo 0 filas, por eso el
-- modal mostraba "sin porcentaje asignado" aunque el dato existía.
--
-- Se separa en SELECT (admin ve todo; cada asistente ve solo sus
-- propias filas, vía asistentes.usuario_id = auth.uid()) e
-- INSERT/UPDATE/DELETE que siguen siendo admin-only — la vista
-- Porcentajes no cambia, sigue siendo de gestión exclusiva del
-- administrador.
-- =========================================================

begin;

drop policy if exists porcentajes_admin_todo on public.porcentajes;

create policy porcentajes_select on public.porcentajes
  for select to authenticated
  using (
    public.es_admin()
    or asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
  );

create policy porcentajes_insert_admin on public.porcentajes
  for insert to authenticated
  with check (public.es_admin());

create policy porcentajes_update_admin on public.porcentajes
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy porcentajes_delete_admin on public.porcentajes
  for delete to authenticated
  using (public.es_admin());

commit;
