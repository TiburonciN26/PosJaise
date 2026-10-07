-- =========================================================
-- Nosotros > Equipo: perfil de la dueña
--
-- Por qué: el hero de "Nuestro equipo" mostraba datos del LOCAL (horario y
-- redes de estado_negocio) y una foto vacía. Debe mostrar a la DUEÑA: su
-- foto, su horario y sus redes. Para eso:
--   * asistentes.es_duena: marca cuál ficha es la dueña. Solo una a la vez
--     (índice único parcial + trigger que desmarca a la anterior) y solo
--     puede marcarse una ficha vinculada a una cuenta ADMINISTRADOR
--     (decisión del usuario: el botón "Dueña" es solo para admins; así,
--     si hay varios admins, se elige cuál sale en la portada).
--   * redes y horario propios de la persona (instagram_url, facebook_url,
--     tiktok_url, horario_web): hasta ahora solo existían a nivel negocio.
-- equipo_para_web() devuelve además esos campos y ordena a la dueña primero.
-- =========================================================

begin;

alter table public.asistentes
  add column if not exists es_duena boolean not null default false,
  add column if not exists instagram_url text,
  add column if not exists facebook_url text,
  add column if not exists tiktok_url text,
  add column if not exists horario_web text;

create unique index if not exists asistentes_una_duena_idx
  on public.asistentes (es_duena)
  where es_duena;

create or replace function public.asistentes_validar_duena()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.usuario_id is null
     or not exists (
       select 1 from public.usuarios u
       where u.id = new.usuario_id and u.rol = 'ADMINISTRADOR'
     ) then
    raise exception 'Solo una asistente vinculada a una cuenta de administrador puede ser la dueña.';
  end if;

  -- Solo una dueña: desmarca a la anterior antes de que el índice único falle.
  update public.asistentes set es_duena = false
  where es_duena and id is distinct from new.id;

  return new;
end;
$$;

drop trigger if exists asistentes_validar_duena on public.asistentes;
create trigger asistentes_validar_duena
  before insert or update on public.asistentes
  for each row
  when (new.es_duena)
  execute function public.asistentes_validar_duena();

-- Cambia el tipo de retorno: hay que recrearla.
drop function if exists public.equipo_para_web();

create function public.equipo_para_web()
returns table (
  id uuid,
  nombres_completos text,
  foto_url text,
  especialidad text,
  bio text,
  es_duena boolean,
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  horario_web text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nombres_completos, a.foto_url, a.especialidad, a.bio,
         a.es_duena, a.instagram_url, a.facebook_url, a.tiktok_url, a.horario_web
  from public.asistentes a
  where a.activo = true
    and a.mostrar_en_web = true
  order by a.es_duena desc, a.nombres_completos;
$$;

grant execute on function public.equipo_para_web() to authenticated;
revoke execute on function public.equipo_para_web() from public;

commit;
