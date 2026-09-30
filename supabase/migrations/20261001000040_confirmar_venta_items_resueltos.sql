-- =========================================================
-- POS Negocio 2 — B3 de la 4ª auditoría: el ticket impreso
-- armaba sus líneas con los precios del CARRITO del cliente
-- (item.precioUnitario tal cual estaba en memoria antes de
-- confirmar), mientras el TOTAL sí venía del servidor. Desde el
-- C1 de la 3ª auditoría, el precio de un PRODUCTO se resuelve en
-- el servidor contra el catálogo — si cambió entre cargar el
-- catálogo y confirmar la venta, las líneas impresas quedaban
-- con el precio viejo aunque el total ya reflejara el correcto:
-- el ticket no cuadraba consigo mismo.
--
-- confirmar_venta ya arma v_items_resueltos (nombre/precio del
-- servidor) para insertar venta_items — este cambio solo agrega
-- esa misma información como columna de salida (con subtotal ya
-- calculado), así el cliente imprime lo que de verdad quedó
-- guardado en vez de reconstruirlo desde su propio estado.
--
-- CREATE OR REPLACE no permite cambiar el RETURNS TABLE aunque
-- los parámetros de entrada sean idénticos — de ahí el DROP
-- explícito antes de recrearla (misma firma de entrada, sin dejar
-- overload; distinto de 37_resumen_estadisticas_sin_detalle.sql,
-- que agregaba un parámetro nuevo).
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

begin;

drop function if exists public.confirmar_venta(text, numeric, jsonb, uuid);

create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb,
  p_cliente_id uuid default null
)
returns table (venta_id uuid, codigo text, total numeric, items jsonb)
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
      'precio_unitario', v_precio,
      'subtotal', v_cantidad * v_precio
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
    v_precio := (v_item->>'precio_unitario')::numeric;

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

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb, uuid) to authenticated;

commit;
