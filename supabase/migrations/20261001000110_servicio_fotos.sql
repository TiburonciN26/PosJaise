-- =========================================================
-- Migración 4/10 del rediseño de Servicios/Detalle: varias fotos por
-- servicio (Resultado/Antes/Después) para la galería del Detalle.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Hoy solo existe servicios.foto_url (una sola foto, usada en la
-- tarjeta y como respaldo de la galería del Detalle si esta tabla está
-- vacía para ese servicio). Las fotos van al mismo bucket
-- "fotos-servicios" que ya existe (público, con sus policies de admin
-- para insert/update/delete) — solo cambia dónde se guarda la referencia
-- a cada archivo.
--
-- RLS/grants: mismo patrón que `servicios` (03_rls.sql/04_grants.sql) —
-- SELECT abierto si el servicio está activo (o para personal),
-- INSERT/UPDATE/DELETE solo admin.
-- =========================================================

begin;

create table public.servicio_fotos (
  id           uuid primary key default gen_random_uuid(),
  servicio_id  uuid not null references public.servicios(id) on delete cascade,
  foto_url     text not null,
  etiqueta     text not null default 'Resultado' check (etiqueta in ('Resultado', 'Antes', 'Después')),
  orden        int not null default 0,
  created_at   timestamptz not null default now()
);

create index servicio_fotos_servicio_id_idx on public.servicio_fotos (servicio_id, orden);

alter table public.servicio_fotos enable row level security;

grant select, insert, update, delete on public.servicio_fotos to authenticated;

create policy servicio_fotos_select on public.servicio_fotos
  for select to authenticated
  using (
    public.rol_actual() is not null
    or exists (
      select 1 from public.servicios s
      where s.id = servicio_fotos.servicio_id and s.activo = true
    )
  );

create policy servicio_fotos_insert_admin on public.servicio_fotos
  for insert to authenticated
  with check (public.es_admin());

create policy servicio_fotos_update_admin on public.servicio_fotos
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy servicio_fotos_delete_admin on public.servicio_fotos
  for delete to authenticated
  using (public.es_admin());

commit;
