-- =========================================================
-- POS Negocio 2 — Fase 5: Storage para fotos de producto
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Bucket público (las fotos de producto no son datos sensibles):
-- cualquiera con la URL exacta puede verla, pero solo el admin
-- puede subir/reemplazar/borrar (mismo criterio que
-- productos_update_admin en 03_rls.sql).
-- =========================================================

begin;

insert into storage.buckets (id, name, public)
values ('fotos-productos', 'fotos-productos', true)
on conflict (id) do nothing;

create policy fotos_productos_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-productos');

create policy fotos_productos_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-productos' and public.es_admin());

create policy fotos_productos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-productos' and public.es_admin())
  with check (bucket_id = 'fotos-productos' and public.es_admin());

create policy fotos_productos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-productos' and public.es_admin());

commit;
