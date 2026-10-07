-- Huella de esquema de public (SOLO LECTURA): un md5 por categoria. Se ejecuta igual en produccion (rol postgres) y en la instancia
-- desechable ya actualizada; deben coincidir. No lee datos de negocio.
select 'funciones' k, count(*)::text n, md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') || '|' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), '')) h
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')
union all
select 'columnas', count(*)::text, md5(coalesce(string_agg(table_name || '.' || column_name || '|' || data_type || '|' || coalesce(character_maximum_length::text, '') || '|' || coalesce(numeric_precision::text, '') || '|' || is_nullable || '|' || coalesce(column_default, ''), E'\n' order by table_name, column_name), ''))
  from information_schema.columns where table_schema = 'public'
union all
select 'restricciones', count(*)::text, md5(coalesce(string_agg(conrelid::regclass::text || '.' || conname || '|' || contype::text || '|' || pg_get_constraintdef(oid), E'\n' order by conrelid::regclass::text, conname), ''))
  from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'politicas', count(*)::text, md5(coalesce(string_agg(tablename || '.' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname), ''))
  from pg_policies where schemaname = 'public'
union all
select 'indices', count(*)::text, md5(coalesce(string_agg(tablename || '.' || indexname || '|' || indexdef, E'\n' order by tablename, indexname), ''))
  from pg_indexes where schemaname = 'public'
union all
select 'triggers', count(*)::text, md5(coalesce(string_agg(c.relname || '.' || t.tgname || '|' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid), E'\n' order by c.relname, t.tgname), ''))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
union all
select 'tablas_y_privilegios', count(*)::text, md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text, E'\n' order by c.relname), ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
union all
select 'privilegios_de_columna', count(*)::text, md5(coalesce(string_agg(c.relname || '.' || a.attname || '|' || a.attacl::text, E'\n' order by c.relname, a.attname), ''))
  from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null
union all
select 'privilegios_por_omision', count(*)::text, md5(coalesce(string_agg(pg_get_userbyid(defaclrole) || '|' || defaclobjtype::text || '|' || defaclacl::text, E'\n' order by 1), ''))
  from pg_default_acl where defaclnamespace = 'public'::regnamespace
order by 1;
