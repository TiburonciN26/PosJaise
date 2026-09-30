-- =========================================================
-- POS Negocio 2 — Pestaña Web: Galería (antes/después)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Último punto pendiente del §7 de implementacionesWed.md ("contenido
-- de marca") — depende 100% de fotos reales del salón, así que arranca
-- con UNA fila de prueba usando las mismas fotos de referencia que ya
-- tiene el hero de Inicio (§7.36), a pedido explícito del usuario. El
-- admin la reemplaza/agrega más desde el panel nuevo (Galería Web,
-- cuelga de /web).
--
-- antes_url/despues_url guardan la URL YA RESUELTA, no una ruta de
-- bucket sola (a diferencia de asistentes.foto_url/servicios.foto_url,
-- que solo guardan la ruta y se resuelven con urlPublicaFoto() al
-- leer): esta tabla tiene que poder mostrar tanto una foto real subida
-- a Storage (bucket "fotos-galeria", URL pública completa) como la
-- fila de prueba de arriba, que vive en /public (no en Storage) — no
-- hay un único bucket al que asumirle la ruta. El front resuelve las
-- rutas relativas (sin "http") contra import.meta.env.BASE_URL, mismo
-- criterio que ya usa InicioCliente.jsx para esas mismas fotos.
-- =========================================================

begin;

create table public.galeria_web (
  id          uuid primary key default gen_random_uuid(),
  titulo      text,
  antes_url   text not null,
  despues_url text not null,
  orden       integer not null default 0,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

alter table public.galeria_web enable row level security;

grant select, insert, update, delete on public.galeria_web to authenticated;

-- Lectura directa de la tabla: solo personal (panel admin) — mismo
-- patrón que asistentes_select tras 62_clientes_web.sql. El cliente
-- Web nunca lee esta tabla directo, solo vía galeria_para_web() más
-- abajo (un recorte de solo lo activo, sin exponer orden/activo/fechas).
create policy galeria_web_select on public.galeria_web
  for select to authenticated
  using (public.rol_actual() is not null);

create policy galeria_web_insert_admin on public.galeria_web
  for insert to authenticated
  with check (public.es_admin());

create policy galeria_web_update_admin on public.galeria_web
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy galeria_web_delete_admin on public.galeria_web
  for delete to authenticated
  using (public.es_admin());

insert into storage.buckets (id, name, public)
values ('fotos-galeria', 'fotos-galeria', true)
on conflict (id) do nothing;

create policy fotos_galeria_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-galeria');

create policy fotos_galeria_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-galeria' and public.es_admin());

create policy fotos_galeria_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-galeria' and public.es_admin())
  with check (bucket_id = 'fotos-galeria' and public.es_admin());

create policy fotos_galeria_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-galeria' and public.es_admin());

-- Único canal de lectura para el portal cliente — mismo patrón que
-- equipo_para_web() (83_equipo_web.sql): recorte security definer con
-- solo lo activo, sin abrir la tabla entera a un rol CLIENTE.
create or replace function public.galeria_para_web()
returns table (
  id uuid,
  titulo text,
  antes_url text,
  despues_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.titulo, g.antes_url, g.despues_url
  from public.galeria_web g
  where g.activo = true
  order by g.orden, g.creado_en;
$$;

grant execute on function public.galeria_para_web() to authenticated;
revoke execute on function public.galeria_para_web() from public;

-- Fila de prueba (rutas relativas a /public, sin "http" — ver nota de
-- arriba): las mismas dos fotos que ya usa el hero de Inicio.
insert into public.galeria_web (titulo, antes_url, despues_url, orden)
values ('Foto de prueba (Inicio)', 'inicio-web/hero-antes-referencia.jpg', 'inicio-web/hero-despues-referencia.jpg', 0);

commit;
