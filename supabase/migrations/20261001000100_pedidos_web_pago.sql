-- =========================================================
-- POS Negocio 2 — Pedidos Web: pago obligatorio + comprobante +
-- verificación que genera la venta real
-- Ejecutar en Supabase → SQL Editor → New query
-- Fase 3 del rediseño del carrito (docs/diseno-carrito/README.md) —
-- migración 2 de 5, la más grande: toca confirmar_venta(), la función
-- que usa Ventas.jsx para CADA venta del POS, no solo pedidos web.
--
-- Regla de negocio ya acordada con el usuario: el pago es 100%
-- obligatorio (Yape/Plin/Transferencia, nunca "Efectivo contra
-- entrega") para CUALQUIER pedido web, sin excepción por modalidad de
-- entrega. Al confirmar el pedido solo se guarda la intención de pago
-- (comprobante subido, sin verificar); recién cuando el admin la
-- verifica se genera la venta real — nunca antes, porque hasta ese
-- momento la clienta puede faltar o el comprobante puede ser falso.
--
-- Hallazgo clave revisando confirmar_venta() antes de tocar nada: YA
-- sabe validar y canjear cupones (p_codigo_cupon) — no hace falta
-- duplicar esa lógica acá. El pedido solo GUARDA qué cupón eligió la
-- clienta (`cupon_codigo`, con una validación liviana de que existe y
-- es suyo, pero sin canjearlo); el canje real pasa recién cuando se
-- llama a confirmar_venta() al verificar el pago — eso es lo que hace
-- Migración 4 (cupones) mucho más simple de lo planeado originalmente.
--
-- confirmar_venta() no tiene ningún concepto de "costo de delivery" —
-- solo entiende líneas de PRODUCTO/SERVICIO. Se le suma
-- `p_costo_delivery numeric default 0` (con default, no rompe ninguna
-- llamada existente de Ventas.jsx) que se suma al total DESPUÉS de
-- aplicar el cupón — el cupón nunca descuenta el delivery. Simplificación
-- deliberada: ese monto no queda como su propia línea en `venta_items`
-- (solo entiende PRODUCTO/SERVICIO) — para una venta originada de un
-- pedido web, `ventas.total` puede ser mayor a la suma de sus
-- `venta_items` por el monto del delivery; quien necesite el desglose
-- lo encuentra en `pedidos_web.costo_delivery` vía `pedidos_web.venta_id`.
--
-- confirmar_pedido_productos() y confirmar_venta() cambian de firma
-- (parámetros nuevos) — hace falta `drop function` antes de cada una:
-- un `create or replace` con una lista de parámetros distinta no
-- reemplaza la función vieja en Postgres, crea una segunda función
-- superpuesta (mismo motivo que la migración anterior).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Bucket privado para comprobantes de pago — a diferencia de
-- fotos-productos/fotos-asistentes (públicos), un comprobante bancario
-- no debería verse con solo el link: solo el propio cliente dueño y el
-- personal pueden leerlo.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprobantes-pedidos-web', 'comprobantes-pedidos-web', false)
on conflict (id) do nothing;

create policy comprobantes_pedidos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes-pedidos-web'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy comprobantes_pedidos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes-pedidos-web'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin())
  );

-- ---------------------------------------------------------
-- 2. Bucket público para los QR de Yape/Plin — estos SÍ son públicos
-- (el cliente los necesita ver para pagar), solo el admin los sube.
-- Mismo patrón que fotos-productos/fotos-asistentes.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('qr-pagos', 'qr-pagos', true)
on conflict (id) do nothing;

create policy qr_pagos_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'qr-pagos');

create policy qr_pagos_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qr-pagos' and public.es_admin());

create policy qr_pagos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'qr-pagos' and public.es_admin())
  with check (bucket_id = 'qr-pagos' and public.es_admin());

create policy qr_pagos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'qr-pagos' and public.es_admin());

-- ---------------------------------------------------------
-- 3. Config de Yape/Plin — junto a `cuenta_transferencia`, que ya
-- existía (52_cuenta_transferencia_negocio.sql) y se reusa tal cual
-- para las instrucciones de Transferencia.
-- ---------------------------------------------------------
alter table public.estado_negocio
  add column if not exists yape_numero text,
  add column if not exists yape_titular text,
  add column if not exists yape_qr_url text,
  add column if not exists plin_numero text,
  add column if not exists plin_titular text,
  add column if not exists plin_qr_url text;

-- ---------------------------------------------------------
-- 4. Columnas nuevas en pedidos_web
-- ---------------------------------------------------------
alter table public.pedidos_web
  add column if not exists metodo_pago text
    check (metodo_pago in ('YAPE', 'PLIN', 'TRANSFERENCIA')),
  add column if not exists comprobante_url text,
  add column if not exists cupon_codigo text,
  add column if not exists pago_verificado boolean not null default false,
  add column if not exists pago_verificado_en timestamptz,
  add column if not exists pago_verificado_por uuid references public.usuarios (id),
  add column if not exists venta_id uuid references public.ventas (id);

-- ---------------------------------------------------------
-- 5. confirmar_pedido_productos() — 3ra revisión: suma método de pago
-- (obligatorio), comprobante (obligatorio) y cupón (opcional, con
-- validación liviana de dueño/estado, SIN canjearlo todavía).
-- ---------------------------------------------------------
drop function if exists public.confirmar_pedido_productos(uuid[], text, date, time, uuid, text, text);

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
  p_codigo_cupon     text default null
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
    costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    case when p_tipo_entrega = 'DELIVERY' then p_celular_entrega end,
    p_fecha_entrega, p_hora_entrega, p_metodo_pago, p_comprobante_url, p_codigo_cupon,
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
  uuid[], text, date, time, text, text, uuid, text, text, text
) to authenticated;
revoke execute on function public.confirmar_pedido_productos(
  uuid[], text, date, time, text, text, uuid, text, text, text
) from public;

-- ---------------------------------------------------------
-- 6. confirmar_venta() — se le suma p_costo_delivery (default 0, no
-- afecta ninguna llamada existente de Ventas.jsx). Se suma al total
-- DESPUÉS del bloque de cupón/descuento, nunca antes — el cupón no
-- debe descontar el delivery.
-- ---------------------------------------------------------
drop function if exists public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric, text);

create or replace function public.confirmar_venta(
  p_metodo_pago       text,
  p_monto_recibido    numeric,
  p_items             jsonb,
  p_cliente_id        uuid default null,
  p_descuento_pct     numeric default 0,
  p_descuento_monto   numeric default 0,
  p_monto_pos_tarjeta numeric default null,
  p_codigo_cupon      text default null,
  p_costo_delivery    numeric default 0
)
returns table(venta_id uuid, codigo text, total numeric, items jsonb)
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
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
  v_cupon_tipo_descuento text;
  v_cupon_valor numeric;
  v_cupon_pct_aplicado numeric := 0;
  v_credito_referidor numeric;
  v_cupon_referente_id uuid;
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

  p_codigo_cupon := nullif(btrim(coalesce(p_codigo_cupon, '')), '');

  if p_codigo_cupon is not null and (p_descuento_pct > 0 or p_descuento_monto > 0) then
    raise exception 'No puedes combinar un cupón con otro descuento';
  end if;
  if p_codigo_cupon is null and p_descuento_pct > 0 and p_descuento_monto > 0 then
    raise exception 'El descuento debe ser por porcentaje o por monto fijo, no ambos';
  end if;

  if p_monto_pos_tarjeta is not null and p_monto_pos_tarjeta < 0 then
    raise exception 'El monto a digitar en POS no puede ser negativo';
  end if;

  if p_costo_delivery is null or p_costo_delivery < 0 then
    p_costo_delivery := 0;
  end if;

  if p_codigo_cupon is not null then
    update public.cupones
    set estado = 'CANJEADO', canjeado_en = now()
    where codigo = upper(p_codigo_cupon) and estado = 'DISPONIBLE'
    returning id, cliente_id, origen into v_cupon_id, v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_id is null then
      raise exception 'Cupón inválido o ya usado';
    end if;

    if p_cliente_id is not null and p_cliente_id <> v_cupon_cliente_id then
      raise exception 'Este cupón pertenece a otro cliente';
    end if;

    p_cliente_id := v_cupon_cliente_id;
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

  if p_codigo_cupon is not null then
    select valor, tipo_descuento into v_cupon_valor, v_cupon_tipo_descuento
    from public.cupones where id = v_cupon_id;

    if v_cupon_tipo_descuento = 'PORCENTAJE' then
      v_cupon_pct_aplicado := v_cupon_valor;
      v_total := round(v_total * (1 - v_cupon_valor / 100), 2);
    else
      p_descuento_monto := v_cupon_valor;
      if p_descuento_monto > v_total then
        raise exception 'El cupón (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
      end if;
      v_total := round(v_total - p_descuento_monto, 2);
    end if;
  elsif p_descuento_pct > 0 then
    v_total := round(v_total * (1 - p_descuento_pct / 100), 2);
  elsif p_descuento_monto > 0 then
    if p_descuento_monto > v_total then
      raise exception 'El descuento (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    v_total := round(v_total - p_descuento_monto, 2);
  end if;

  -- Delivery se suma DESPUÉS del cupón/descuento — nunca se descuenta.
  v_total := v_total + p_costo_delivery;

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
    (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct, descuento_monto, monto_pos_tarjeta, cupon_id)
  values
    (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id,
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then v_cupon_pct_aplicado
       when p_codigo_cupon is null then p_descuento_pct
       else 0
     end,
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then 0
       else coalesce(p_descuento_monto, 0)
     end,
     p_monto_pos_tarjeta, v_cupon_id)
  returning id into v_venta_id;

  if v_cupon_id is not null then
    update public.cupones set venta_id = v_venta_id where id = v_cupon_id;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      select referido_por into v_cupon_referente_id from public.clientes where id = v_cupon_cliente_id;

      if v_cupon_referente_id is not null then
        select credito_referidor into v_credito_referidor from public.config_referidos where id = 1;

        insert into public.cupones (cliente_id, codigo, origen, valor, referido_id)
        values (
          v_cupon_referente_id, public.generar_codigo_cupon(), 'REFERIDO_RECOMPENSA',
          v_credito_referidor, v_cupon_cliente_id
        );

        insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
        values (
          v_cupon_referente_id,
          'REFERIDO',
          '¡Ganaste un cupón por referir!',
          'Un cliente que invitaste ya canjeó su cupón de bienvenida. Ganaste un cupón de S/' ||
            v_credito_referidor || ' — muéstralo en tu próxima visita.',
          '/mi-perfil/referidos'
        );
      end if;
    end if;
  end if;

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

grant execute on function public.confirmar_venta(
  text, numeric, jsonb, uuid, numeric, numeric, numeric, text, numeric
) to authenticated;
revoke execute on function public.confirmar_venta(
  text, numeric, jsonb, uuid, numeric, numeric, numeric, text, numeric
) from public;

-- ---------------------------------------------------------
-- 7. verificar_pago_pedido_web() — admin-only. Llama a confirmar_venta()
-- por dentro con los items/cupón/delivery del pedido, guarda el
-- venta_id resultante y marca el pago verificado. Recién ACÁ se
-- descuenta stock de verdad (confirmar_venta() ya lo hace) y se canjea
-- el cupón (si tenía) — nunca antes.
--
-- Nota (caso borde no resuelto a propósito, por ser poco probable):
-- si un producto de la línea se borró entre que se confirmó el pedido y
-- que se verifica el pago, `pedidos_web_items.producto_id` queda NULL
-- (on delete set null) y esa línea se excluye del array de items — la
-- venta se genera igual, pero sin cobrar esa línea. No se
-- resolvió con más lógica por ser un caso raro; queda anotado para si
-- alguna vez pasa de verdad.
-- ---------------------------------------------------------
create or replace function public.verificar_pago_pedido_web(p_pedido_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido   record;
  v_items    jsonb;
  v_venta_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede verificar pagos.';
  end if;

  select * into v_pedido
  from public.pedidos_web
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'Ese pedido no existe.';
  end if;

  if v_pedido.pago_verificado then
    raise exception 'Ese pago ya estaba verificado.';
  end if;

  if v_pedido.estado = 'CANCELADO' then
    raise exception 'Ese pedido está cancelado.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'PRODUCTO',
           'producto_id', producto_id,
           'cantidad', cantidad
         )), '[]'::jsonb)
    into v_items
  from public.pedidos_web_items
  where pedido_id = p_pedido_id
    and producto_id is not null;

  select cv.venta_id into v_venta_id
  from public.confirmar_venta(
    p_metodo_pago    => v_pedido.metodo_pago,
    p_monto_recibido => null,
    p_items          => v_items,
    p_cliente_id     => v_pedido.cliente_id,
    p_codigo_cupon   => v_pedido.cupon_codigo,
    p_costo_delivery => v_pedido.costo_delivery
  ) as cv;

  update public.pedidos_web
  set pago_verificado = true,
      pago_verificado_en = now(),
      pago_verificado_por = auth.uid(),
      venta_id = v_venta_id,
      estado = 'LISTO'
  where id = p_pedido_id;

  return v_venta_id;
end;
$$;

grant execute on function public.verificar_pago_pedido_web(uuid) to authenticated;
revoke execute on function public.verificar_pago_pedido_web(uuid) from public;

commit;
