-- =========================================================
-- POS Negocio 2 — "Agendado por" visible para cualquier rol en Citas
-- Ejecutar en Supabase → SQL Editor → New query
--
-- El nombre de quien agendó (creado_por) y el nombre de asistente-de-respaldo
-- (cuando la cita no tiene asistente_id) se traían con el embed
-- `usuarios(nombre_completo)` de PostgREST, que respeta la RLS de
-- `usuarios` (id = auth.uid() or es_admin()) — por eso solo la propia
-- persona que creó la cita (o un admin) veía ese nombre; cualquier otra
-- cuenta veía el campo vacío. Mismo patrón que 57_asistentes_para_citas.sql:
-- una función security definer que expone solo lo necesario (id + nombre)
-- sin abrir toda la tabla usuarios (que sí tiene email y rol, más sensibles).
-- =========================================================

begin;

create or replace function public.usuarios_para_citas()
returns table (id uuid, nombre_completo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.nombre_completo
  from public.usuarios u
  where u.activo = true
  order by u.nombre_completo;
$$;

grant execute on function public.usuarios_para_citas() to authenticated;

commit;
