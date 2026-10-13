-- Fase 9 · Inventario de medios (SOLO LECTURA). Devuelve UN documento JSON con:
--   columnas: total de filas y no nulos por columna con referencias a medios;
--   referencias: (tabla, columna, fila, valor) de cada valor NO nulo;
--   objetos: todos los objetos de Storage (bucket, ruta, bytes, tipo, fechas, eTag informativo);
--   buckets: id y si es público.
-- La transacción es READ ONLY: un intento de escritura falla. Se puede ejecutar con psql (Local) o, con autorización, en el
-- editor SQL de otro ambiente; la salida se guarda como JSON y la consume `medios-migracion.mjs inventariar --desde-json=…`.
-- El eTag de Storage NO es un checksum confiable del contenido (multipart): el SHA-256 lo calcula `planificar` sobre los bytes.
begin transaction read only;

with refs as (
  select 'productos' t, 'foto_url' c, id::text f, foto_url v from public.productos where foto_url is not null
  union all select 'producto_fotos', 'foto_url', id::text, foto_url from public.producto_fotos where foto_url is not null
  union all select 'servicios', 'foto_url', id::text, foto_url from public.servicios where foto_url is not null
  union all select 'servicio_fotos', 'foto_url', id::text, foto_url from public.servicio_fotos where foto_url is not null
  union all select 'galeria_web', 'antes_url', id::text, antes_url from public.galeria_web where antes_url is not null
  union all select 'galeria_web', 'despues_url', id::text, despues_url from public.galeria_web where despues_url is not null
  union all select 'usuarios', 'foto_url', id::text, foto_url from public.usuarios where foto_url is not null
  union all select 'clientes', 'foto_url', id::text, foto_url from public.clientes where foto_url is not null
  union all select 'asistentes', 'foto_url', id::text, foto_url from public.asistentes where foto_url is not null
  union all select 'estado_negocio', 'yape_qr_url', id::text, yape_qr_url from public.estado_negocio where yape_qr_url is not null
  union all select 'estado_negocio', 'plin_qr_url', id::text, plin_qr_url from public.estado_negocio where plin_qr_url is not null
  union all select 'mobiliario', 'foto_url', id::text, foto_url from public.mobiliario where foto_url is not null
  union all select 'pedidos_web', 'comprobante_url', id::text, comprobante_url from public.pedidos_web where comprobante_url is not null
  union all select 'citas', 'comprobante_url', id::text, comprobante_url from public.citas where comprobante_url is not null
),
totales as (
  select 'productos' t, 'foto_url' c, count(*) n, count(foto_url) nn from public.productos
  union all select 'producto_fotos', 'foto_url', count(*), count(foto_url) from public.producto_fotos
  union all select 'servicios', 'foto_url', count(*), count(foto_url) from public.servicios
  union all select 'servicio_fotos', 'foto_url', count(*), count(foto_url) from public.servicio_fotos
  union all select 'galeria_web', 'antes_url', count(*), count(antes_url) from public.galeria_web
  union all select 'galeria_web', 'despues_url', count(*), count(despues_url) from public.galeria_web
  union all select 'usuarios', 'foto_url', count(*), count(foto_url) from public.usuarios
  union all select 'clientes', 'foto_url', count(*), count(foto_url) from public.clientes
  union all select 'asistentes', 'foto_url', count(*), count(foto_url) from public.asistentes
  union all select 'estado_negocio', 'yape_qr_url', count(*), count(yape_qr_url) from public.estado_negocio
  union all select 'estado_negocio', 'plin_qr_url', count(*), count(plin_qr_url) from public.estado_negocio
  union all select 'mobiliario', 'foto_url', count(*), count(foto_url) from public.mobiliario
  union all select 'pedidos_web', 'comprobante_url', count(*), count(comprobante_url) from public.pedidos_web
  union all select 'citas', 'comprobante_url', count(*), count(comprobante_url) from public.citas
)
select json_build_object(
  'generado', now(),
  'base', current_database(),
  'columnas', (select json_agg(json_build_object('tabla', t, 'columna', c, 'filas', n, 'noNulos', nn) order by t, c) from totales),
  'referencias', coalesce((select json_agg(json_build_object('tabla', t, 'columna', c, 'fila', f, 'valor', v) order by t, c, f) from refs), '[]'::json),
  'objetos', coalesce((select json_agg(json_build_object(
      'bucket', o.bucket_id, 'ruta', o.name,
      'bytes', (o.metadata->>'size')::bigint, 'mime', o.metadata->>'mimetype',
      'etagInformativo', o.metadata->>'eTag', 'creado', o.created_at, 'actualizado', o.updated_at)
    order by o.bucket_id, o.name) from storage.objects o), '[]'::json),
  'buckets', (select json_agg(json_build_object('id', id, 'publico', public) order by id) from storage.buckets)
)::text;

rollback;
