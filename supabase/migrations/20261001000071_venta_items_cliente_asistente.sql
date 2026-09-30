-- =========================================================
-- POS Negocio 2 — Historial: quién realizó cada servicio y para quién era
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 51_recargo_tarjeta_pos.sql ya se haya corrido (confirmar_venta
-- con 7 parámetros, incluido monto_pos_tarjeta).
--
-- venta_items.asistente_id ya existía en la tabla pero confirmar_venta()
-- nunca lo llenaba — un servicio vendido no dejaba ningún rastro de quién
-- lo realizó. Tampoco existía manera de saber "para quién era" un servicio
-- puntual dentro de una venta con varios (ej. "hija se atiende junto a su
-- mamá, pero paga la mamá" — Ventas.jsx ya soporta agregar atenciones de
-- distintas clientas a un mismo ticket, pero ese dato se perdía al
-- confirmar: la venta solo guarda UN cliente_id).
--
-- Los dos datos ya existen en registro_servicios (cliente_id, usuario_id)
-- desde que se creó la atención — confirmar_venta() ya la lee para
-- resolver precio/servicio, así que de paso copia esos dos campos a cada
-- venta_items de tipo SERVICIO. asistente_id se resuelve a partir de
-- usuario_id (una vuelta más, porque venta_items.asistente_id apunta a la
-- ficha en `asistentes`, no directo a `usuarios`) — si esa cuenta no tiene
-- ficha vinculada, queda null (venta hecha antes de que existiera, o un
-- caso raro sin ficha), sin romper nada.
--
-- Ventas ya confirmadas ANTES de este cambio quedan con cliente_id/
-- asistente_id en null en sus venta_items — no se intenta reconstruir ese
-- dato viejo (cruzar por venta_id+servicio_id+precio sería ambiguo si hay
-- dos servicios iguales en la misma venta, mejor no adivinar).
-- =========================================================

begin;

alter table public.venta_items
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

drop function if exists public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric);

create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb,
  p_cliente_id uuid default null,
  p_descuento_pct numeric default 0,
  p_descuento_monto numeric default 0,
  p_monto_pos_tarjeta numeric default null
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
  v_registro_servicio_id uuid;
  v_registro_servicio_estado text;
  v_registro_servicio_venta_id uuid;
  v_servicio_id uuid;
  v_registro_cliente_id uuid;
  v_registro_usuario_id uuid;
  v_asistente_id uuid;
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

  if p_descuento_pct is null then
    p_descuento_pct := 0;
  end if;
  if p_descuento_monto is null then
    p_descuento_monto := 0;
  end if;
  if p_descuento_pct < 0 or p_descuento_pct > 100 then
    raise exception 'El descuento debe estar entre 0%% y 100%%';
  end if;
  if p_descuento_monto < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;
  if p_descuento_pct > 0 and p_descuento_monto > 0 then
    raise exception 'El descuento debe ser por porcentaje o por monto fijo, no ambos';
  end if;

  if p_monto_pos_tarjeta is not null and p_monto_pos_tarjeta < 0 then
    raise exception 'El monto a digitar en POS no puede ser negativo';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_registro_cliente_id := null;
    v_registro_usuario_id := null;

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

      v_servicio_id := null;
      v_registro_servicio_id := null;

    elsif (v_item->>'tipo') = 'SERVICIO' then
      if v_cantidad <> 1 then
        raise exception 'Cada atención se vende de a una';
      end if;

      v_registro_servicio_id := (v_item->>'registro_servicio_id')::uuid;
      if v_registro_servicio_id is null then
        raise exception 'Falta la atención a vender para un servicio del ticket';
      end if;

      select rs.estado, rs.venta_id, rs.precio, rs.servicio_id, rs.cliente_id, rs.usuario_id, s.nombre
        into v_registro_servicio_estado, v_registro_servicio_venta_id, v_precio, v_servicio_id,
             v_registro_cliente_id, v_registro_usuario_id, v_nombre
      from public.registro_servicios rs
      join public.servicios s on s.id = rs.servicio_id
      where rs.id = v_registro_servicio_id
      for update of rs;

      if v_nombre is null then
        raise exception 'Esa atención ya no existe';
      end if;

      if v_registro_servicio_estado <> 'ACTIVO' or v_registro_servicio_venta_id is not null then
        raise exception 'Esa atención ya no está disponible para vender';
      end if;

    else
      raise exception 'Tipo de item desconocido: %', v_item->>'tipo';
    end if;

    v_total := v_total + v_cantidad * v_precio;

    v_items_resueltos := v_items_resueltos || jsonb_build_object(
      'tipo', v_item->>'tipo',
      'producto_id', v_item->>'producto_id',
      'servicio_id', v_servicio_id,
      'registro_servicio_id', v_registro_servicio_id,
      'cliente_id', v_registro_cliente_id,
      'usuario_id', v_registro_usuario_id,
      'nombre', v_nombre,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio,
      'subtotal', v_cantidad * v_precio
    );
  end loop;

  -- Descuento general sobre el total ya sumado (después de resolver todos
  -- los items, antes de validar el efectivo recibido — así "Recibido" se
  -- compara contra lo que de verdad hay que cobrar). Por % o por monto
  -- fijo, nunca los dos (ya validado arriba).
  if p_descuento_pct > 0 then
    v_total := round(v_total * (1 - p_descuento_pct / 100), 2);
  elsif p_descuento_monto > 0 then
    if p_descuento_monto > v_total then
      raise exception 'El descuento (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    v_total := round(v_total - p_descuento_monto, 2);
  end if;

  if p_metodo_pago = 'Efectivo' then
    if p_monto_recibido is null or p_monto_recibido < v_total then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total;
    end if;
  else
    p_monto_recibido := null;
  end if;

  if p_metodo_pago <> 'Tarjeta' then
    p_monto_pos_tarjeta := null;
  end if;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas
    (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct, descuento_monto, monto_pos_tarjeta)
  values
    (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id, p_descuento_pct, p_descuento_monto, p_monto_pos_tarjeta)
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
      v_asistente_id := null;
      if (v_item->>'usuario_id') is not null then
        select id into v_asistente_id
        from public.asistentes
        where usuario_id = (v_item->>'usuario_id')::uuid
        limit 1;
      end if;

      insert into public.venta_items
        (venta_id, tipo, servicio_id, cliente_id, asistente_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'SERVICIO', (v_item->>'servicio_id')::uuid,
         (v_item->>'cliente_id')::uuid, v_asistente_id, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

      update public.registro_servicios
      set venta_id = v_venta_id
      where id = (v_item->>'registro_servicio_id')::uuid;
    end if;
  end loop;

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric) to authenticated;

commit;
