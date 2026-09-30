-- =========================================================
-- POS Negocio 2 — M7: permisos para el backup mensual (GitHub Actions)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- El script de backup (scripts/exportar-backup.js) usa la Service Role Key
-- para leer ventas/venta_items/gastos y exportarlas a CSV. En este proyecto
-- nada tiene permisos por defecto — ni "authenticated" (ver 04_grants.sql)
-- ni, resulta, "service_role" tampoco: como las tablas se crearon por SQL
-- directo (no por el editor de tablas de Supabase), ningún rol quedó con
-- privilegios automáticos salvo el dueño de la tabla.
--
-- service_role normalmente ya se salta RLS (BYPASSRLS), pero antes de
-- evaluar RLS, Postgres exige igual el permiso base de la operación — el
-- mismo motivo que 04_grants.sql documenta para "authenticated".
-- =========================================================

begin;

grant select on public.ventas to service_role;
grant select on public.venta_items to service_role;
grant select on public.gastos to service_role;

commit;
