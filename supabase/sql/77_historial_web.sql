-- =========================================================
-- POS Negocio 2 — Pestaña Web: Historial de visitas
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 76_fix_citas_web_rls.sql ya se haya corrido.
--
-- 100% lectura, sin RPC de escritura. Fuente: registro_servicios (no
-- citas) filtrado por cliente_id, así aparece tanto lo agendado por la
-- Web como una atención que el personal registró directo, sin cita
-- previa. Usa mi_cliente_id() (72_) a propósito, no una subconsulta
-- directa contra "clientes" — esa subconsulta ya nos mordió una vez en
-- Citas (ver 76_fix_citas_web_rls.sql).
--
-- De paso, cierra un hueco pre-existente que quedó afuera cuando
-- 62_clientes_web.sql endureció el resto de tablas: registro_servicios_
-- select_disponibles dejaba ver a CUALQUIER autenticado (sin chequeo de
-- rol) los servicios "activos y sin vender" de CUALQUIER cliente, no
-- solo el propio — inofensivo mientras solo el personal tenía cuentas,
-- explotable ahora que cualquiera puede auto-registrarse por la Web.
-- =========================================================

begin;

drop policy if exists registro_servicios_select_disponibles on public.registro_servicios;
create policy registro_servicios_select_disponibles on public.registro_servicios
  for select to authenticated
  using (public.rol_actual() is not null and estado = 'ACTIVO' and venta_id is null);

create policy registro_servicios_select_propio_web on public.registro_servicios
  for select to authenticated
  using (cliente_id = public.mi_cliente_id());

commit;
