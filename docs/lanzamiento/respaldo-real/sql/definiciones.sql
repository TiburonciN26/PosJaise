-- Definiciones PREVIAS de lo que reemplazaran las migraciones (SOLO LECTURA). Es codigo y reglas, no datos de clientes.
select '-- FUNCION ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || E'\n'
  || pg_get_functiondef(p.oid) || E'\n;\n-- ACL: ' || coalesce(p.proacl::text, '(por omision)') || E'\n'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('agregar_stock','anular_venta','confirmar_venta','confirmar_pedido_productos','equipo_para_web','es_admin',
  'generar_cupon_fidelizacion','mi_fidelizacion','mi_historial_fidelizacion','mis_cupones','mis_puntos','reclamar_cupon_promocion','resumen_dashboard','verificar_pago_pedido_web')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
select '-- POLITICA ' || schemaname || '.' || tablename || '.' || policyname || ' cmd=' || cmd || ' roles=' || roles::text
  || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
from pg_policies where policyname in ('ventas_insert','movimientos_insert') order by 1;
select '-- CHECK ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'ventas_metodo_pago_check';
select '-- PRIVILEGIOS POR OMISION ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || d.defaclacl::text
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname is null or n.nspname in ('public','auth','storage','supabase_migrations') order by 1;
