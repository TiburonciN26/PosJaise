-- =========================================================
-- POS Negocio 2 — Bug: cita_servicios seguía con la RLS vieja
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 56_rol_cajera_asistente.sql ya se haya corrido.
--
-- 56_ abrió citas_select/insert/update a cualquier cuenta activa, pero
-- se quedaron afuera las políticas de cita_servicios (la tabla de
-- líneas), que seguían exigiendo "sos admin o la cita es tuya". Por
-- eso una cajera podía crear la fila en citas (pasaba la RLS de citas)
-- pero el insert de sus servicios se rechazaba silenciosamente al
-- agendarle una cita a otra persona (ej. a un admin) — la cita quedaba
-- creada PERO sin ningún servicio adentro, y el modal mostraba
-- "no se pudieron guardar los servicios, intenta de nuevo".
-- =========================================================

begin;

drop policy if exists cita_servicios_select on public.cita_servicios;
create policy cita_servicios_select on public.cita_servicios
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists cita_servicios_insert on public.cita_servicios;
create policy cita_servicios_insert on public.cita_servicios
  for insert to authenticated
  with check (public.rol_actual() is not null);

drop policy if exists cita_servicios_update on public.cita_servicios;
create policy cita_servicios_update on public.cita_servicios
  for update to authenticated
  using (public.rol_actual() is not null)
  with check (public.rol_actual() is not null);

drop policy if exists cita_servicios_delete on public.cita_servicios;
create policy cita_servicios_delete on public.cita_servicios
  for delete to authenticated
  using (public.rol_actual() is not null);

commit;
