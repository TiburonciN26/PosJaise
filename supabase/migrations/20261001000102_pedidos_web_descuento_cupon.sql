-- =========================================================
-- POS Negocio 2 — Pedidos Web: aplicar el descuento del cupón al total
-- Ejecutar en Supabase → SQL Editor → New query
-- Fix reportado por el usuario: el panel admin de Pedidos Web no
-- refleja el cupón que la clienta aplicó en el carrito.
--
-- Causa real (no solo un problema de pantalla): `confirmar_pedido_
-- productos()` (100_pedidos_web_pago.sql / 101_pedidos_web_
-- comprobante.sql) valida que el cupón exista y esté DISPONIBLE, pero
-- nunca resta su descuento del total del pedido — guarda
-- `total = subtotal + costo_delivery`, sin tocar el cupón. Confirmado
-- con datos reales: 2 pedidos de prueba con el cupón C36673 (20%
-- PORCENTAJE) tienen `total` sin descontar nada. La redención real del
-- cupón (marcarlo CANJEADO, aplicar el % en la venta) sigue pasando
-- recién en verificar_pago_pedido_web()/confirmar_venta() — eso está
-- bien, es la regla de "nada financiero real antes de verificar el
-- pago" (§8.8 de implementacionesWed.md). Lo que faltaba es calcular
-- el mismo descuento por ADELANTADO, solo para mostrarlo — sin
-- redimir el cupón todavía — así el total que ve la clienta en el
-- carrito, el monto que se le pide pagar, y lo que ve el admin
-- coinciden.
--
-- Misma fórmula que ya usa confirmar_venta() para no divergir: cupón
-- PORCENTAJE se aplica sobre el subtotal de productos (nunca sobre el
-- delivery), cupón MONTO_FIJO se topa al subtotal para no dar un
-- descuento mayor al pedido.
--
-- No cambia la firma de confirmar_pedido_productos() (mismos 13
-- parámetros) — no hace falta `drop function` esta vez, solo el
-- cuerpo cambia.
-- =========================================================

begin;

alter table public.pedidos_web
  add column if not exists descuento_cupon numeric(10, 2) not null default 0;

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
  v_cliente_id          uuid;
  v_costo_delivery      numeric(10, 2) := 0;
  v_subtotal            numeric(10, 2) := 0;
  v_descuento_cupon     numeric(10, 2) := 0;
  v_cupon_tipo_descuento text;
  v_cupon_valor          numeric;
  v_pedido_id           uuid;
  v_horario             record;
  v_dow                 int;
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
    else
      select tipo_descuento, valor into v_cupon_tipo_descuento, v_cupon_valor
      from public.cupones
      where codigo = p_codigo_cupon
        and cliente_id = v_cliente_id
        and estado = 'DISPONIBLE';

      if v_cupon_tipo_descuento is null then
        raise exception 'Ese cupón no existe, no es tuyo, o ya fue usado.';
      end if;
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

  if p_codigo_cupon is not null then
    if v_cupon_tipo_descuento = 'PORCENTAJE' then
      v_descuento_cupon := round(v_subtotal * (v_cupon_valor / 100), 2);
    else
      if v_cupon_valor > v_subtotal then
        raise exception 'El cupón (%) no puede ser mayor a tu subtotal (%)', v_cupon_valor, v_subtotal;
      end if;
      v_descuento_cupon := v_cupon_valor;
    end if;
  end if;

  update public.pedidos_web
  set subtotal = v_subtotal,
      descuento_cupon = v_descuento_cupon,
      total = round(v_subtotal - v_descuento_cupon, 2) + v_costo_delivery
  where id = v_pedido_id;

  delete from public.carrito_productos
  where cliente_web_id = auth.uid()
    and producto_id = any (p_producto_ids);

  return v_pedido_id;
end;
$$;

-- Los 2 pedidos de prueba que ya existían con el cupón C36673 (20%
-- PORCENTAJE) quedaron con el total sin descontar — se corrigen acá
-- porque siguen PENDIENTE (pago aún no verificado, sin venta_id, sin
-- efecto financiero real todavía que se vería afectado).
update public.pedidos_web pw
set descuento_cupon = round(pw.subtotal * (c.valor / 100), 2),
    total = round(pw.subtotal - round(pw.subtotal * (c.valor / 100), 2), 2) + pw.costo_delivery
from public.cupones c
where c.codigo = pw.cupon_codigo
  and c.tipo_descuento = 'PORCENTAJE'
  and pw.pago_verificado = false
  and pw.cupon_codigo is not null;

commit;
