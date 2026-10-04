-- =========================================================
-- Recompensas Fase 2 — corrección versionada del núcleo (QA-033 reabierto,
-- QA-041 y regla de cupones en servicios sin protección).
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
-- No reescribe 20261003000001 (ya aplicada en Local): la sustituye hacia
-- adelante. En una instalación limpia se aplican en orden 0001 -> 0002 y el
-- estado final es el mismo que el de Local tras aplicar ambas.
--
--  1. QA-033: confirmar_venta() y anular_venta() recuperan el rechazo de roles
--     distintos de ADMINISTRADOR/CAJERA que 20261002000007 había añadido y
--     que 20261003000001 perdió al redefinirlas. Se conserva toda la lógica
--     nueva (recompensas, stock, cupones, referidos, conciliación del pedido).
--  2. QA-041: recompensas_distribuir() reparte los centavos por mayor resto
--     (Hamilton, desempate por posición). Invariantes: 0 <= d_i <= base_i,
--     suma exacta, líneas excluidas en cero, determinista.
--  3. Servicios SIN protección configurada admiten cupones con descuento de
--     hasta el 50 % del precio efectivo (truncado a centavos); CON protección
--     manda el piso (precio efectivo - protección total). Ausente != cero.
--     Si una partida excede su límite se rechaza el cupón entero (sin
--     consumir ni escribir parcialmente). El premio de servicio y el catálogo
--     reflejan la misma regla; ya no se exige protección para emitir ese canje.
-- =========================================================

begin;

create or replace function public.recompensas_distribuir(p_bases numeric[], p_total numeric)
returns numeric[]
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  n int := coalesce(array_length(p_bases, 1), 0);
  i int;
  mejor int;
  suma_c bigint := 0;
  tot_c bigint;
  suma_piso bigint := 0;
  resto bigint;
  ideal numeric;
  base_c bigint[] := '{}';
  res_c bigint[] := '{}';
  frac numeric[] := '{}';
  res numeric[] := '{}';
begin
  for i in 1..n loop
    base_c[i] := case when coalesce(p_bases[i], 0) > 0 then round(p_bases[i] * 100)::bigint else 0 end;
    suma_c := suma_c + base_c[i];
    res_c[i] := 0;
    frac[i] := 0;
    res[i] := 0;
  end loop;
  tot_c := least(round(greatest(coalesce(p_total, 0), 0) * 100)::bigint, suma_c);
  if suma_c = 0 or tot_c = 0 then return res; end if;

  for i in 1..n loop
    if base_c[i] > 0 then
      ideal := tot_c::numeric * base_c[i] / suma_c;
      res_c[i] := floor(ideal)::bigint;
      frac[i] := ideal - res_c[i];
      suma_piso := suma_piso + res_c[i];
    end if;
  end loop;

  resto := tot_c - suma_piso;
  while resto > 0 loop
    mejor := 0;
    for i in 1..n loop
      if base_c[i] > 0 and res_c[i] < base_c[i] and (mejor = 0 or frac[i] > frac[mejor]) then
        mejor := i;
      end if;
    end loop;
    exit when mejor = 0;
    res_c[mejor] := res_c[mejor] + 1;
    frac[mejor] := -1;
    resto := resto - 1;
  end loop;

  for i in 1..n loop res[i] := res_c[i]::numeric / 100; end loop;
  return res;
end;
$$;
revoke execute on function public.recompensas_distribuir(numeric[], numeric) from public, anon, authenticated;

create or replace function public.confirmar_venta(p_metodo_pago text, p_monto_recibido numeric, p_items jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0, p_descuento_monto numeric DEFAULT 0, p_monto_pos_tarjeta numeric DEFAULT NULL::numeric, p_codigo_cupon text DEFAULT NULL::text, p_costo_delivery numeric DEFAULT 0)
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

create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
  v_cliente_id uuid;
  v_mov record;
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  -- QA-033 (regla aprobada): solo ADMINISTRADOR y CAJERA anulan ventas.
  if v_rol not in ('ADMINISTRADOR', 'CAJERA') then
    raise exception 'Solo el administrador o la cajera pueden anular ventas';
  end if;

  select estado, fecha, cliente_id into v_estado, v_fecha, v_cliente_id
  from public.ventas
  where id = p_venta_id
  for update;

  if v_estado is null then
    raise exception 'La venta no existe';
  end if;

  if v_estado = 'ANULADA' then
    raise exception 'Esta venta ya está anulada';
  end if;

  if v_rol = 'CAJERA' and not public.es_hoy(v_fecha) then
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

  select cupon_id into v_cupon_id from public.ventas where id = p_venta_id;

  if v_cupon_id is not null then
    -- Vigente: vuelve a disponible con su vencimiento original. Vencido: queda
    -- como estaba (consumido) y no se reactiva. Las monedas del canje original
    -- NO se devuelven.
    update public.cupones
    set estado = 'DISPONIBLE', canjeado_en = null, venta_id = null
    where id = v_cupon_id
      and (vigente_hasta is null or vigente_hasta > now())
    returning cliente_id, origen into v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      update public.cupones
      set estado = 'ANULADO'
      where origen = 'REFERIDO_RECOMPENSA'
        and referido_id = v_cupon_cliente_id
        and estado = 'DISPONIBLE';
    end if;
  end if;

  -- Reversión de monedas y clasificación ganadas por esta venta (una sola vez;
  -- el saldo puede quedar negativo, nunca bloquea la anulación).
  for v_mov in
    select * from public.recompensas_movimientos
    where venta_id = p_venta_id and tipo = 'VENTA'
  loop
    insert into public.recompensas_movimientos
      (cliente_id, tipo, monedas, clasificacion, venta_id, clave, detalle)
    values
      (v_mov.cliente_id, 'VENTA_REVERSION', -v_mov.monedas, -v_mov.clasificacion, p_venta_id,
       'venta:' || p_venta_id || ':revierte',
       jsonb_build_object('revierte', v_mov.id))
    on conflict (clave) do nothing;
  end loop;

  if v_cliente_id is not null then
    perform public.recompensas_revisar_sello(
      v_cliente_id, p_venta_id, (v_fecha at time zone 'America/Lima')::date);
  end if;

  -- QA-027: el pedido web respaldado por esta venta ya no tiene venta vigente.
  update public.pedidos_web
  set estado = 'CANCELADO', actualizado_en = now()
  where venta_id = p_venta_id
    and estado <> 'CANCELADO';
end;
$function$;

-- ---------------------------------------------------------
-- Canje: ya no se exige protección para emitir un premio de servicio.
-- (Misma función con ese único cambio.)
-- ---------------------------------------------------------
create or replace function public._recompensas_emitir_canje(
  p_cliente_id uuid, p_catalogo_id uuid, p_clave text, p_origen text)
returns table (canje_id uuid, cupon_id uuid, codigo text, costo numeric, repetido boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.recompensas_config;
  v_cat public.recompensas_catalogo;
  v_canje public.recompensas_canjes;
  v_cupon public.cupones;
  v_s record;
  v_costo numeric;
  v_nivel text;
  v_usados int;
  v_usados_cli int;
  v_vence timestamptz;
  v_codigo text;
  v_canje_id uuid := gen_random_uuid();
  v_tipo_desc text;
  v_piso numeric;
begin
  if p_clave is null or btrim(p_clave) = '' or length(p_clave) > 100 then
    raise exception 'Falta la clave de la operación.';
  end if;

  -- Serializa las operaciones de ESTA clienta (saldo/sellos).
  perform 1 from public.clientes where id = p_cliente_id for update;

  select * into v_canje from public.recompensas_canjes
  where cliente_id = p_cliente_id and clave_idem = p_clave;
  if v_canje.id is not null then
    if v_canje.catalogo_id <> p_catalogo_id then
      raise exception 'Esa clave de operación ya se usó con otra recompensa.';
    end if;
    return query
      select v_canje.id, v_canje.cupon_id, c.codigo, v_canje.costo, true
      from public.cupones c where c.id = v_canje.cupon_id;
    return;
  end if;

  select * into v_cfg from public.recompensas_config where id = 1;
  if not v_cfg.activo then
    raise exception 'Recompensas todavía no está activo.';
  end if;

  -- Serializa el cupo de ESTA recompensa (último cupo bajo concurrencia).
  select * into v_cat from public.recompensas_catalogo
  where id = p_catalogo_id for update;
  if v_cat.id is null or not v_cat.activo or v_cat.origen <> p_origen then
    raise exception 'Esa recompensa no está disponible.';
  end if;
  if v_cat.reclamo_desde is not null and now() < v_cat.reclamo_desde then
    raise exception 'Esa recompensa todavía no se puede reclamar.';
  end if;
  if v_cat.reclamo_hasta is not null and now() > v_cat.reclamo_hasta then
    raise exception 'El período para reclamar esa recompensa terminó.';
  end if;

  select * into v_s from public.recompensas_saldos(p_cliente_id);
  v_nivel := v_s.nivel;
  if public.recompensas_nivel_orden(v_cat.nivel_minimo) > public.recompensas_nivel_orden(v_nivel) then
    raise exception 'Esa recompensa requiere nivel % o superior.', v_cat.nivel_minimo;
  end if;

  select count(*) into v_usados from public.recompensas_canjes where catalogo_id = p_catalogo_id;
  if v_cat.cupo_global is not null and v_usados >= v_cat.cupo_global then
    raise exception 'Esa recompensa se agotó.';
  end if;
  select count(*) into v_usados_cli from public.recompensas_canjes
  where catalogo_id = p_catalogo_id and cliente_id = p_cliente_id;
  if v_cat.limite_por_clienta is not null and v_usados_cli >= v_cat.limite_por_clienta then
    raise exception 'Ya alcanzaste el límite de esta recompensa.';
  end if;

  if p_origen = 'SELLOS' then
    v_costo := v_cfg.sellos_por_premio;
    if v_s.sellos < v_costo then
      raise exception 'Necesitas % sellos para reclamar un premio.', v_costo;
    end if;
  else
    v_costo := case v_nivel
      when 'VIP' then coalesce(v_cat.costo_vip, v_cat.costo_premium, v_cat.costo_basico)
      when 'PREMIUM' then coalesce(v_cat.costo_premium, v_cat.costo_basico)
      else v_cat.costo_basico end;
    if v_s.monedas < v_costo then
      raise exception 'No tienes monedas suficientes para esta recompensa.';
    end if;
  end if;

  v_vence := case
    when v_cat.cupon_vigencia_dias is not null and v_cat.cupon_vence_el is not null
      then least(now() + make_interval(days => v_cat.cupon_vigencia_dias), v_cat.cupon_vence_el)
    when v_cat.cupon_vigencia_dias is not null then now() + make_interval(days => v_cat.cupon_vigencia_dias)
    else v_cat.cupon_vence_el end;

  v_tipo_desc := case v_cat.tipo when 'MONTO' then 'MONTO_FIJO' else v_cat.tipo end;
  v_codigo := public.generar_codigo_cupon();

  insert into public.cupones
    (cliente_id, codigo, origen, valor, tipo_descuento, catalogo_id, nombre_premio, servicio_id,
     alcance, minimo_compra, tope, nivel_minimo, vigente_hasta, nivel_aplicado, costo_aplicado)
  values
    (p_cliente_id, v_codigo,
     case p_origen when 'SELLOS' then 'RECOMPENSA_SELLOS' else 'RECOMPENSA_MONEDAS' end,
     v_cat.valor, v_tipo_desc, v_cat.id, v_cat.nombre, v_cat.servicio_id,
     v_cat.alcance, v_cat.minimo_compra, v_cat.tope, v_cat.nivel_minimo, v_vence, v_nivel, v_costo)
  returning * into v_cupon;

  insert into public.recompensas_canjes
    (id, cliente_id, catalogo_id, clave_idem, origen, costo, nivel_aplicado, cupon_id)
  values (v_canje_id, p_cliente_id, p_catalogo_id, p_clave, p_origen, v_costo, v_nivel, v_cupon.id);

  if p_origen = 'SELLOS' then
    insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, canje_id, clave, detalle)
    values (p_cliente_id, 'CANJE_SELLOS', -v_costo::int, v_canje_id, 'canje:' || v_canje_id,
            jsonb_build_object('premio', v_cat.nombre));
  else
    insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clasificacion, canje_id, clave, detalle)
    values (p_cliente_id, 'CANJE', -v_costo, 0, v_canje_id, 'canje:' || v_canje_id,
            jsonb_build_object('premio', v_cat.nombre, 'nivel', v_nivel));
  end if;

  return query select v_canje_id, v_cupon.id, v_codigo, v_costo, false;
end;
$$;
revoke execute on function public._recompensas_emitir_canje(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------
-- Catálogo de la clienta: el pago mínimo de un premio de servicio sale de la
-- protección (si está configurada) o de la mitad del precio de lista (si no).
-- `regla_servicio` indica cuál aplica, sin exponer los componentes internos.
-- ---------------------------------------------------------
drop function if exists public.mi_catalogo_recompensas(text);
create function public.mi_catalogo_recompensas(p_origen text default 'MONEDAS')
returns table (id uuid, nombre text, descripcion text, origen text, tipo text, valor numeric,
               servicio_nombre text, alcance text, minimo_compra numeric, tope numeric,
               nivel_minimo text, costo numeric, reclamo_desde timestamptz, reclamo_hasta timestamptz,
               cupon_vigencia_dias int, cupon_vence_el timestamptz, cupo_restante int,
               limite_por_clienta int, reclamados_por_mi int, pago_minimo numeric,
               regla_servicio text, canjeable boolean, motivo text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with yo as (
    select public.mi_cliente_id() as cid
  ), s as (
    select * from yo, lateral public.recompensas_saldos(yo.cid) where yo.cid is not null
  ), cfg as (select * from public.recompensas_config where id = 1)
  select cat.id, cat.nombre, cat.descripcion, cat.origen, cat.tipo, cat.valor, sv.nombre,
         cat.alcance, cat.minimo_compra, cat.tope, cat.nivel_minimo,
         k.costo, cat.reclamo_desde, cat.reclamo_hasta, cat.cupon_vigencia_dias, cat.cupon_vence_el,
         case when cat.cupo_global is null then null
              else greatest(cat.cupo_global - (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id), 0)::int end,
         cat.limite_por_clienta,
         (select count(*)::int from public.recompensas_canjes z where z.catalogo_id = cat.id and z.cliente_id = s.cid),
         case when cat.tipo <> 'SERVICIO' then null
              when sp.servicio_id is not null then sp.total
              else sv.precio - floor(sv.precio * 50) / 100 end,
         case when cat.tipo <> 'SERVICIO' then null
              when sp.servicio_id is not null then 'PISO' else 'MITAD' end,
         m.motivo is null, m.motivo
  from public.recompensas_catalogo cat
  cross join cfg
  join s on true
  left join public.servicios sv on sv.id = cat.servicio_id
  left join public.servicios_proteccion sp on sp.servicio_id = cat.servicio_id
  cross join lateral (
    select case when cat.origen = 'SELLOS' then cfg.sellos_por_premio::numeric
                else case s.nivel when 'VIP' then coalesce(cat.costo_vip, cat.costo_premium, cat.costo_basico)
                                  when 'PREMIUM' then coalesce(cat.costo_premium, cat.costo_basico)
                                  else cat.costo_basico end end as costo
  ) k
  cross join lateral (
    select case
        when not cfg.activo then 'Recompensas todavía no está activo.'
        when cat.reclamo_desde is not null and now() < cat.reclamo_desde then 'Todavía no se puede reclamar.'
        when cat.reclamo_hasta is not null and now() > cat.reclamo_hasta then 'El período para reclamar terminó.'
        when public.recompensas_nivel_orden(cat.nivel_minimo) > public.recompensas_nivel_orden(s.nivel)
          then 'Requiere nivel ' || cat.nivel_minimo || '.'
        when cat.cupo_global is not null and (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id) >= cat.cupo_global then 'Agotada.'
        when cat.limite_por_clienta is not null and (select count(*) from public.recompensas_canjes z where z.catalogo_id = cat.id and z.cliente_id = s.cid) >= cat.limite_por_clienta then 'Ya alcanzaste el límite.'
        when cat.origen = 'SELLOS' and s.sellos < cfg.sellos_por_premio then 'Necesitas ' || cfg.sellos_por_premio || ' sellos.'
        when cat.origen = 'MONEDAS' and s.monedas < k.costo then 'No tienes monedas suficientes.'
        else null
      end as motivo
  ) m
  where cat.activo and cat.origen = p_origen
  order by k.costo, cat.nombre;
$$;
revoke execute on function public.mi_catalogo_recompensas(text) from public, anon;
grant execute on function public.mi_catalogo_recompensas(text) to authenticated;

commit;
