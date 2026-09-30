-- =========================================================
-- POS Negocio 2 — Pedidos Web: comprobante fiscal (Boleta/Factura)
-- Ejecutar en Supabase → SQL Editor → New query
-- Fase 3 del rediseño del carrito (docs/diseno-carrito/README.md) —
-- migración 3 de 5.
--
-- El carrito ya tiene en pantalla el toggle Boleta/Factura con RUC y
-- razón social (SeccionComprobante en CarritoCliente.jsx), validado
-- en el navegador (`facturaCompleta`: con Factura, RUC de 11 dígitos y
-- razón social no vacía) — pero el servidor no guardaba nada de esto
-- todavía ni lo volvía a validar. `ventas` no tiene ningún concepto de
-- comprobante fiscal (se revisó su estructura antes de escribir esto:
-- no existe boleta/factura/ruc ahí), así que esto vive solo en
-- `pedidos_web` — información para el negocio al emitir el comprobante
-- de verdad, no algo que afecte confirmar_venta().
--
-- `pedidos_web` seguía vacía (0 filas) al escribir esto, así que
-- `tipo_comprobante` puede ir `not null default 'BOLETA'` sin backfill.
--
-- confirmar_pedido_productos() cambia de firma otra vez — de 10 a 13
-- parámetros. Mismo `drop function` obligatorio antes del `create or
-- replace` (regla ya documentada en 99_pedidos_web_dia_hora.sql).
-- =========================================================

begin;

alter table public.pedidos_web
  add column if not exists tipo_comprobante text not null default 'BOLETA'
    check (tipo_comprobante in ('BOLETA', 'FACTURA')),
  add column if not exists ruc text,
  add column if not exists razon_social text;

drop function if exists public.confirmar_pedido_productos(
  uuid[], text, date, time, text, text, uuid, text, text, text
);

create or replace function public.confirmar_pedido_productos(
  p_producto_ids     uuid[],
  p_tipo_entrega     text,
  p_fecha_entrega    date,
  p_hora_entrega     time,
  p_metodo_pago      text,
  p_comprobante_url  text,
  p_zona_delivery_id uuid default null,
  p_direccion        text default null,
  p_celular_entrega  text default null,
  p_codigo_cupon     text default null,
  p_tipo_comprobante text default 'BOLETA',
  p_ruc              text default null,
  p_razon_social     text default null
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
  v_horario        record;
  v_dow            int;
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

  if p_fecha_entrega is null or p_hora_entrega is null then
    raise exception 'Elige el día y la hora de entrega.';
  end if;

  if p_fecha_entrega < (now() at time zone 'America/Lima')::date then
    raise exception 'Elige un día que no haya pasado.';
  end if;

  select dias_atencion, bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin
    into v_horario
  from public.estado_negocio
  where id = 1;

  v_dow := extract(isodow from p_fecha_entrega);
  if v_horario.dias_atencion is null or not (v_dow = any(v_horario.dias_atencion)) then
    raise exception 'El negocio no atiende ese día.';
  end if;

  if not (
    p_hora_entrega between v_horario.bloque1_inicio and v_horario.bloque1_fin
    or (
      v_horario.bloque2_inicio is not null
      and p_hora_entrega between v_horario.bloque2_inicio and v_horario.bloque2_fin
    )
  ) then
    raise exception 'Elige una hora dentro del horario de atención.';
  end if;

  if p_metodo_pago not in ('YAPE', 'PLIN', 'TRANSFERENCIA') then
    raise exception 'Método de pago inválido.';
  end if;

  if p_comprobante_url is null or btrim(p_comprobante_url) = '' then
    raise exception 'Sube la captura de tu pago para confirmar el pedido.';
  end if;

  if p_tipo_comprobante not in ('BOLETA', 'FACTURA') then
    raise exception 'Tipo de comprobante inválido.';
  end if;

  if p_tipo_comprobante = 'FACTURA' then
    if p_ruc is null or p_ruc !~ '^\d{11}$' then
      raise exception 'Ingresa un RUC válido de 11 dígitos para la factura.';
    end if;
    if p_razon_social is null or btrim(p_razon_social) = '' then
      raise exception 'Ingresa la razón social para la factura.';
    end if;
  end if;

  if p_codigo_cupon is not null then
    p_codigo_cupon := upper(btrim(p_codigo_cupon));
    if p_codigo_cupon = '' then
      p_codigo_cupon := null;
    elsif not exists (
      select 1 from public.cupones
      where codigo = p_codigo_cupon
        and cliente_id = v_cliente_id
        and estado = 'DISPONIBLE'
    ) then
      raise exception 'Ese cupón no existe, no es tuyo, o ya fue usado.';
    end if;
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
    fecha_entrega, hora_entrega, metodo_pago, comprobante_url, cupon_codigo,
    tipo_comprobante, ruc, razon_social,
    costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    case when p_tipo_entrega = 'DELIVERY' then p_celular_entrega end,
    p_fecha_entrega, p_hora_entrega, p_metodo_pago, p_comprobante_url, p_codigo_cupon,
    p_tipo_comprobante,
    case when p_tipo_comprobante = 'FACTURA' then p_ruc end,
    case when p_tipo_comprobante = 'FACTURA' then btrim(p_razon_social) end,
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

grant execute on function public.confirmar_pedido_productos(
  uuid[], text, date, time, text, text, uuid, text, text, text, text, text, text
) to authenticated;
revoke execute on function public.confirmar_pedido_productos(
  uuid[], text, date, time, text, text, uuid, text, text, text, text, text, text
) from public;

commit;
