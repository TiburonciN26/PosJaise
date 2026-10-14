\set ON_ERROR_STOP on
begin;
-- ===== 20261011000002_vistas_listas_admin.sql =====
-- Fase 5 · listas administrativas paginadas en el servidor (Reseñas y cupones de Referidos / Fidelización).
--
-- Por qué: Reseñas, Referidos Web y Fidelización Web descargaban TODA su tabla para filtrar, buscar y contar en el navegador, y el
-- servidor corta cada respuesta en max_rows (1000): pasado ese punto las filas más antiguas eran invisibles y los contadores se
-- calculaban sobre un prefijo. Para paginar con conteo exacto y búsqueda en el servidor hace falta una sola relación por pantalla:
--   · Reseñas: la moderación junta TRES tablas (resenas, resenas_producto, resenas_servicio) ordenadas por fecha. PostgREST no
--     puede unir ni ordenar tablas distintas con una consulta simple, y paginar cada una por separado rompe el orden global.
--   · Cupones: el buscador de «Código o cliente» necesita un OR entre una columna de cupones y el nombre de la clienta. PostgREST
--     no admite un OR entre columnas de tablas distintas (probado: «failed to parse logic tree»).
--
-- Seguridad: son vistas SECURITY INVOKER (security_invoker = true). Se leen con los permisos de quien consulta, así que RLS y los
-- GRANT de las tablas de origen se siguen aplicando tal cual (reseñas: administración ve y modera todas; una clienta ve las aprobadas y las suyas, incluso pendientes; un cupón lo ve
-- su dueña y el personal). La vista NO amplía ningún acceso y solo expone las columnas que estas pantallas ya leían. Solo se
-- concede SELECT a authenticated: anon no puede leerlas.
--
-- Rollback: `drop view public.resenas_moderacion; drop view public.cupones_gestion; drop function public.normalizar_busqueda(text);` (las tablas no cambian).
-- (begin del archivo: lo da el lote)

create or replace view public.resenas_moderacion
with (security_invoker = true) as
  select 'GENERAL'::text as origen, r.id, r.calificacion, r.comentario, r.estado, r.creado_en,
         c.nombre as cliente_nombre, c.telefono as cliente_telefono, null::text as item_nombre
  from public.resenas r
  left join public.clientes c on c.id = r.cliente_id
  union all
  select 'PRODUCTO'::text, rp.id, rp.calificacion, rp.comentario, rp.estado, rp.creado_en,
         c.nombre, c.telefono, p.nombre
  from public.resenas_producto rp
  left join public.clientes c on c.id = rp.cliente_id
  left join public.productos p on p.id = rp.producto_id
  union all
  select 'SERVICIO'::text, rs.id, rs.calificacion, rs.comentario, rs.estado, rs.creado_en,
         c.nombre, c.telefono, s.nombre
  from public.resenas_servicio rs
  left join public.clientes c on c.id = rs.cliente_id
  left join public.servicios s on s.id = rs.servicio_id;

-- Normalización de BÚSQUEDA: minúsculas, sin espacios sobrantes y sin diacríticos, equivalente a la que hacía la pantalla en el navegador
-- (`texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()`). Se descompone primero a NFD (normalize), así «María»
-- escrito como í precompuesta o como i + U+0301 da el mismo resultado, y después se quita la clase de caracteres que Unicode marca como
-- \p{Diacritic} en el plano básico (generada de esa misma propiedad; caracteres fuera del BMP no se contemplan). Inmutable y SQL puro:
-- no exige instalar ninguna extensión. `normalize()` requiere PostgreSQL 13+ y una base UTF8 (Supabase lo cumple).
create or replace function public.normalizar_busqueda(texto text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
  select btrim(lower(regexp_replace(normalize(coalesce(texto, ''), NFD), '[\u005e\u0060\u00a8\u00af\u00b4\u00b7-\u00b8\u02b0-\u034e\u0350-\u0357\u035d-\u0362\u0374-\u0375\u037a\u0384-\u0385\u0483-\u0487\u0559\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u064b-\u0652\u0657-\u0658\u06df-\u06e0\u06e5-\u06e6\u06ea-\u06ec\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f5\u0818-\u0819\u0898-\u089f\u08c9-\u08d2\u08e3-\u08fe\u093c\u094d\u0951-\u0954\u0971\u09bc\u09cd\u0a3c\u0a4d\u0abc\u0acd\u0afd-\u0aff\u0b3c\u0b4d\u0b55\u0bcd\u0c3c\u0c4d\u0cbc\u0ccd\u0d3b-\u0d3c\u0d4d\u0dca\u0e3a\u0e47-\u0e4c\u0e4e\u0eba\u0ec8-\u0ecc\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f3f\u0f82-\u0f84\u0f86-\u0f87\u0fc6\u1037\u1039-\u103a\u1063-\u1064\u1069-\u106d\u1087-\u108d\u108f\u109a-\u109b\u135d-\u135f\u1714-\u1715\u1734\u17c9-\u17d3\u17dd\u1939-\u193b\u1a60\u1a75-\u1a7c\u1a7f\u1ab0-\u1abe\u1ac1-\u1acb\u1acf-\u1add\u1ae0-\u1aeb\u1b34\u1b44\u1b6b-\u1b73\u1baa-\u1bab\u1be6\u1bf2-\u1bf3\u1c36-\u1c37\u1c78-\u1c7d\u1cd0-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1d2c-\u1d6a\u1d9b-\u1dbe\u1dc4-\u1dcf\u1df5-\u1dff\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd-\u1ffe\u2cef-\u2cf1\u2e2f\u302a-\u302f\u3099-\u309c\u30fc\ua66f\ua67c-\ua67d\ua67f\ua69c-\ua69d\ua6f0-\ua6f1\ua700-\ua721\ua788-\ua78a\ua7f1\ua7f8-\ua7f9\ua806\ua82c\ua8c4\ua8e0-\ua8f1\ua92b-\ua92e\ua953\ua9b3\ua9c0\ua9e5\uaa7b-\uaa7d\uaabf-\uaac2\uaaf6\uab5b-\uab5f\uab69-\uab6b\uabec-\uabed\ufb1e\ufe20-\ufe2f\uff3e\uff40\uff70\uff9e-\uff9f\uffe3]', '', 'g')))
$fn$;

create or replace view public.cupones_gestion
with (security_invoker = true) as
  select cu.id, cu.codigo, cu.origen, cu.valor, cu.tipo_descuento, cu.estado, cu.creado_en, c.nombre as cliente_nombre,
         -- Columnas de BÚSQUEDA normalizadas con public.normalizar_busqueda(): la pantalla normaliza igual el texto escrito y compara
         -- con ILIKE sobre estas columnas.
         public.normalizar_busqueda(cu.codigo) as codigo_busqueda,
         public.normalizar_busqueda(c.nombre) as cliente_busqueda
  from public.cupones cu
  left join public.clientes c on c.id = cu.cliente_id;

revoke all on public.resenas_moderacion from public, anon;
revoke all on public.cupones_gestion from public, anon;
grant select on public.resenas_moderacion to authenticated;
grant select on public.cupones_gestion to authenticated;
revoke all on function public.normalizar_busqueda(text) from public, anon;
grant execute on function public.normalizar_busqueda(text) to authenticated;

-- (commit del archivo: lo da el lote)

insert into supabase_migrations.schema_migrations(version, name) values ('20261011000002', 'vistas_listas_admin') on conflict (version) do nothing;
commit;