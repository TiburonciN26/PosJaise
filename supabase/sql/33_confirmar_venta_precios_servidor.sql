-- =========================================================
-- POS Negocio 2 — C1 + B10 de la 3ª auditoría: confirmar_venta
-- dejaba de confiar en el cliente para el total... pero seguía
-- confiando en los precios y nombres que venían en p_items.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- C1 — misma clase de bug que el C2 de la 1ª auditoría (comisiones
-- calculadas en el navegador): para un item PRODUCTO, el RPC usaba
-- el precio_unitario del payload sin compararlo con el catálogo.
-- Una asistente autenticada, llamando al RPC por la API directa
-- (sin pasar por la UI), podía vender productos a S/ 0.01 —
-- descontando stock real. Ahora precio y nombre de PRODUCTO se
-- leen de la tabla productos (en el mismo SELECT ... FOR UPDATE
-- que ya bloqueaba la fila para el stock), y el nombre de
-- SERVICIO se lee de la tabla servicios. El precio de SERVICIO
-- sí sigue viniendo del cliente: es una decisión de negocio (la
-- UI permite editarlo en el ticket), solo se valida que sea un
-- número >= 0.
--
-- B10 — en Efectivo no se validaba monto_recibido en el servidor:
-- por API podía quedar registrada una venta con vuelto negativo.
-- Ahora Efectivo exige monto_recibido >= total, y los demás
-- métodos guardan null (no aplica el concepto de vuelto).
-- =========================================================

begin;

create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb,
  p_cliente_id uuid default null
)
returns table (venta_id uuid, codigo text, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venta_id uuid;
  v_codigo text;
  v_total numeric := 0;
  v_item jsonb;
  v_cantidad int;
  v_precio numeric;
  v_nombre text;
  v_stock_actual int;
  v_items_resueltos jsonb := '[]'::jsonb;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no puede estar vacío';
  end if;

  -- Pasada 1: resolver cada item contra el catálogo (precio y nombre del
  -- servidor para productos; nombre del servidor para servicios), validar
  -- stock y acumular el total. El FOR UPDATE bloquea la fila del producto:
  -- si otra venta simultánea está descontando el mismo producto, esta
  -- espera y lee el stock ya actualizado. El lock se mantiene hasta el
  -- commit, así que el descuento de la pasada 2 sigue siendo seguro.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::int;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un item del ticket';
    end if;

    if (v_item->>'tipo') = 'PRODUCTO' then
      select nombre, precio, stock_actual
        into v_nombre, v_precio, v_stock_actual
      from public.productos
      where id = (v_item->>'producto_id')::uuid
      for update;

      if v_nombre is null then
        raise exception 'El producto "%" ya no existe', v_item->>'nombre';
      end if;

      if v_stock_actual < v_cantidad then
        raise exception 'Stock insuficiente para "%" (quedan %, pediste %)',
          v_nombre, v_stock_actual, v_cantidad;
      end if;

    elsif (v_item->>'tipo') = 'SERVICIO' then
      select nombre into v_nombre
      from public.servicios
      where id = (v_item->>'servicio_id')::uuid;

      if v_nombre is null then
        raise exception 'El servicio "%" ya no existe', v_item->>'nombre';
      end if;

      -- Único precio que sí viene del cliente (editable en el ticket).
      v_precio := (v_item->>'precio_unitario')::numeric;
      if v_precio is null or v_precio < 0 then
        raise exception 'Precio inválido para el servicio "%"', v_nombre;
      end if;

    else
      raise exception 'Tipo de item desconocido: %', v_item->>'tipo';
    end if;

    v_total := v_total + v_cantidad * v_precio;

    v_items_resueltos := v_items_resueltos || jsonb_build_object(
      'tipo', v_item->>'tipo',
      'producto_id', v_item->>'producto_id',
      'servicio_id', v_item->>'servicio_id',
      'nombre', v_nombre,
      'cantidad', v_cantidad,
      'precio', v_precio
    );
  end loop;

  -- B10: en Efectivo, lo recibido tiene que alcanzar para el total.
  if p_metodo_pago = 'Efectivo' then
    if p_monto_recibido is null or p_monto_recibido < v_total then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total;
    end if;
  else
    p_monto_recibido := null;
  end if;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id)
  values (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id)
  returning id into v_venta_id;

  -- Pasada 2: descontar stock e insertar las líneas, ya con los valores
  -- resueltos por el servidor.
  for v_item in select * from jsonb_array_elements(v_items_resueltos)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio := (v_item->>'precio')::numeric;

    if (v_item->>'tipo') = 'PRODUCTO' then
      update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = (v_item->>'producto_id')::uuid;

      insert into public.venta_items
        (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'PRODUCTO', (v_item->>'producto_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);
    else
      insert into public.venta_items
        (venta_id, tipo, servicio_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'SERVICIO', (v_item->>'servicio_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);
    end if;
  end loop;

  return query select v_venta_id, v_codigo, v_total;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb, uuid) to authenticated;

commit;
