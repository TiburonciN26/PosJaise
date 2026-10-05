-- =========================================================
-- QA-054 — Validar el cupón ANTES de pedir el pago de un pedido web.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte. Recompensas permanece apagado.
--
-- Hallazgo (Codex, con sesiones reales): el checkout de la clienta calculaba el descuento del cupón en el navegador
-- y confirmar_pedido_productos() lo calculaba otra vez sin alcance, tope, nivel, vigencia ni protección. El pedido se
-- aceptaba (la clienta subía su comprobante por el total con descuento) y solo al «Verificar pago» confirmar_venta()
-- lo rechazaba por la protección global.
--
-- Cambio: la evaluación del cupón vive en UNA función interna (recompensas_evaluar_cupon) que usan:
--   * confirmar_venta()             — venta (POS y pedido verificado): autoritativa, como hasta ahora;
--   * confirmar_pedido_productos()  — el pedido se rechaza DENTRO de su transacción si el cupón no pasa;
--   * vista_previa_cupon_pedido()   — consulta de SOLO LECTURA para el checkout (no consume cupones, no reserva stock,
--                                     no crea pedidos, no acredita recompensas).
-- Respuestas para la clienta: solo valido, motivo, subtotal y descuento. Nunca costos, componentes protegidos ni
-- porcentajes internos: un costo desconocido se presenta con un mensaje neutro («por ahora no se puede aplicar»).
--
-- verificar_pago_pedido_web() conserva la revalidación y, si entre la creación del pedido y la verificación cambiaron
-- precios, costos o la protección, falla con un CONFLICTO claro (el pedido sigue pendiente; no se cambia el total en
-- silencio ni se cobra ninguna diferencia). También exige que el total vigente coincida con el que la clienta pagó.
--
-- Todo lo demás de confirmar_venta() es la definición vigente (20261005000001): misma firma, permisos QA-033, reparto
-- exacto de centavos, monedas sobre netos, sellos, referidos, cupones vencidos, códigos > 999.
-- =========================================================

begin;

-- 1. Evaluación compartida de un cupón sobre un carrito (internas: no expuestas a la API).
--    p_items: arreglo de {tipo, producto_id, servicio_id, nombre, cantidad, subtotal} (sin envío).
--    Devuelve {descuento, bases[], subtotal, proteccion_total, descuento_maximo} o RECHAZA con excepción (mensajes
--    existentes). hint = 'COSTO_DESCONOCIDO' | 'PROTECCION_GLOBAL' marca los rechazos que dependen de costos internos.
create or replace function public.recompensas_evaluar_cupon(p_cupon_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_cupon public.cupones;
  v_n int := coalesce(jsonb_array_length(p_items), 0);
  v_i int;
  v_linea jsonb;
  v_tipo text;
  v_bases numeric[];
  v_desc numeric[];
  v_servicio_ya boolean := false;
  v_elig_total numeric;
  v_desc_total numeric := 0;
  v_prot public.servicios_proteccion;
  v_prot_json jsonb;
  v_prot_total numeric := 0;
  v_subtotal numeric := 0;
  v_desconocido text;
begin
  select * into v_cupon from public.cupones where id = p_cupon_id;
  if v_cupon.id is null then
    raise exception 'Cupón inválido o ya usado';
  end if;
  if v_n = 0 then
    raise exception 'Este cupón no aplica a los productos o servicios de esta compra.';
  end if;
  v_bases := array_fill(0::numeric, array[v_n]);

  if public.recompensas_nivel_orden(v_cupon.nivel_minimo) >
     public.recompensas_nivel_orden((select s.nivel from public.recompensas_saldos(v_cupon.cliente_id) s)) then
    raise exception 'Este cupón requiere nivel % o superior', v_cupon.nivel_minimo;
  end if;

  for v_i in 0..v_n - 1 loop
    v_linea := p_items -> v_i;
    v_tipo := v_linea->>'tipo';
    v_subtotal := v_subtotal + (v_linea->>'subtotal')::numeric;
    if v_cupon.tipo_descuento = 'SERVICIO' then
      if v_tipo = 'SERVICIO' and not v_servicio_ya
         and (v_linea->>'servicio_id')::uuid = v_cupon.servicio_id then
        v_bases[v_i + 1] := (v_linea->>'subtotal')::numeric;
        v_servicio_ya := true;
      end if;
    elsif v_cupon.alcance = 'TODO'
       or (v_cupon.alcance = 'SERVICIOS' and v_tipo = 'SERVICIO')
       or (v_cupon.alcance = 'PRODUCTOS' and v_tipo = 'PRODUCTO') then
      v_bases[v_i + 1] := (v_linea->>'subtotal')::numeric;
    end if;
  end loop;

  select coalesce(sum(x), 0) into v_elig_total from unnest(v_bases) as x;
  if v_elig_total <= 0 then
    raise exception 'Este cupón no aplica a los productos o servicios de esta compra.';
  end if;
  if v_cupon.minimo_compra is not null and v_elig_total < v_cupon.minimo_compra then
    raise exception 'Este cupón requiere una compra mínima de S/ % en los productos o servicios a los que aplica.', v_cupon.minimo_compra;
  end if;

  if v_cupon.tipo_descuento = 'PORCENTAJE' then
    v_desc_total := round(v_elig_total * v_cupon.valor / 100, 2);
    if v_cupon.tope is not null and v_desc_total > v_cupon.tope then
      v_desc_total := v_cupon.tope;
    end if;
  elsif v_cupon.tipo_descuento = 'SERVICIO' then
    -- Premio de servicio: cubre el precio efectivo menos la protección del servicio.
    select * into v_prot from public.servicios_proteccion where servicio_id = v_cupon.servicio_id;
    if v_prot.servicio_id is null then
      v_desc_total := floor(v_elig_total * 50) / 100;   -- sin protección configurada: hasta el 50 %
    else
      v_desc_total := greatest(v_elig_total
        - (public.recompensas_proteccion_servicio(v_cupon.servicio_id, v_elig_total)->>'total')::numeric, 0);
    end if;
  else
    if v_cupon.valor > v_elig_total then
      raise exception 'Este cupón supera el importe al que puede aplicarse. Puedes utilizarlo en otra compra.';
    end if;
    v_desc_total := v_cupon.valor;
  end if;

  v_desc := public.recompensas_distribuir(v_bases, v_desc_total);

  for v_i in 0..v_n - 1 loop
    v_linea := p_items -> v_i;
    if v_linea->>'tipo' = 'SERVICIO' then
      v_prot_json := public.recompensas_proteccion_servicio(
        (v_linea->>'servicio_id')::uuid, (v_linea->>'subtotal')::numeric);
      v_prot_total := v_prot_total + (v_prot_json->>'total')::numeric;
      -- Sin protección configurada se conserva el límite del 50 % por partida (el respaldo vigente).
      if v_prot_json->>'modo' = 'RESPALDO_50' and v_desc[v_i + 1] > 0
         and v_desc[v_i + 1] > floor((v_linea->>'subtotal')::numeric * 50) / 100 then
        raise exception 'Este cupón supera el límite del servicio "%": en servicios sin protección configurada los cupones pueden descontar hasta el 50 %% del precio. Puedes utilizarlo en otra compra.', v_linea->>'nombre';
      end if;
    else
      v_prot_json := public.recompensas_proteccion_producto(
        (v_linea->>'producto_id')::uuid, (v_linea->>'cantidad')::int);
      if (v_prot_json->>'costo_conocido')::boolean then
        v_prot_total := v_prot_total + (v_prot_json->>'total')::numeric;
      elsif v_desconocido is null then
        v_desconocido := v_linea->>'nombre';
      end if;
    end if;
  end loop;

  if v_desconocido is not null then
    raise exception 'Este cupón no se puede aplicar a esta compra: falta registrar el costo de compra de "%". Pide a un administrador que revise la protección del producto.', v_desconocido
      using hint = 'COSTO_DESCONOCIDO';
  end if;
  if v_subtotal - v_desc_total < v_prot_total then
    raise exception 'Este cupón supera el descuento permitido para esta compra. Puedes utilizarlo en otra compra.'
      using hint = 'PROTECCION_GLOBAL';
  end if;

  return jsonb_build_object('descuento', v_desc_total, 'bases', to_jsonb(v_bases), 'subtotal', v_subtotal,
    'proteccion_total', v_prot_total, 'descuento_maximo', v_subtotal - v_prot_total);
end;
$$;
revoke execute on function public.recompensas_evaluar_cupon(uuid, jsonb) from public, anon, authenticated;

-- Resuelve el cupón de UNA clienta por su código (disponible, vigente) y lo evalúa.
create or replace function public.recompensas_validar_cupon_pedido(p_cliente_id uuid, p_codigo text, p_items jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_id uuid;
begin
  select c.id into v_id from public.cupones c
  where c.codigo = v_codigo and c.cliente_id = p_cliente_id and c.estado = 'DISPONIBLE'
    and (c.vigente_hasta is null or c.vigente_hasta > now());
  if v_id is null then
    if exists (select 1 from public.cupones c
               where c.codigo = v_codigo and c.cliente_id = p_cliente_id and c.estado = 'DISPONIBLE'
                 and c.vigente_hasta is not null and c.vigente_hasta <= now()) then
      raise exception 'Este cupón ya venció';
    end if;
    raise exception 'Ese cupón no existe, no es tuyo, o ya fue usado.';
  end if;
  return public.recompensas_evaluar_cupon(v_id, p_items) || jsonb_build_object('cupon_id', v_id);
end;
$$;
revoke execute on function public.recompensas_validar_cupon_pedido(uuid, text, jsonb) from public, anon, authenticated;

-- Motivo que ve la CLIENTA: sin costos ni componentes internos.
create or replace function public.recompensas_motivo_cliente(p_mensaje text, p_hint text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case when p_hint = 'COSTO_DESCONOCIDO'
              then 'Este cupón no se puede aplicar a esta compra por ahora. Puedes utilizarlo en otra compra.'
              else p_mensaje end;
$$;
revoke execute on function public.recompensas_motivo_cliente(text, text) from public, anon, authenticated;

-- 2. Vista previa del checkout: SOLO LECTURA (stable; no consume el cupón, no reserva stock, no crea pedidos, no acredita).
create or replace function public.vista_previa_cupon_pedido(p_codigo text, p_producto_ids uuid[])
returns table (valido boolean, motivo text, subtotal numeric, descuento numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid;
  v_items jsonb;
  v_subtotal numeric := 0;
  v_eval jsonb;
  v_msg text;
  v_hint text;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    return query select false, 'Completa tu perfil antes de aplicar un cupón.'::text, 0::numeric, 0::numeric;
    return;
  end if;
  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    return query select false, 'Selecciona al menos un producto.'::text, 0::numeric, 0::numeric;
    return;
  end if;

  select jsonb_agg(jsonb_build_object('tipo', 'PRODUCTO', 'producto_id', p.id, 'nombre', p.nombre,
                                      'cantidad', cp.cantidad, 'subtotal', cp.cantidad * p.precio)),
         coalesce(sum(cp.cantidad * p.precio), 0)
    into v_items, v_subtotal
  from public.carrito_productos cp
  join public.productos p on p.id = cp.producto_id
  where cp.cliente_web_id = auth.uid() and cp.producto_id = any (p_producto_ids);
  if v_items is null then
    return query select false, 'No se encontraron productos válidos en tu carrito.'::text, 0::numeric, 0::numeric;
    return;
  end if;

  begin
    v_eval := public.recompensas_validar_cupon_pedido(v_cliente_id, p_codigo, v_items);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return query select false, public.recompensas_motivo_cliente(v_msg, v_hint), v_subtotal, 0::numeric;
    return;
  end;
  return query select true, null::text, v_subtotal, (v_eval->>'descuento')::numeric;
end;
$$;
revoke execute on function public.vista_previa_cupon_pedido(text, uuid[]) from public, anon;
grant execute on function public.vista_previa_cupon_pedido(text, uuid[]) to authenticated;

-- 3. confirmar_venta con el evaluador compartido (resto idéntico a la definición vigente).
CREATE OR REPLACE FUNCTION public.confirmar_venta(p_metodo_pago text, p_monto_recibido numeric, p_items jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0, p_descuento_monto numeric DEFAULT 0, p_monto_pos_tarjeta numeric DEFAULT NULL::numeric, p_codigo_cupon text DEFAULT NULL::text, p_costo_delivery numeric DEFAULT 0)
 RETURNS TABLE(venta_id uuid, codigo text, total numeric, items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Fase 2
  v_cupon public.cupones;
  v_cfg public.recompensas_config;
  v_n int;
  v_i int;
  v_bases numeric[];
  v_desc numeric[];
  v_elig_total numeric;
  v_desc_total numeric := 0;
  v_servicio_ya boolean := false;
  v_subtotal_linea numeric;
  v_linea jsonb;
  v_tipo_linea text;
  v_piso numeric;
  v_prot public.servicios_proteccion;
  v_nivel text;
  v_neto numeric;
  v_neto_serv numeric := 0;
  v_neto_prod numeric := 0;
  v_monedas numeric;
  v_monedas_linea numeric;
  v_excluida boolean;
  v_tiene_servicio boolean := false;
  v_vinculada boolean := false;
  v_dia date;
  -- Protección económica global del carrito (cupones)
  v_prots jsonb := '[]'::jsonb;
  v_prot_json jsonb;
  v_prot_total numeric := 0;
  v_subtotal_carrito numeric;
  v_desconocido text;
  v_eval jsonb;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  -- QA-033 (regla aprobada): solo ADMINISTRADOR y CAJERA registran ventas.
  if public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA') then
    raise exception 'Solo el administrador o la cajera pueden registrar ventas';
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

  select * into v_cfg from public.recompensas_config where id = 1;

  if p_codigo_cupon is not null then
    update public.cupones
    set estado = 'CANJEADO', canjeado_en = now()
    where public.cupones.codigo = upper(p_codigo_cupon)
      and public.cupones.estado = 'DISPONIBLE'
      and (public.cupones.vigente_hasta is null or public.cupones.vigente_hasta > now())
    returning id, cliente_id, origen into v_cupon_id, v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_id is null then
      if exists (select 1 from public.cupones c
                 where c.codigo = upper(p_codigo_cupon) and c.estado = 'DISPONIBLE'
                   and c.vigente_hasta is not null and c.vigente_hasta <= now()) then
        raise exception 'Este cupón ya venció';
      end if;
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

  -- ---- Descuento: se reparte por línea elegible --------------------------
  v_n := jsonb_array_length(v_items_resueltos);
  v_bases := array_fill(0::numeric, array[v_n]);

  if p_codigo_cupon is not null then
    select * into v_cupon from public.cupones where id = v_cupon_id;
    v_cupon_tipo_descuento := v_cupon.tipo_descuento;
    v_cupon_valor := v_cupon.valor;

    -- Misma lógica que usa el pedido web (vista previa y confirmación): nivel, alcance, compra mínima, tipo, tope,
    -- límite del 50 % en servicios sin configurar, costo conocido y protección global. Rechaza con excepción.
    v_eval := public.recompensas_evaluar_cupon(v_cupon_id, v_items_resueltos);
    v_desc_total := (v_eval->>'descuento')::numeric;
    select array_agg(t.x::numeric order by t.o) into v_bases
    from jsonb_array_elements_text(v_eval->'bases') with ordinality as t(x, o);
    if v_cupon.tipo_descuento = 'PORCENTAJE' then
      v_cupon_pct_aplicado := v_cupon.valor;
    elsif v_cupon.tipo_descuento <> 'SERVICIO' then
      p_descuento_monto := v_cupon.valor;
    end if;
  elsif p_descuento_pct > 0 then
    for v_i in 0..v_n - 1 loop
      v_bases[v_i + 1] := (v_items_resueltos -> v_i ->> 'subtotal')::numeric;
    end loop;
    v_desc_total := v_total - round(v_total * (1 - p_descuento_pct / 100), 2);
  elsif p_descuento_monto > 0 then
    if p_descuento_monto > v_total then
      raise exception 'El descuento (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    for v_i in 0..v_n - 1 loop
      v_bases[v_i + 1] := (v_items_resueltos -> v_i ->> 'subtotal')::numeric;
    end loop;
    v_desc_total := p_descuento_monto;
  end if;

  v_desc := public.recompensas_distribuir(v_bases, v_desc_total);

  -- ---- Protección económica ---------------------------------------------
  -- Por partida se calcula SIEMPRE la protección (servicios: materiales + precio efectivo de la atención x % protegido
  -- de asistente + otros, o el importe antiguo mientras no se actualice, o el respaldo del 50 %; productos: costo de
  -- compra registrado + transporte de abastecimiento + otros, por unidad x cantidad). Se guarda en el detalle de la venta.
  --  * CUPÓN: lo valida recompensas_evaluar_cupon() (regla global del carrito; ver más arriba) antes de repartir.
  --  * DESCUENTO MANUAL: conserva su comportamiento (piso por servicio configurado).
  for v_i in 0..v_n - 1 loop
    v_linea := v_items_resueltos -> v_i;
    if v_linea->>'tipo' = 'SERVICIO' then
      v_prot_json := public.recompensas_proteccion_servicio(
        (v_linea->>'servicio_id')::uuid, (v_linea->>'subtotal')::numeric);
      v_prot_total := v_prot_total + (v_prot_json->>'total')::numeric;
      -- Descuento MANUAL: conserva su comportamiento (piso del servicio configurado). El cupón ya se validó arriba.
      if p_codigo_cupon is null and v_desc[v_i + 1] > 0 and v_prot_json->>'modo' <> 'RESPALDO_50'
         and (v_linea->>'subtotal')::numeric - v_desc[v_i + 1] < (v_prot_json->>'total')::numeric then
        raise exception 'El descuento deja el servicio "%" por debajo de su cobro mínimo.', v_linea->>'nombre';
      end if;
    else
      v_prot_json := public.recompensas_proteccion_producto(
        (v_linea->>'producto_id')::uuid, (v_linea->>'cantidad')::int);
      if (v_prot_json->>'costo_conocido')::boolean then
        v_prot_total := v_prot_total + (v_prot_json->>'total')::numeric;
      end if;
    end if;
    v_prots := v_prots || jsonb_build_array(v_prot_json);
  end loop;

  v_subtotal_carrito := v_total;

  v_total := round(v_total - v_desc_total, 2);

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

  -- QA-045: lpad(x, 3, '0') TRUNCA a 3 caracteres cuando x tiene más (lpad('1000', 3, '0') = '100'), así que
  -- desde la venta número 1000 el código chocaba con uno ya existente (VEN100…) y TODA venta nueva fallaba con
  -- «duplicate key value violates unique constraint ventas_codigo_key». Hasta la 999 el formato no cambia
  -- (VEN001…VEN999); desde la 1000 se usan todos los dígitos (VEN1000, VEN1001, …).
  v_codigo := 'VEN' || (
    select case when q.n < 1000 then lpad(q.n::text, 3, '0') else q.n::text end
    from (select nextval('public.ventas_codigo_seq') as n) q
  );

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
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'SERVICIO' then v_desc_total
       else coalesce(p_descuento_monto, 0)
     end,
     p_monto_pos_tarjeta, v_cupon_id)
  returning id into v_venta_id;

  if v_cupon_id is not null then
    update public.cupones set venta_id = v_venta_id where id = v_cupon_id;

    insert into public.recompensas_venta_proteccion
      (venta_id, subtotal, descuento, proteccion_total, descuento_maximo)
    values
      (v_venta_id, v_subtotal_carrito, v_desc_total, v_prot_total, v_subtotal_carrito - v_prot_total);

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

  -- ---- Elegibilidad para acreditar (clienta con cuenta web vinculada) ----
  if v_cfg.activo and p_cliente_id is not null then
    select (cliente_web_id is not null) into v_vinculada
    from public.clientes where id = p_cliente_id for update;
    v_vinculada := coalesce(v_vinculada, false);
  end if;

  for v_i in 0..v_n - 1 loop
    v_item := v_items_resueltos -> v_i;
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_subtotal_linea := (v_item->>'subtotal')::numeric;
    v_neto := v_subtotal_linea - v_desc[v_i + 1];
    v_excluida := false;
    v_monedas_linea := null;

    if (v_item->>'tipo') = 'PRODUCTO' then
      update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = (v_item->>'producto_id')::uuid;

      insert into public.venta_items
        (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'PRODUCTO', (v_item->>'producto_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

      v_neto_prod := v_neto_prod + v_neto;
    else
      v_tiene_servicio := true;
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

      -- Atención anterior al corte cuyo aporte ya está en el saldo de apertura:
      -- no se acredita otra vez (solo ese servicio; el resto de la venta sí).
      select exists (select 1 from public.recompensas_apertura_aportes a
                     where a.registro_servicio_id = (v_item->>'registro_servicio_id')::uuid)
        into v_excluida;

      if not v_excluida then
        v_neto_serv := v_neto_serv + v_neto;
      end if;
    end if;

    insert into public.recompensas_venta_detalle
      (venta_id, linea, tipo, servicio_id, producto_id, subtotal, descuento, neto, proteccion, incluida_en_apertura)
    values
      (v_venta_id, v_i + 1, v_item->>'tipo',
       nullif(v_item->>'servicio_id', '')::uuid, nullif(v_item->>'producto_id', '')::uuid,
       v_subtotal_linea, v_desc[v_i + 1], v_neto,
       v_prots -> v_i,
       v_excluida);
  end loop;

  -- ---- Acreditación (una sola vez por venta: clave única) ----------------
  if v_cfg.activo and v_vinculada then
    v_monedas := round(
        v_neto_serv * v_cfg.tasa_serv_monedas / v_cfg.tasa_serv_soles
      + v_neto_prod * v_cfg.tasa_prod_monedas / v_cfg.tasa_prod_soles, 8);

    insert into public.recompensas_movimientos
      (cliente_id, tipo, monedas, clasificacion, venta_id, clave, detalle)
    values
      (p_cliente_id, 'VENTA', v_monedas, v_monedas, v_venta_id, 'venta:' || v_venta_id || ':acredita',
       jsonb_build_object('neto_servicios', v_neto_serv, 'neto_productos', v_neto_prod,
                          'tasa_serv', v_cfg.tasa_serv_monedas || '/' || v_cfg.tasa_serv_soles,
                          'tasa_prod', v_cfg.tasa_prod_monedas || '/' || v_cfg.tasa_prod_soles))
    on conflict (clave) do nothing;

    if v_tiene_servicio then
      v_dia := (now() at time zone 'America/Lima')::date;
      perform public.recompensas_otorgar_sello(p_cliente_id, v_venta_id, v_dia);
    end if;
  end if;

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$function$;

-- 4. confirmar_pedido_productos: el cupón se valida DENTRO de la transacción del pedido (misma lógica que la venta).
CREATE OR REPLACE FUNCTION public.confirmar_pedido_productos(p_producto_ids uuid[], p_tipo_entrega text, p_fecha_entrega date, p_hora_entrega time without time zone, p_metodo_pago text, p_comprobante_url text, p_zona_delivery_id uuid DEFAULT NULL::uuid, p_direccion text DEFAULT NULL::text, p_celular_entrega text DEFAULT NULL::text, p_codigo_cupon text DEFAULT NULL::text, p_tipo_comprobante text DEFAULT 'BOLETA'::text, p_ruc text DEFAULT NULL::text, p_razon_social text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cliente_id          uuid;
  v_costo_delivery      numeric(10, 2) := 0;
  v_subtotal            numeric(10, 2) := 0;
  v_descuento_cupon     numeric(10, 2) := 0;
  v_cupon_tipo_descuento text;
  v_pedido_id           uuid;
  v_horario             record;
  v_dow                 int;
  v_items               jsonb;
  v_eval                jsonb;
  v_msg                 text;
  v_hint                text;
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
      select tipo_descuento into v_cupon_tipo_descuento
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

  -- QA-054: el cupón se valida aquí, ANTES de aceptar el pedido (y de que la clienta pague), con la misma lógica
  -- que confirmar_venta: alcance, compra mínima, nivel, vigencia, tope, costo conocido y protección global.
  if p_codigo_cupon is not null then
    select jsonb_agg(jsonb_build_object('tipo', 'PRODUCTO', 'producto_id', i.producto_id, 'nombre', i.nombre_producto,
                                        'cantidad', i.cantidad, 'subtotal', i.subtotal))
      into v_items
    from public.pedidos_web_items i
    where i.pedido_id = v_pedido_id;
    begin
      v_eval := public.recompensas_validar_cupon_pedido(v_cliente_id, p_codigo_cupon, v_items);
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
      raise exception '%', public.recompensas_motivo_cliente(v_msg, v_hint);
    end;
    v_descuento_cupon := (v_eval->>'descuento')::numeric;
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
$function$;

-- 5. verificar_pago_pedido_web: conserva la revalidación y convierte un cambio posterior de precios, costos o protección
--    en un CONFLICTO claro (sin escrituras parciales, sin cambiar el total en silencio, sin cobrar diferencias).
CREATE OR REPLACE FUNCTION public.verificar_pago_pedido_web(p_pedido_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido   record;
  v_items    jsonb;
  v_venta_id uuid;
  v_total    numeric;
  v_msg      text;
  v_hint     text;
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

  begin
    select cv.venta_id, cv.total into v_venta_id, v_total
    from public.confirmar_venta(
      p_metodo_pago    => case v_pedido.metodo_pago when 'YAPE' then 'Yape' when 'PLIN' then 'Plin' else 'Transferencia' end,
      p_monto_recibido => null,
      p_items          => v_items,
      p_cliente_id     => v_pedido.cliente_id,
      p_codigo_cupon   => v_pedido.cupon_codigo,
      p_costo_delivery => v_pedido.costo_delivery
    ) as cv;
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint in ('COSTO_DESCONOCIDO', 'PROTECCION_GLOBAL') then
      raise exception 'CONFLICTO: el cupón de este pedido ya no cumple la protección económica con los precios o costos actuales (%). El pedido sigue pendiente: no se cobró ni se cambió nada. Revisa el cupón o la protección antes de verificar el pago.', v_msg
        using hint = 'CONFLICTO_PEDIDO';
    end if;
    raise;
  end;

  -- El total vigente debe coincidir con el que la clienta pagó: si cambiaron precios o condiciones no se cobra otro
  -- importe en silencio. La excepción revierte la venta recién creada.
  if round(v_total, 2) <> round(v_pedido.total, 2) then
    raise exception 'CONFLICTO: el total vigente (S/ %) ya no coincide con el que la clienta pagó (S/ %): cambiaron precios o condiciones después de crear el pedido. El pedido sigue pendiente: no se cobró ni se cambió nada.', round(v_total, 2), round(v_pedido.total, 2)
      using hint = 'CONFLICTO_PEDIDO';
  end if;

  update public.pedidos_web
  set pago_verificado = true,
      pago_verificado_en = now(),
      pago_verificado_por = auth.uid(),
      venta_id = v_venta_id,
      estado = 'LISTO'
  where id = p_pedido_id;

  return v_venta_id;
end;
$function$;

commit;
