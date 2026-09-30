-- =========================================================
-- POS Negocio 2 — Pedidos Web: la clienta puede cancelar su propio pedido
-- Ejecutar en Supabase → SQL Editor → New query
-- Pedido del usuario: nueva pestaña "Pedidos" en el portal cliente
-- (PedidosCliente.jsx, /mi-perfil/pedidos) donde la clienta ve el
-- estado de sus pedidos y puede cancelarlos — pero SOLO mientras el
-- admin no haya verificado el pago todavía (`pago_verificado = false`,
-- ver verificar_pago_pedido_web(), 100_pedidos_web_pago.sql). Una vez
-- verificado ya existe una venta real detrás (stock descontado, cupón
-- redimido) — cancelar el pedido en ese punto no debería revertir nada
-- solo, así que en ese caso la clienta tiene que hablar directo con el
-- negocio para pedir la devolución (mismo criterio que
-- cancelar_mi_cita_web() con la ventana de 3 horas: hay un punto en el
-- que la app deja de resolverlo sola).
--
-- No existía ninguna policy de UPDATE para el cliente sobre
-- pedidos_web (solo pedidos_web_update_admin) — a propósito: mismo
-- patrón que cancelar_mi_cita_web(), un RPC security definer en vez de
-- abrir una policy de update directa, para poder validar la regla de
-- "solo si no se verificó el pago" en un solo lugar controlado.
-- =========================================================

begin;

create or replace function public.cancelar_mi_pedido_web(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid;
  v_pedido     record;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'No tienes un perfil vinculado';
  end if;

  select * into v_pedido from public.pedidos_web where id = p_pedido_id for update;

  if v_pedido.id is null or v_pedido.cliente_id is distinct from v_cliente_id then
    raise exception 'Ese pedido no existe o no te pertenece';
  end if;

  if v_pedido.estado = 'CANCELADO' then
    raise exception 'Ese pedido ya está cancelado';
  end if;

  if v_pedido.pago_verificado then
    raise exception 'Ya confirmamos tu pago y generamos la venta — comunícate directamente con el negocio para solicitar la devolución.';
  end if;

  update public.pedidos_web
  set estado = 'CANCELADO', actualizado_en = now()
  where id = p_pedido_id;
end;
$$;

grant execute on function public.cancelar_mi_pedido_web(uuid) to authenticated;
revoke execute on function public.cancelar_mi_pedido_web(uuid) from public;

commit;
