-- =========================================================
-- POS Negocio 2 — Fase 4: confirmar visibilidad de ventas
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Re-aplica (drop + create) las políticas de ventas/venta_items
-- tal como quedaron definidas en 03_rls.sql: el asistente ve
-- TODAS las ventas de HOY (de cualquier vendedor), no solo las
-- suyas. El admin sigue viendo todo, sin restricción de fecha.
-- No cambia nada sobre costo/ganancia (eso vive en productos,
-- no en ventas).
-- =========================================================

begin;

drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas
  for select to authenticated
  using (
    public.es_admin()
    or (public.rol_actual() = 'ASISTENTE' and public.es_hoy(fecha))
  );

drop policy if exists venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items
  for select to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          public.es_admin()
          or (public.rol_actual() = 'ASISTENTE' and public.es_hoy(v.fecha))
        )
    )
  );

commit;
