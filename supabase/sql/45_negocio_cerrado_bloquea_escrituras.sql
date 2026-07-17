-- =========================================================
-- POS Negocio 2 — Estado del negocio: bloqueo de escrituras
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 44_estado_negocio.sql ya se haya corrido.
--
-- Con el negocio cerrado, un ASISTENTE no puede: confirmar ventas,
-- agregar stock, ni registrar atenciones nuevas. El admin nunca se
-- bloquea. Este chequeo vive en el servidor (no solo en el
-- frontend) en los tres puntos de escritura que un asistente puede
-- alcanzar:
--   1. confirmar_venta()  — RPC
--   2. agregar_stock()    — RPC
--   3. registro_servicios — trigger BEFORE INSERT (ya existente,
--      calcular_comision_registro_servicio, reutilizado para no
--      sumar un trigger más)
--
-- El mismo mensaje literal en los tres (y en AuthContext.jsx del
-- lado del cliente, vía src/lib/estadoNegocio.js) para que la UI
-- pueda mostrarlo tal cual, sin adivinar de qué error se trata.
-- =========================================================

begin;

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

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no puede estar vacío';
  end if;

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

create or replace function public.agregar_stock(
  p_producto_id uuid,
  p_cantidad int,
  p_nota text
)
returns table (stock_anterior int, stock_nuevo int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock_anterior int;
  v_stock_nuevo int;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a agregar debe ser mayor a 0';
  end if;

  select stock_actual into v_stock_anterior
  from public.productos
  where id = p_producto_id
  for update;

  if v_stock_anterior is null then
    raise exception 'El producto no existe';
  end if;

  v_stock_nuevo := v_stock_anterior + p_cantidad;

  update public.productos
  set stock_actual = v_stock_nuevo
  where id = p_producto_id;

  insert into public.movimientos_stock
    (producto_id, cantidad_agregada, stock_anterior, stock_nuevo, nota, usuario_id)
  values
    (p_producto_id, p_cantidad, v_stock_anterior, v_stock_nuevo, nullif(trim(p_nota), ''), auth.uid());

  return query select v_stock_anterior, v_stock_nuevo;
end;
$$;

-- registro_servicios: se extiende el trigger BEFORE INSERT OR UPDATE
-- que ya existía (27_registro_servicios_endurecimiento.sql) — el
-- chequeo solo aplica a TG_OP = 'INSERT' (registrar una atención
-- nueva); editar/cancelar una ya existente no se toca acá.
create or replace function public.calcular_comision_registro_servicio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asistente_id uuid;
  v_porcentaje numeric(5, 2);
begin
  if TG_OP = 'INSERT' and not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  select id into v_asistente_id
  from public.asistentes
  where usuario_id = NEW.usuario_id;

  if v_asistente_id is null then
    NEW.porcentaje_aplicado := 100;
    NEW.pago_asistente := NEW.precio;
    return NEW;
  end if;

  select porcentaje into v_porcentaje
  from public.porcentajes
  where servicio_id = NEW.servicio_id
    and asistente_id = v_asistente_id;

  NEW.porcentaje_aplicado := v_porcentaje;
  NEW.pago_asistente := case
    when v_porcentaje is not null then round((NEW.precio * v_porcentaje) / 100, 2)
    else null
  end;

  return NEW;
end;
$$;

commit;
