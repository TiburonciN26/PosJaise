-- Definiciones PREVIAS de lo que reemplazaran las migraciones (SOLO LECTURA). Es codigo y reglas, no datos de clientes.
select '-- FUNCION ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || E'\n'
  || pg_get_functiondef(p.oid) || E'\n;\n-- ACL: ' || coalesce(p.proacl::text, '(por omision)') || E'\n'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('agregar_stock','anular_venta','confirmar_venta','confirmar_pedido_productos','equipo_para_web','es_admin',
  'generar_cupon_fidelizacion','mi_fidelizacion','mi_historial_fidelizacion','mis_cupones','mis_puntos','reclamar_cupon_promocion','resumen_dashboard','verificar_pago_pedido_web')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
-- Politicas: cada esperada sale UNA vez, en su tabla exacta, como presente (con su definicion) o como AUSENTE explicita.
-- movimientos_insert la elimina 20261002000008 (lote de 23); ventas_insert la reemplaza 20261002000007 en la misma transaccion.
-- Una tabla esperada inexistente, o una politica con ese nombre en otra tabla, sale aparte para que el paso 5 se detenga.
select case
    when to_regclass('public.' || e.tabla) is null then '-- TABLA AUSENTE public.' || e.tabla || ' (politica ' || e.politica || ')'
    when p.policyname is null then '-- POLITICA AUSENTE public.' || e.tabla || '.' || e.politica
    else '-- POLITICA ' || p.schemaname || '.' || p.tablename || '.' || p.policyname || ' cmd=' || p.cmd || ' roles=' || p.roles::text
      || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
  end
from (values ('movimientos_stock', 'movimientos_insert'), ('ventas', 'ventas_insert')) e(tabla, politica)
left join pg_policies p on p.schemaname = 'public' and p.tablename = e.tabla and p.policyname = e.politica
order by e.politica;
select '-- POLITICA FUERA DE LUGAR ' || schemaname || '.' || tablename || '.' || policyname from pg_policies
where policyname in ('ventas_insert','movimientos_insert')
  and (schemaname, tablename, policyname) not in (('public','ventas','ventas_insert'), ('public','movimientos_stock','movimientos_insert'))
order by 1;
select '-- MIGRACION 20261002000008 registrada=' || exists (select 1 from supabase_migrations.schema_migrations where version = '20261002000008')::text;
select '-- CHECK ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'ventas_metodo_pago_check';
select '-- PRIVILEGIOS POR OMISION ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || d.defaclacl::text
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname is null or n.nspname in ('public','auth','storage','supabase_migrations') order by 1;
