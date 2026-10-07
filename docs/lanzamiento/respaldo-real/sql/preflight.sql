-- Pre-vuelo: SOLO LECTURA. Cada fila: clave|valor (psql -At -F '|'). Sin datos personales: solo versiones, permisos y conteos.
select 'version_servidor', current_setting('server_version');
select 'es_superusuario', (select rolsuper::text from pg_roles where rolname = current_user);
select 'miembro_pg_read_all_data', pg_has_role(current_user, 'pg_read_all_data', 'member')::text;
select 'tablas_no_legibles', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind in ('r','p','v','m') and not has_table_privilege(c.oid, 'select');
select 'secuencias_no_legibles', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind = 'S'
    and not (case when c.relkind = 'S' then has_sequence_privilege(c.oid, 'select') else true end);
select 'esquemas_sin_uso', count(*)::text from pg_namespace
  where nspname in ('public','auth','storage','supabase_migrations') and not has_schema_privilege(nspname, 'usage');
select 'esquemas_presentes', count(*)::text from pg_namespace where nspname in ('public','auth','storage','supabase_migrations');
select 'locale', datcollate || '/' || datlocprovider::text || '/' || coalesce(datlocale, '') from pg_database where datname = current_database();
select 'extensiones', string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension;
select 'max_connections', current_setting('max_connections');
select 'migraciones_registradas', count(*)::text from supabase_migrations.schema_migrations;
select 'ventas_total', count(*)::text from public.ventas;
select 'ventas_ultimo_codigo', max(codigo) from public.ventas;
select 'usuarios_auth_total', count(*)::text from auth.users;
select 'storage_buckets', count(*)::text from storage.buckets;
select 'storage_objetos', count(*)::text || '/' || coalesce(sum((metadata->>'size')::bigint), 0)::text from storage.objects;
