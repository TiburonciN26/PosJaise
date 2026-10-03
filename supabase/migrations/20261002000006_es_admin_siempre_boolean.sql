-- =========================================================
-- QA-034 — es_admin() devolvía NULL para cuentas sin perfil de personal
--
-- es_admin() era `select rol_actual() = 'ADMINISTRADOR'`. Para una cuenta CLIENTE
-- (sin fila activa en `usuarios`) rol_actual() es NULL y la comparación da NULL, no
-- false. Varias funciones SECURITY DEFINER protegen con
--   if not public.es_admin() then raise exception '…'
-- y `not NULL` es NULL: el `if` no se cumple, no se lanza el error y la función
-- continúa. Resultado reproducido en Local con una sesión CLIENTE: eliminar_producto,
-- eliminar_servicio, eliminar_asistente e historial_stock_producto se ejecutaban
-- (verificar_pago_pedido_web también superaba la guarda y solo la frenaba después
-- confirmar_venta).
--
-- Cambio: es_admin() devuelve siempre boolean (NULL → false). Las políticas RLS no
-- cambian de comportamiento (en una política NULL y false deniegan por igual; ninguna
-- política usa `not es_admin()`), y todas las guardas `if not es_admin()` pasan a
-- bloquear también a las cuentas sin perfil de personal. Misma firma, mismos grants
-- (create or replace los conserva).
-- =========================================================

begin;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(public.rol_actual() = 'ADMINISTRADOR', false);
$function$;

commit;
