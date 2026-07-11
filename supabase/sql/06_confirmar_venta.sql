-- =========================================================
-- POS Negocio 2 — Fase 3: confirmar venta (RPC atómico)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Todo pasa en una sola función = una sola transacción: si
-- cualquier paso falla (raise exception), Postgres deshace
-- automáticamente todo lo que la función alcanzó a hacer.
-- Nunca queda una venta a medias.
-- =========================================================

begin;

-- =========================================================
-- Secuencia para el código correlativo (VEN001, VEN074...).
-- Una secuencia es segura ante ventas simultáneas: nextval()
-- nunca entrega el mismo número dos veces, sin necesidad de
-- bloqueos manuales.
-- =========================================================
create sequence if not exists public.ventas_codigo_seq;

-- Por si ya existieran ventas cargadas, arranca la secuencia
-- después del correlativo más alto (en una base nueva, esto
-- simplemente la deja en 1).
select setval(
  'public.ventas_codigo_seq',
  coalesce(
    (select max(substring(codigo from 4)::int) from public.ventas),
    0
  ) + 1,
  false
);

-- =========================================================
-- confirmar_venta
-- p_items: arreglo JSON, un objeto por línea del ticket:
--   { "tipo": "PRODUCTO"|"SERVICIO",
--     "producto_id": uuid|null, "servicio_id": uuid|null,
--     "nombre": text, "cantidad": int, "precio_unitario": numeric }
--
-- asistente_id / porcentaje_aplicado / pago_asistente quedan
-- NULL por ahora en las líneas de servicio — el selector de
-- "quién atendió" llega con el módulo de asistentes/Mi Panel.
-- =========================================================
create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb
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
  v_stock_actual int;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no puede estar vacío';
  end if;

  -- El total se calcula aquí, no se confía en el que mande el cliente.
  select coalesce(sum((item->>'cantidad')::int * (item->>'precio_unitario')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_items) as item;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas (codigo, total, metodo_pago, monto_recibido, vendedor_id)
  values (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid())
  returning id into v_venta_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio := (v_item->>'precio_unitario')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un item del ticket';
    end if;

    if (v_item->>'tipo') = 'PRODUCTO' then
      -- FOR UPDATE bloquea la fila: si otra venta simultánea está
      -- descontando el mismo producto, esta espera a que termine
      -- y lee el stock ya actualizado, no un valor viejo.
      select stock_actual into v_stock_actual
      from public.productos
      where id = (v_item->>'producto_id')::uuid
      for update;

      if v_stock_actual is null then
        raise exception 'El producto "%" ya no existe', v_item->>'nombre';
      end if;

      if v_stock_actual < v_cantidad then
        raise exception 'Stock insuficiente para "%" (quedan %, pediste %)',
          v_item->>'nombre', v_stock_actual, v_cantidad;
      end if;

      update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = (v_item->>'producto_id')::uuid;

      insert into public.venta_items
        (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'PRODUCTO', (v_item->>'producto_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

    elsif (v_item->>'tipo') = 'SERVICIO' then
      insert into public.venta_items
        (venta_id, tipo, servicio_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'SERVICIO', (v_item->>'servicio_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

    else
      raise exception 'Tipo de item desconocido: %', v_item->>'tipo';
    end if;
  end loop;

  return query select v_venta_id, v_codigo, v_total;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb) to authenticated;

commit;
