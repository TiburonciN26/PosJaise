-- =========================================================
-- POS Negocio 2 — Direcciones: celular de contacto por dirección
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 91_direcciones_cliente_admin.sql ya se haya corrido.
--
-- A pedido del usuario: cada dirección puede tener su propio celular de
-- contacto (distinto al teléfono de Mi Perfil a propósito — quien recibe
-- en esa dirección puede no ser el titular de la cuenta), pensado para
-- que el personal llame al momento de la entrega. Por defecto se
-- precarga con el teléfono de perfil (eso lo resuelve el frontend,
-- ModalDireccionCliente.jsx, al crear una dirección nueva — acá solo
-- hace falta la columna).
--
-- Igual que `direccion_entrega`/`nombre_producto`/`precio_unitario` en
-- pedidos_web, el celular elegido se "congela" en el pedido al
-- confirmarlo — si el cliente edita o borra esa dirección después, el
-- pedido ya confirmado no debe cambiar ni perder el dato que el
-- personal necesita para llamar.
-- =========================================================

begin;

alter table public.direcciones_cliente add column celular text;
alter table public.pedidos_web add column celular_entrega text;

drop function if exists public.confirmar_pedido_productos(uuid[], text, uuid, text);
create function public.confirmar_pedido_productos(
  p_producto_ids      uuid[],
  p_tipo_entrega      text,
  p_zona_delivery_id  uuid default null,
  p_direccion         text default null,
  p_celular_entrega   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id     uuid;
  v_costo_delivery numeric(10, 2) := 0;
  v_subtotal       numeric(10, 2) := 0;
  v_pedido_id      uuid;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de confirmar un pedido.';
  end if;

  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    raise exception 'Selecciona al menos un producto.';
  end if;

  if p_tipo_entrega not in ('RECOJO_TIENDA', 'DELIVERY') then
    raise exception 'Tipo de entrega inválido.';
  end if;

  if p_tipo_entrega = 'DELIVERY' then
    if p_direccion is null or btrim(p_direccion) = '' then
      raise exception 'Ingresa una dirección de entrega.';
    end if;

    select z.costo into v_costo_delivery
    from public.zonas_delivery z
    where z.id = p_zona_delivery_id and z.activo = true;

    if v_costo_delivery is null then
      raise exception 'Zona de delivery inválida.';
    end if;
  end if;

  insert into public.pedidos_web (
    cliente_id, tipo_entrega, zona_delivery_id, direccion_entrega, celular_entrega,
    costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    case when p_tipo_entrega = 'DELIVERY' then p_celular_entrega end,
    v_costo_delivery, 0, 0
  )
  returning id into v_pedido_id;

  insert into public.pedidos_web_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
  select v_pedido_id, p.id, p.nombre, cp.cantidad, p.precio, cp.cantidad * p.precio
  from public.carrito_productos cp
  join public.productos p on p.id = cp.producto_id
  where cp.cliente_web_id = auth.uid()
    and cp.producto_id = any (p_producto_ids);

  select coalesce(sum(subtotal), 0) into v_subtotal
  from public.pedidos_web_items
  where pedido_id = v_pedido_id;

  if v_subtotal = 0 then
    raise exception 'No se encontraron productos válidos en tu carrito.';
  end if;

  update public.pedidos_web
  set subtotal = v_subtotal, total = v_subtotal + v_costo_delivery
  where id = v_pedido_id;

  delete from public.carrito_productos
  where cliente_web_id = auth.uid()
    and producto_id = any (p_producto_ids);

  return v_pedido_id;
end;
$$;

grant execute on function public.confirmar_pedido_productos(uuid[], text, uuid, text, text) to authenticated;
revoke execute on function public.confirmar_pedido_productos(uuid[], text, uuid, text, text) from public;

commit;
