-- =========================================================
-- POS Negocio 2 — Fix: la clienta agendaba bien pero no veía su cita
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 75_citas_web.sql ya se haya corrido.
--
-- Bug real detectado en producción (MCP + simulación de sesión real):
-- citas_select_propio_web / cita_servicios_select_propio_web usaban una
-- subconsulta directa contra "clientes" para resolver "cuál es mi fila".
-- Esa subconsulta TAMBIÉN queda sujeta al RLS de "clientes"
-- (clientes_select = rol_actual() is not null, staff-only, a propósito
-- desde 62_clientes_web.sql) — un cliente Web no puede leer su propia
-- fila de "clientes" por SELECT directo, así que la subconsulta le
-- devolvía vacío y la política de citas nunca se cumplía. Por eso
-- agendar_cita_web() (security definer, se salta el RLS) sí funcionaba,
-- pero el SELECT normal de "mis citas" siempre daba cero filas.
--
-- mi_cliente_id() resuelve esto igual que rol_actual() ya lo resuelve
-- para usuarios: una función security definer, que sí puede leer
-- "clientes" sin toparse con su propio RLS.
--
-- Verificado con una llamada real simulada (auth.uid() suplantado vía
-- request.jwt.claim.sub, en una transacción con rollback): antes del fix,
-- 0 filas visibles para la clienta con una cita real agendada; después,
-- 1 fila (la suya) en citas y en cita_servicios.
-- =========================================================

begin;

create or replace function public.mi_cliente_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.clientes where cliente_web_id = auth.uid();
$$;

grant execute on function public.mi_cliente_id() to authenticated;
revoke execute on function public.mi_cliente_id() from public;

drop policy if exists citas_select_propio_web on public.citas;
create policy citas_select_propio_web on public.citas
  for select to authenticated
  using (cliente_id = public.mi_cliente_id());

drop policy if exists cita_servicios_select_propio_web on public.cita_servicios;
create policy cita_servicios_select_propio_web on public.cita_servicios
  for select to authenticated
  using (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and c.cliente_id = public.mi_cliente_id()
    )
  );

commit;
