-- =========================================================
-- POS Negocio 2 — Pestaña Web: foto de servicio (catálogo con diseño
-- de tarjetas — ver headerYServicios.html de referencia)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 68_servicios_favoritos.sql ya se haya corrido.
--
-- Mismo patrón que fotos-productos (42_storage_fotos_productos.sql):
-- bucket público (no es dato sensible), solo el admin sube/reemplaza/
-- borra. La sube el personal desde el POS (ModalServicio.jsx) — el
-- cliente solo la ve en su catálogo, nunca la edita.
-- =========================================================

begin;

alter table public.servicios add column if not exists foto_url text;

insert into storage.buckets (id, name, public)
values ('fotos-servicios', 'fotos-servicios', true)
on conflict (id) do nothing;

create policy fotos_servicios_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-servicios');

create policy fotos_servicios_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-servicios' and public.es_admin());

create policy fotos_servicios_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-servicios' and public.es_admin())
  with check (bucket_id = 'fotos-servicios' and public.es_admin());

create policy fotos_servicios_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-servicios' and public.es_admin());

commit;
