-- =========================================================
-- POS Negocio 2 — Foto de perfil del usuario
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Cada usuario puede subir/cambiar su PROPIA foto de perfil (no la de
-- otros) — bucket público (igual criterio que fotos-productos: no es
-- información sensible), con las escrituras limitadas por CARPETA:
-- cada archivo vive en "{auth.uid()}/archivo.webp", y la política
-- exige que esa carpeta coincida con el uid de quien escribe. Así,
-- ni siquiera el admin necesita un permiso especial para esto — cada
-- quien gestiona su propia carpeta, incluido el admin la suya.
--
-- La escritura en la COLUMNA (usuarios.foto_url) pasa por un RPC
-- (no un UPDATE directo): la política de UPDATE de "usuarios" es
-- admin-only (03_rls.sql) — abrir UPDATE directo a cualquier
-- autenticado, aunque fuera "solo para uno mismo", arriesgaría que
-- alguien mande también rol/activo en el mismo payload. El RPC es la
-- puerta angosta: solo puede tocar foto_url, y solo la fila propia.
-- =========================================================

begin;

alter table public.usuarios add column if not exists foto_url text;

insert into storage.buckets (id, name, public)
values ('fotos-usuarios', 'fotos-usuarios', true)
on conflict (id) do nothing;

create policy fotos_usuarios_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-usuarios');

create policy fotos_usuarios_insert_propia on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fotos-usuarios'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy fotos_usuarios_update_propia on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fotos-usuarios'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'fotos-usuarios'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy fotos_usuarios_delete_propia on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fotos-usuarios'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.actualizar_mi_foto_perfil(p_foto_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  update public.usuarios
  set foto_url = p_foto_url
  where id = auth.uid();
end;
$$;

grant execute on function public.actualizar_mi_foto_perfil(text) to authenticated;

commit;
