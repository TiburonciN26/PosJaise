-- =========================================================
-- QA-045 — Desde la venta 1000 ninguna venta nueva se puede confirmar.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Hallazgo (durante la regresión de QA-043/QA-044): confirmar_venta() arma el código con
-- 'VEN' || lpad(nextval(...)::text, 3, '0'). lpad con longitud 3 TRUNCA cuando el número tiene 4 dígitos, de
-- modo que la venta 1000 intentaba el código 'VEN100' (ya existente) y fallaba por ventas_codigo_key; lo mismo
-- ocurre con cada venta siguiente. En Local la secuencia ya pasó de 1000 y toda venta fallaba. Es un defecto
-- latente del diseño original (001/006): cualquier base real fallará al llegar a la venta 1000.
--
-- Cambio mínimo: SOLO la generación del código. Hasta 999 el formato es idéntico (VEN001…VEN999); desde 1000
-- se usan todos los dígitos. El resto de confirmar_venta() es EXACTAMENTE la definición vigente (misma firma,
-- permisos QA-033, recompensas, cupones, protección y reparto).
-- =========================================================

begin;

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

    if public.recompensas_nivel_orden(v_cupon.nivel_minimo) >
       public.recompensas_nivel_orden((select s.nivel from public.recompensas_saldos(v_cupon_cliente_id) s)) then
      raise exception 'Este cupón requiere nivel % o superior', v_cupon.nivel_minimo;
    end if;

    for v_i in 0..v_n - 1 loop
      v_linea := v_items_resueltos -> v_i;
      v_tipo_linea := v_linea->>'tipo';
      if v_cupon.tipo_descuento = 'SERVICIO' then
        if v_tipo_linea = 'SERVICIO' and not v_servicio_ya
           and (v_linea->>'servicio_id')::uuid = v_cupon.servicio_id then
          v_bases[v_i + 1] := (v_linea->>'subtotal')::numeric;
          v_servicio_ya := true;
        end if;
      elsif v_cupon.alcance = 'TODO'
         or (v_cupon.alcance = 'SERVICIOS' and v_tipo_linea = 'SERVICIO')
         or (v_cupon.alcance = 'PRODUCTOS' and v_tipo_linea = 'PRODUCTO') then
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
      v_cupon_pct_aplicado := v_cupon.valor;
      v_desc_total := round(v_elig_total * v_cupon.valor / 100, 2);
      if v_cupon.tope is not null and v_desc_total > v_cupon.tope then
        v_desc_total := v_cupon.tope;
      end if;
    elsif v_cupon.tipo_descuento = 'SERVICIO' then
      -- Premio de servicio: cubre el precio efectivo menos el piso protegido.
      select * into v_prot from public.servicios_proteccion where servicio_id = v_cupon.servicio_id;
      if v_prot.servicio_id is null then
        -- sin protección configurada: hasta el 50 % del precio efectivo (nunca redondeado hacia arriba)
        v_desc_total := floor(v_elig_total * 50) / 100;
      else
        v_desc_total := greatest(v_elig_total - v_prot.total, 0);
      end if;
    else
      p_descuento_monto := v_cupon.valor;
      if p_descuento_monto > v_elig_total then
        raise exception 'Este cupón supera el importe al que puede aplicarse. Puedes utilizarlo en otra compra.';
      end if;
      v_desc_total := p_descuento_monto;
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

  -- ---- Protección del costo por servicio (por partida) -------------------
  for v_i in 0..v_n - 1 loop
    v_linea := v_items_resueltos -> v_i;
    if v_linea->>'tipo' = 'SERVICIO' and v_desc[v_i + 1] > 0 then
      select * into v_prot from public.servicios_proteccion
      where servicio_id = (v_linea->>'servicio_id')::uuid;

      if v_prot.servicio_id is null then
        -- Sin protección configurada: el cupón puede descontar hasta el 50 % del
        -- precio efectivo (truncado a centavos). El descuento manual conserva su
        -- comportamiento previo. Ausente != configurada en cero.
        if p_codigo_cupon is not null
           and v_desc[v_i + 1] > floor((v_linea->>'subtotal')::numeric * 50) / 100 then
          raise exception 'Este cupón supera el límite del servicio "%": en servicios sin protección configurada los cupones pueden descontar hasta el 50 %% del precio. Puedes utilizarlo en otra compra.', v_linea->>'nombre';
        end if;
      elsif (v_linea->>'subtotal')::numeric - v_desc[v_i + 1] < v_prot.total then
        if p_codigo_cupon is not null then
          raise exception 'Este cupón supera el límite del servicio "%": el descuento debe respetar el importe mínimo protegido. Puedes utilizarlo en otra compra.', v_linea->>'nombre';
        end if;
        raise exception 'El descuento deja el servicio "%" por debajo de su cobro mínimo.', v_linea->>'nombre';
      end if;
    end if;
  end loop;

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
    v_prot := null;
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

      select * into v_prot from public.servicios_proteccion
      where servicio_id = (v_item->>'servicio_id')::uuid;

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
       case when v_prot.servicio_id is not null then jsonb_build_object(
         'materiales', v_prot.materiales, 'asistente', v_prot.asistente,
         'otros', v_prot.otros, 'total', v_prot.total) end,
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

commit;
