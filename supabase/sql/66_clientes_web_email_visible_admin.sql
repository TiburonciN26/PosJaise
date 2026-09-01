-- =========================================================
-- POS Negocio 2 — Clientes: mostrar el correo con el que se registró
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 65_restringir_clientes_web.sql ya se haya corrido.
--
-- clientes_web_select (62_clientes_web.sql) solo dejaba ver la propia
-- fila (id = auth.uid()) — necesario para que un cliente lea su propio
-- perfil, pero eso también bloqueaba al admin cuando la pantalla de
-- Clientes intenta traer clientes_web(email) embebido vía la FK
-- cliente_web_id. Se agrega una policy aparte para admin (mismo
-- criterio que usuarios_select ya usa: "id = auth.uid() or es_admin()"
-- — acá va como policy separada en vez de reescribir la existente, para
-- no tocar el criterio de acceso propio del cliente).
-- =========================================================

begin;

create policy clientes_web_select_admin on public.clientes_web
  for select to authenticated
  using (public.es_admin());

commit;
