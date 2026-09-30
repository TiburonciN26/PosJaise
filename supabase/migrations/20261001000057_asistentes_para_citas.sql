-- =========================================================
-- POS Negocio 2 — Lista de asistentes seleccionables en Citas
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 56_rol_cajera_asistente.sql ya se haya corrido.
--
-- Bug reportado: al agendar una cita, el selector de "Asistente" traía
-- TODAS las filas de asistentes activas, sin importar si la cuenta
-- vinculada seguía siendo CAJERA (una cajera no atiende, ese vínculo
-- quedó de antes de separar los roles). Un no-admin no puede filtrar
-- esto por su cuenta desde el cliente porque la RLS de usuarios no le
-- deja leer el rol de otras cuentas — se resuelve con una función
-- security definer que sí puede mirarlo, sin abrir esa tabla entera.
-- =========================================================

create or replace function public.asistentes_para_citas()
returns table (id uuid, nombres_completos text, usuario_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.nombres_completos, a.usuario_id
  from public.asistentes a
  where a.activo = true
    and (
      a.usuario_id is null
      or exists (
        select 1 from public.usuarios u
        where u.id = a.usuario_id and u.rol <> 'CAJERA'
      )
    )
  order by a.nombres_completos;
$$;

grant execute on function public.asistentes_para_citas() to authenticated;
