-- Huella del esquema: una línea corta que debe salir IGUAL en Local y en Producción.
--
-- Uso:
--   Local: docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres -t -A -q < supabase/scripts/huella_esquema.sql
--   Prod:  pegar esta consulta en execute_sql (MCP) o en el SQL Editor.
-- Si alguna parte difiere, la letra indica el grupo (p. ej. fn:c = funciones que empiezan con "c")
-- y hay que bajar al detalle de ese grupo. Cubre: columnas, constraints, índices, políticas RLS
-- (public + storage), triggers, RLS activado, vistas, definición de funciones (sin importar
-- saltos de línea), permisos de anon/authenticated/service_role/PUBLIC (tablas, columnas y
-- funciones), permisos por defecto de objetos nuevos, buckets, cron y migraciones registradas.
-- No mira datos. Creado el 20/11/2026 al sincronizar Local con Producción (implementacionesWed.md §93).
with items as (
  select 'col' g, c.table_name || '.' || c.column_name k, c.data_type || c.is_nullable || coalesce(c.column_default, '') h
  from information_schema.columns c where c.table_schema = 'public'
  union all
  select 'con', cl.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
  from pg_constraint co join pg_class cl on cl.oid = co.conrelid where cl.relnamespace = 'public'::regnamespace
  union all
  select 'idx', indexname, indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'pol', schemaname || '.' || tablename || '.' || policyname,
         cmd || roles::text || coalesce(qual, '') || coalesce(with_check, '') || permissive
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'trg', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all
  select 'rls', c.relname, c.relrowsecurity::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 'view', c.relname, pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, '')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  union all
  select 'fn:' || left(p.proname, 1), p.oid::regprocedure::text, regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  union all
  select 'exec', p.oid::regprocedure::text,
         has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
         || has_function_privilege('service_role', p.oid, 'execute')::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  union all
  select 'grant', c.relname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x
         where split_part(x::text, '=', 1) in ('', 'anon', 'authenticated', 'service_role')), '')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'colgrant', c.relname || '.' || a.attname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x
         where split_part(x::text, '=', 1) in ('', 'anon', 'authenticated', 'service_role')), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  union all
  select 'defacl', defaclobjtype::text, defaclacl::text
  from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace
  union all
  select 'bucket', id, public::text || coalesce(file_size_limit::text, '') || coalesce(allowed_mime_types::text, '') from storage.buckets
  union all
  select 'cron', jobname, schedule || command from cron.job
)
select string_agg(g || '=' || hh, ' ' order by g)
from (select g, left(md5(string_agg(k || '=' || h, ',' order by k)), 6) hh from items group by g) z;
