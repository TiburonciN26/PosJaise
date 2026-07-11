-- =========================================================
-- POS Negocio 2 — Fase 2: fix de permisos base (GRANT)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Causa del error 403 al hacer login: al rol "authenticated" le
-- faltaba el permiso base de SELECT/INSERT/UPDATE/DELETE en las
-- tablas (solo tenía TRUNCATE/REFERENCES/TRIGGER por defecto).
-- RLS filtra FILAS, pero antes de eso Postgres exige el permiso
-- base de la operación — sin GRANT, ni siquiera se evalúa RLS.
-- Este script agrega ese permiso base; ya está incluido también
-- en 03_rls.sql para que una instalación nueva no tenga este
-- problema.
-- =========================================================

begin;

grant select, insert, update, delete on public.usuarios to authenticated;
grant select, insert, update, delete on public.asistentes to authenticated;
grant insert, update, delete on public.productos to authenticated;
grant select, insert, update, delete on public.servicios to authenticated;
grant select, insert, update, delete on public.porcentajes to authenticated;
grant select, insert, update on public.ventas to authenticated;
grant select, insert on public.venta_items to authenticated;
grant select, insert on public.movimientos_stock to authenticated;
grant select, insert, update, delete on public.gastos to authenticated;
grant select on public.auditoria to authenticated;

commit;
