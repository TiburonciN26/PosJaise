-- =========================================================
-- Migración 3/8 del rediseño de Productos/Detalle: varias fotos por
-- producto (Frente/Textura/En uso/Detrás) para la galería del Detalle.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Mismo patrón que servicio_fotos (110_servicio_fotos.sql): hoy solo
-- existe productos.foto_url (una sola foto, usada en la tarjeta y como
-- respaldo de la galería si esta tabla está vacía para ese producto).
-- Van al mismo bucket "fotos-productos" que ya existe.
-- =========================================================

begin;

create table public.producto_fotos (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  foto_url    text not null,
  etiqueta    text not null default 'Frente' check (etiqueta in ('Frente', 'Textura', 'En uso', 'Detrás')),
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

create index producto_fotos_producto_id_idx on public.producto_fotos (producto_id, orden);

alter table public.producto_fotos enable row level security;

grant select, insert, update, delete on public.producto_fotos to authenticated;

create policy producto_fotos_select on public.producto_fotos
  for select to authenticated
  using (
    public.rol_actual() is not null
    or exists (
      select 1 from public.productos p
      where p.id = producto_fotos.producto_id and p.activo = true
    )
  );

create policy producto_fotos_insert_admin on public.producto_fotos
  for insert to authenticated
  with check (public.es_admin());

create policy producto_fotos_update_admin on public.producto_fotos
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy producto_fotos_delete_admin on public.producto_fotos
  for delete to authenticated
  using (public.es_admin());

commit;
