-- =========================================================
-- QA-027 — Anular una venta nacida de un pedido web debe conciliar el pedido
--
-- Hueco real: verificar_pago_pedido_web() crea la venta y deja el pedido
-- LISTO con pago_verificado = true y venta_id apuntando a ella. Pero
-- anular_venta() (096) solo repone stock, libera la atención y deshace el
-- cupón: el pedido seguía LISTO/"pago verificado" y el panel permitía
-- marcarlo ENTREGADO, es decir, entregar mercadería de una venta ya
-- anulada y con el stock repuesto.
--
-- Qué hace esta migración, SIN inventar estados ni reglas comerciales:
--  1. anular_venta() pasa a CANCELADO (estado que ya existe en
--     pedidos_web_estado_check y que ya usa "Cancelar" del panel) los
--     pedidos vinculados a esa venta. El trigger existente
--     trg_notificar_cambio_pedido_web avisa a la clienta ("Pedido
--     cancelado"). pago_verificado NO se toca: el pago sí se recibió; la
--     devolución del dinero sigue siendo un asunto del negocio (misma
--     postura de cancelar_mi_pedido_web(), 103).
--  2. Un trigger BEFORE UPDATE impide, también por backend y no solo
--     ocultando el botón, mover a LISTO o ENTREGADO un pedido cuya venta
--     está ANULADA (UPDATE crudo, doble clic, pestaña vieja).
--
-- DECISIÓN DE NEGOCIO PENDIENTE: CANCELADO es el estado existente más
-- cercano; si el negocio quiere un estado propio (p. ej. "DEVUELTO") o un
-- tratamiento distinto para pedidos ya ENTREGADOS, se define aparte.
-- =========================================================

begin;

create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select estado, fecha into v_estado, v_fecha
  from public.ventas
  where id = p_venta_id
  for update;

  if v_estado is null then
    raise exception 'La venta no existe';
  end if;

  if v_estado = 'ANULADA' then
    raise exception 'Esta venta ya está anulada';
  end if;

  if v_rol = 'CAJERA' and not public.es_hoy(v_fecha) then
    raise exception 'Solo puedes anular ventas de hoy';
  end if;

  update public.ventas
  set estado = 'ANULADA'
  where id = p_venta_id;

  for v_item in
    select producto_id, cantidad
    from public.venta_items
    where venta_id = p_venta_id and tipo = 'PRODUCTO'
  loop
    update public.productos
    set stock_actual = stock_actual + v_item.cantidad
    where id = v_item.producto_id;
  end loop;

  update public.registro_servicios
  set venta_id = null
  where venta_id = p_venta_id;

  select cupon_id into v_cupon_id from public.ventas where id = p_venta_id;

  if v_cupon_id is not null then
    update public.cupones
    set estado = 'DISPONIBLE', canjeado_en = null, venta_id = null
    where id = v_cupon_id
    returning cliente_id, origen into v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      update public.cupones
      set estado = 'ANULADO'
      where origen = 'REFERIDO_RECOMPENSA'
        and referido_id = v_cupon_cliente_id
        and estado = 'DISPONIBLE';
    end if;
  end if;

  -- QA-027: el pedido web respaldado por esta venta ya no tiene venta vigente.
  update public.pedidos_web
  set estado = 'CANCELADO', actualizado_en = now()
  where venta_id = p_venta_id
    and estado <> 'CANCELADO';
end;
$function$;

create or replace function public.validar_pedido_web_venta_vigente()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
begin
  if new.estado in ('LISTO', 'ENTREGADO')
     and new.estado is distinct from old.estado
     and new.venta_id is not null
     and exists (
       select 1 from public.ventas v
       where v.id = new.venta_id and v.estado = 'ANULADA'
     )
  then
    raise exception 'La venta de este pedido está anulada: no se puede marcar como % (el stock ya fue repuesto).', lower(new.estado);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validar_pedido_web_venta_vigente on public.pedidos_web;
create trigger trg_validar_pedido_web_venta_vigente
  before update of estado on public.pedidos_web
  for each row execute function public.validar_pedido_web_venta_vigente();

revoke execute on function public.validar_pedido_web_venta_vigente() from public, anon, authenticated;

commit;
