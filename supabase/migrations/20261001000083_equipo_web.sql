-- =========================================================
-- POS Negocio 2 — Pestaña Web: Equipo (tarjetas de personal en el
-- portal de clientes)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- "asistentes" hoy es una tabla de uso interno (nombre/teléfono/email/
-- comisión) — nada pensado para mostrarse en público. Se le suman 4
-- columnas nuevas para esto: foto_url, especialidad, bio y
-- mostrar_en_web (decisión confirmada con el usuario: el admin elige
-- quién aparece en la Web, no se muestran todas las activas
-- automáticamente — evita exponer a alguien sin foto/bio cargada
-- todavía, o que prefiere no aparecer).
--
-- La foto la sube el ADMIN desde el panel de Asistentes del POS (no la
-- propia asistente): muchas no tienen cuenta de login (usuario_id null),
-- así que el patrón "cada quien sube a su propia carpeta {auth.uid()}"
-- de fotos-usuarios (46_foto_perfil_usuario.sql) no aplica acá — mismo
-- criterio que fotos-servicios (69_servicios_foto.sql): bucket público,
-- solo admin escribe.
-- =========================================================

begin;

alter table public.asistentes
  add column if not exists foto_url text,
  add column if not exists especialidad text,
  add column if not exists bio text,
  add column if not exists mostrar_en_web boolean not null default false;

insert into storage.buckets (id, name, public)
values ('fotos-asistentes', 'fotos-asistentes', true)
on conflict (id) do nothing;

create policy fotos_asistentes_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-asistentes');

create policy fotos_asistentes_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-asistentes' and public.es_admin());

create policy fotos_asistentes_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-asistentes' and public.es_admin())
  with check (bucket_id = 'fotos-asistentes' and public.es_admin());

create policy fotos_asistentes_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-asistentes' and public.es_admin());

-- Único canal de lectura para el portal cliente: "asistentes" sigue
-- bloqueada para un cliente Web (asistentes_select exige rol_actual()
-- is not null, ver 62_clientes_web.sql) — mismo patrón que
-- asistentes_para_citas()/usuarios_para_citas(), un recorte
-- security definer con solo lo necesario para mostrar en público.
create or replace function public.equipo_para_web()
returns table (
  id uuid,
  nombres_completos text,
  foto_url text,
  especialidad text,
  bio text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nombres_completos, a.foto_url, a.especialidad, a.bio
  from public.asistentes a
  where a.activo = true
    and a.mostrar_en_web = true
  order by a.nombres_completos;
$$;

grant execute on function public.equipo_para_web() to authenticated;
revoke execute on function public.equipo_para_web() from public;

commit;
