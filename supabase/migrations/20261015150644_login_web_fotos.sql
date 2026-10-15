begin;

-- Configuración editorial: lectura pública solo de imágenes activas.
-- El destino R2 es el ya autorizado para imágenes editoriales (fotos-galeria).
create table public.login_web_fotos (
  id uuid primary key,
  titulo text not null default '' check (char_length(titulo) <= 120),
  foto_url text not null check (foto_url ~ '^r2:fotos-galeria/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  orden integer not null unique check (orden between 0 and 7),
  activo boolean not null default true
);
alter table public.login_web_fotos enable row level security;
revoke all on public.login_web_fotos from public, anon, authenticated;
grant select on public.login_web_fotos to anon, authenticated;
grant insert, update, delete on public.login_web_fotos to authenticated;
create policy login_fotos_lectura_publica on public.login_web_fotos
  for select to anon, authenticated using (activo);
create policy login_fotos_lectura_admin on public.login_web_fotos
  for select to authenticated using (public.es_admin());
create policy login_fotos_alta_admin on public.login_web_fotos
  for insert to authenticated with check (public.es_admin());
create policy login_fotos_cambio_admin on public.login_web_fotos
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy login_fotos_baja_admin on public.login_web_fotos
  for delete to authenticated using (public.es_admin());

-- Publicación atómica; la comparación del borrador original evita que un
-- segundo administrador sobrescriba una configuración que acaba de cambiar.
create function public.guardar_login_web_fotos(p_fotos jsonb, p_base jsonb)
returns setof public.login_web_fotos
language plpgsql security invoker set search_path = '' as $$
declare actual jsonb;
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo un administrador puede configurar el login.' using errcode = '42501';
  end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 8
     or p_base is null or jsonb_typeof(p_base) <> 'array' then
    raise exception 'Configuración de fotos inválida.';
  end if;
  perform pg_advisory_xact_lock(211215, 1);
  select coalesce(jsonb_agg(to_jsonb(f) order by f.orden, f.id), '[]'::jsonb)
    into actual from public.login_web_fotos f;
  if actual <> p_base then
    raise exception 'La configuración cambió en otra sesión. Recarga antes de guardar.';
  end if;
  delete from public.login_web_fotos;
  insert into public.login_web_fotos (id, titulo, foto_url, orden, activo)
    select id, titulo, foto_url, orden, activo
    from jsonb_to_recordset(p_fotos) as f(id uuid, titulo text, foto_url text, orden integer, activo boolean);
  return query select * from public.login_web_fotos f order by f.orden, f.id;
end;
$$;
revoke all on function public.guardar_login_web_fotos(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_login_web_fotos(jsonb, jsonb) to authenticated;

commit;
