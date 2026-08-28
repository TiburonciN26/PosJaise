-- =========================================================
-- POS Negocio 2 — Fase 10: vender un servicio = cobrar una
-- atención ya registrada (no un catálogo suelto) + descuento
-- general en Ventas
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Hasta ahora "agregar servicio" en Ventas mostraba el catálogo fijo
-- de servicios(precio libre, sin dueño ni comisión). Ahora, para
-- vender un servicio primero tiene que existir una atención
-- registrada en Mi Panel (por la propia asistente, o al completar
-- una cita) — Ventas solo deja elegir entre las que aún no se
-- cobraron. Esto conecta por fin "lo que se atendió" con "lo que se
-- cobró" sin que nadie más escriba en el cuaderno de otra persona:
-- la asistente sigue siendo la única que crea/edita su propia fila
-- en registro_servicios, Ventas solo la marca como cobrada.
--
-- registro_servicios.venta_id: null = disponible para vender; con
-- valor = ya se cobró en esa venta. Se libera de nuevo si esa venta
-- se anula.
--
-- Además: ventas.descuento_pct — descuento general (0-100%) que la
-- cajera puede aplicar al total del ticket, ahora que el precio de
-- cada atención ya no es editable en el carrito.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- registro_servicios.venta_id
-- ---------------------------------------------------------
alter table public.registro_servicios
  add column venta_id uuid references public.ventas (id) on delete set null;

create index idx_registro_servicios_venta_id on public.registro_servicios (venta_id);

-- Cualquier autenticado puede VER (no editar) las atenciones que
-- están disponibles para vender, sin importar de quién sean —
-- necesario para que cualquiera que cobre en caja las encuentre. El
-- resto de columnas/filas de registro_servicios sigue protegido por
-- la política existente (dueño o admin).
create policy registro_servicios_select_disponibles on public.registro_servicios
  for select to authenticated
  using (estado = 'ACTIVO' and venta_id is null);

-- ---------------------------------------------------------
-- ventas.descuento_pct
-- ---------------------------------------------------------
alter table public.ventas
  add column descuento_pct numeric(5, 2) not null default 0
    check (descuento_pct >= 0 and descuento_pct <= 100);

-- ---------------------------------------------------------
-- confirmar_venta(): los items de tipo SERVICIO ahora traen
-- registro_servicio_id (no servicio_id + precio libre). El servidor
-- bloquea esa fila, confirma que siga disponible, toma servicio y
-- precio de ahí (ignora cualquier precio que mande el navegador) y
-- fuerza cantidad = 1. Al final aplica el descuento general sobre el
-- total ya sumado, y marca cada atención vendida con venta_id.
-- ---------------------------------------------------------
drop function if exists public.confirmar_venta(text, numeric, jsonb, uuid);

create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb,
  p_cliente_id uuid default null,
  p_descuento_pct numeric default 0
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
  if p_descuento_pct < 0 or p_descuento_pct > 100 then
    raise exception 'El descuento debe estar entre 0%% y 100%%';
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

      select rs.estado, rs.venta_id, rs.precio, rs.servicio_id, s.nombre
        into v_registro_servicio_estado, v_registro_servicio_venta_id, v_precio, v_servicio_id, v_nombre
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
      'nombre', v_nombre,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio,
      'subtotal', v_cantidad * v_precio
    );
  end loop;

  -- Descuento general sobre el total ya sumado (después de resolver todos
  -- los items, antes de validar el efectivo recibido — así "Recibido" se
  -- compara contra lo que de verdad hay que cobrar).
  if p_descuento_pct > 0 then
    v_total := round(v_total * (1 - p_descuento_pct / 100), 2);
  end if;

  if p_metodo_pago = 'Efectivo' then
    if p_monto_recibido is null or p_monto_recibido < v_total then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total;
    end if;
  else
    p_monto_recibido := null;
  end if;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct)
  values (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id, p_descuento_pct)
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

      update public.registro_servicios
      set venta_id = v_venta_id
      where id = (v_item->>'registro_servicio_id')::uuid;
    end if;
  end loop;

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb, uuid, numeric) to authenticated;

-- ---------------------------------------------------------
-- anular_venta(): además de devolver stock de productos, libera las
-- atenciones que hubieran quedado ligadas a esta venta.
-- ---------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
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

  if v_rol = 'ASISTENTE' and not public.es_hoy(v_fecha) then
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
end;
$$;

grant execute on function public.anular_venta(uuid) to authenticated;

commit;
