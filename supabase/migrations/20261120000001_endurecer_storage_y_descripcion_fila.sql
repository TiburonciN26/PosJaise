-- Auditoría global 2026-11-20 (docs/auditorias/auditoria-global-2026-11-20.md), hallazgos 7.2 y 7.3.
--
-- 1) LÍMITES DE TAMAÑO Y TIPO EN LOS BUCKETS QUE RECIBEN FOTOS
--    Ninguno tenía file_size_limit ni allowed_mime_types. Por ejemplo, una clienta con sesión podía subir
--    a su carpeta de fotos-clientes un HTML, un SVG con script o un video de 500 MB, que quedaba servido
--    públicamente bajo el dominio de Supabase del proyecto (alojamiento de phishing a nombre del salón y
--    consumo de cuota). Todas las subidas legítimas pasan por lib/imagenes.js → procesarImagen(), que
--    reescala a un lado de ≤1600 px y entrega WebP (o JPEG si el navegador no codifica WebP), así que
--    5 MB y webp/jpeg/png no deja fuera nada real. PNG se admite por compatibilidad con fotos antiguas.
--    Los límites solo se aplican a subidas nuevas: no tocan los archivos que ya existen.
--    comprobantes-emitidos ya tenía su límite (PDF, 5 MB) y no se toca.
--
-- 2) LAS POLÍTICAS SELECT DE LOS BUCKETS PÚBLICOS YA NO SON PARA anon
--    En un bucket público, la URL /object/public/... se sirve SIN pasar por RLS. La política SELECT
--    para {anon, authenticated} con solo `bucket_id = ...` no hacía falta para ver fotos: lo único que
--    añadía era poder LISTAR el bucket con la anon key (storage.from('fotos-clientes').list()), que
--    enumera los UUID de todas las clientas (son los nombres de sus carpetas) y sus fotos de perfil.
--    No se pueden simplemente borrar: Storage exige SELECT además de DELETE para remove() (y la app
--    borra la foto anterior al reemplazarla, lib/imagenes.js → eliminarFoto). Por eso cada SELECT queda
--    con la MISMA condición que el DELETE de su bucket: quien puede borrar un archivo puede verlo en la
--    API; el público sigue viendo las fotos por su URL pública como antes. La app no usa .list().
--
-- 3) descripcion_de_fila() DEJA DE SER EJECUTABLE POR anon / authenticated
--    Es security definer y sin guarda: rpc('descripcion_de_fila', {p_tabla:'citas', p_fila:{cliente_id}})
--    devolvía el nombre de una clienta (o de una asistente, con 'porcentajes') a cualquiera, sin sesión.
--    Solo la llama el trigger public.registrar_auditoria(), que es security definer con dueño postgres
--    (corre con los permisos del dueño), así que quitar el EXECUTE a PUBLIC no afecta a la auditoría.

begin;

-- 1) Límites -------------------------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id in (
   'fotos-productos', 'fotos-usuarios', 'fotos-clientes', 'fotos-servicios',
   'fotos-asistentes', 'fotos-galeria', 'qr-pagos',
   -- privados, pero también los llena una clienta con sesión (captura del pago):
   'comprobantes-pedidos-web', 'comprobantes-citas-web'
 );

-- 2) SELECT = misma condición que el DELETE de cada bucket, solo authenticated --------------------------
-- Buckets que administra la dueña.
drop policy if exists fotos_productos_select on storage.objects;
create policy fotos_productos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-productos' and public.es_admin());

drop policy if exists fotos_servicios_select on storage.objects;
create policy fotos_servicios_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-servicios' and public.es_admin());

drop policy if exists fotos_asistentes_select on storage.objects;
create policy fotos_asistentes_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-asistentes' and public.es_admin());

drop policy if exists fotos_galeria_select on storage.objects;
create policy fotos_galeria_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-galeria' and public.es_admin());

drop policy if exists qr_pagos_select on storage.objects;
create policy qr_pagos_select on storage.objects for select to authenticated
  using (bucket_id = 'qr-pagos' and public.es_admin());

-- Buckets por carpeta propia (la carpeta es el auth.uid() de quien sube).
drop policy if exists fotos_usuarios_select on storage.objects;
create policy fotos_usuarios_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-usuarios' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists fotos_clientes_select on storage.objects;
create policy fotos_clientes_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos-clientes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3) descripcion_de_fila -------------------------------------------------------------------------------
revoke execute on function public.descripcion_de_fila(text, jsonb) from public, anon, authenticated;

commit;
