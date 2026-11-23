-- =========================================================
-- Ventas: el adelanto de una cita es un ADELANTO, no un descuento
--
-- La migración 20261121000004 aplicaba el adelanto como descuento en soles. Eso tiene un efecto indeseado: el Dashboard calcula
-- «Descuentos» como (suma de los ítems) − (lo cobrado sin envío), así que el adelanto —dinero que la clienta ya entregó al
-- agendar— aparecía como plata regalada. No lo es: el servicio se vendió por su precio completo (adelanto + lo que se cobra hoy).
--
-- FLUJO CORRECTO:
--   · El precio de la línea sigue siendo el original y el adelanto se resta del total a cobrar (ventas.total = lo cobrado hoy).
--   · El campo de descuento del carrito YA NO se llena solo: queda para descuentos reales o cupones, que conviven con el adelanto
--     (si se aplica uno, aparece su línea aparte como siempre).
--   · ventas.descuento_monto / descuento_pct / cupón son SOLO descuentos reales; el adelanto vive en ventas.adelanto_monto.
--
-- CAMBIOS:
--   1. ventas.adelanto_monto (por defecto 0) con cuánto adelanto se aplicó en esa venta. El detalle por cita sigue en
--      ventas_adelantos (anular la venta devuelve el adelanto a la cita).
--   2. confirmar_venta: p_adelanto_monto es independiente del descuento. Se valida contra lo pendiente de las citas del ticket
--      (igual que antes), no puede superar (subtotal − descuento), reduce el total a cobrar y ya NO se mezcla con el reparto del
--      descuento ni con el piso de «cobro mínimo» (no es un descuento, no puede dejar un servicio bajo su costo).
--   3. resumen_dashboard y detalle_dashboard: «Descuentos» excluye el adelanto (subtotal − (total − envío + adelanto)). Los
--      ingresos del Dashboard no cambian: se calculan sobre los ítems, que siempre llevaron el precio completo.
--   4. resumen_estadisticas: el ingreso bruto y la tendencia suman el adelanto (es ingreso de la venta aunque se cobrara antes).
--      «Métodos de pago» sigue sumando lo cobrado hoy (ventas.total), que es lo que entró por caja en esa venta.
--      resumen_historial («total recaudado») no cambia: es lo cobrado en el ticket.
-- Ventas ya registradas con la versión anterior (adelanto dentro del descuento) no existen en producción: 000004 no se subió.
-- =========================================================

begin;

alter table public.ventas
  add column if not exists adelanto_monto numeric(10, 2) not null default 0
    check (adelanto_monto >= 0);

CREATE OR REPLACE FUNCTION public.confirmar_venta(p_metodo_pago text, p_monto_recibido numeric, p_items jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0, p_descuento_monto numeric DEFAULT 0, p_monto_pos_tarjeta numeric DEFAULT NULL::numeric, p_codigo_cupon text DEFAULT NULL::text, p_costo_delivery numeric DEFAULT 0, p_adelanto_monto numeric DEFAULT 0)
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
  -- Adelanto de cita aplicado como descuento (ver migración 20261121000004)
  v_adel record;
  v_adel_restante numeric := 0;
  v_adel_toma numeric;
  v_adel_asig jsonb := '[]'::jsonb;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  -- QA-033 (regla aprobada): solo ADMINISTRADOR, CAJERA y ENCARGADA registran ventas.
  if public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
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

  -- El adelanto de una cita NO es un descuento: es dinero que la clienta ya entregó al agendar. Va aparte (p_adelanto_monto), se
  -- resta del total a cobrar y se guarda en ventas.adelanto_monto; p_descuento_monto / p_descuento_pct / cupón siguen siendo
  -- SOLO descuentos reales y pueden convivir con él. Se valida más abajo contra lo que quedó pendiente en las citas del ticket.
  if p_adelanto_monto is null then
    p_adelanto_monto := 0;
  end if;
  if p_adelanto_monto < 0 then
    raise exception 'El adelanto no puede ser negativo';
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

  -- ---- Adelanto de cita: se valida contra lo que de verdad quedó pendiente en las citas de estas atenciones ------------
  -- Por cita: adelanto - lo ya aplicado en ventas ACTIVAS, y no más que el precio de sus atenciones en ESTE ticket.
  -- Se reparte en orden de cita hasta cubrir p_adelanto_monto; si no alcanza, se rechaza (no se puede inventar un adelanto).
  if p_adelanto_monto > 0 then
    v_adel_restante := p_adelanto_monto;
    for v_adel in
      select a.cita_id,
             least(a.pendiente, coalesce((
               select sum((x ->> 'subtotal')::numeric)
               from jsonb_array_elements(v_items_resueltos) x
               where (x ->> 'registro_servicio_id') is not null
                 and (x ->> 'registro_servicio_id')::uuid = any (a.registro_ids)
             ), 0)) as disponible
      from public.adelantos_pendientes_de_atenciones((
        select coalesce(array_agg((x ->> 'registro_servicio_id')::uuid), '{}'::uuid[])
        from jsonb_array_elements(v_items_resueltos) x
        where (x ->> 'registro_servicio_id') is not null
      )) a
      order by a.cita_id
    loop
      exit when v_adel_restante <= 0;
      v_adel_toma := least(v_adel_restante, v_adel.disponible);
      if v_adel_toma > 0 then
        v_adel_asig := v_adel_asig || jsonb_build_object('cita_id', v_adel.cita_id, 'monto', v_adel_toma);
        v_adel_restante := v_adel_restante - v_adel_toma;
      end if;
    end loop;
    if v_adel_restante > 0 then
      raise exception 'El adelanto (%) supera el adelanto pendiente de las citas de estas atenciones', p_adelanto_monto;
    end if;
  end if;

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
      -- El adelanto de cita no entra aquí: no es un descuento (v_desc solo trae descuentos reales), la clienta paga el precio
      -- completo entre el adelanto y lo que se cobra hoy, así que no puede dejar el servicio bajo su cobro mínimo.
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

  if p_adelanto_monto > 0 and p_adelanto_monto + v_desc_total > v_subtotal_carrito then
    raise exception 'El adelanto (%) y el descuento (%) superan el total de la venta (%)',
      p_adelanto_monto, v_desc_total, v_subtotal_carrito;
  end if;

  v_total := round(v_total - v_desc_total - p_adelanto_monto, 2);

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
    (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct, descuento_monto, monto_pos_tarjeta, cupon_id, adelanto_monto)
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
     p_monto_pos_tarjeta, v_cupon_id, p_adelanto_monto)
  returning id into v_venta_id;

  if p_adelanto_monto > 0 then
    insert into public.ventas_adelantos (venta_id, cita_id, monto)
    select v_venta_id, (x ->> 'cita_id')::uuid, (x ->> 'monto')::numeric
    from jsonb_array_elements(v_adel_asig) x;
  end if;

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

CREATE OR REPLACE FUNCTION public.resumen_dashboard(p_desde timestamp with time zone, p_hasta timestamp with time zone)
 RETURNS TABLE(ingreso_productos numeric, ingreso_servicios numeric, costo_productos numeric, comisiones_pagadas numeric, descuentos numeric, productos_vendidos bigint, servicios_realizados bigint, cantidad_ventas bigint, envio_cobrado numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with ventas_periodo as (
    select v.id, v.total, v.adelanto_monto,
           coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0) as envio
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol <> 'ADMINISTRADOR'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  )
  select
    coalesce(sum(subtotal) filter (where tipo = 'PRODUCTO'), 0) as ingreso_productos,
    coalesce(sum(subtotal) filter (where tipo = 'SERVICIO'), 0) as ingreso_servicios,
    coalesce(
      (select sum(pv.costo * i.cantidad)
         from items_periodo i
         join public.productos_vista pv on pv.id = i.producto_id
        where i.tipo = 'PRODUCTO'),
      0
    ) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    coalesce(
      (select sum(subtotal) from items_periodo)
        - (select coalesce(sum(total - envio + adelanto_monto), 0) from ventas_periodo),
      0
    ) as descuentos,
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas,
    (select coalesce(sum(envio), 0) from ventas_periodo) as envio_cobrado
  from items_periodo
$function$;

CREATE OR REPLACE FUNCTION public.detalle_dashboard(p_desde timestamp with time zone, p_hasta timestamp with time zone, p_seccion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_filas jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede ver el detalle del dashboard' using errcode = '42501';
  end if;

  if p_seccion = 'productos' then
    select coalesce(jsonb_agg(f order by f.ingreso desc, f.nombre), '[]'::jsonb) into v_filas
    from (
      select
        coalesce(pv.nombre, vi.nombre) as nombre,
        vi.producto_id,
        sum(vi.cantidad)::int as unidades,
        sum(vi.subtotal) as ingreso,
        coalesce(sum(pv.costo * vi.cantidad), 0) as costo,
        sum(vi.subtotal) - coalesce(sum(pv.costo * vi.cantidad), 0) as ganancia,
        pv.stock_actual as stock_actual,
        jsonb_agg(
          jsonb_build_object(
            'fecha', v.fecha,
            'codigo', v.codigo,
            'cliente', c.nombre,
            'vendedor', u.nombre_completo,
            'cantidad', vi.cantidad,
            'precio_unitario', vi.precio_unitario,
            'subtotal', vi.subtotal
          ) order by v.fecha desc
        ) as ventas
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
      left join public.productos_vista pv on pv.id = vi.producto_id
      left join public.clientes c on c.id = coalesce(vi.cliente_id, v.cliente_id)
      left join public.usuarios u on u.id = v.vendedor_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and vi.tipo = 'PRODUCTO'
      group by vi.producto_id, coalesce(pv.nombre, vi.nombre), pv.stock_actual
    ) f;

  elsif p_seccion = 'servicios' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        vi.nombre as servicio,
        c.nombre as cliente,
        a.nombres_completos as asistente,
        vi.cantidad,
        vi.subtotal as precio,
        vi.pago_asistente as comision
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
      left join public.clientes c on c.id = coalesce(vi.cliente_id, v.cliente_id)
      left join public.asistentes a on a.id = vi.asistente_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and vi.tipo = 'SERVICIO'
    ) f;

  elsif p_seccion = 'descuentos' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        c.nombre as cliente,
        s.subtotal_items as subtotal,
        s.subtotal_items - (v.total + v.adelanto_monto - s.envio) as descuento,
        v.descuento_pct,
        v.descuento_monto,
        cu.codigo as cupon,
        v.total - s.envio as total
      from public.ventas v
      cross join lateral (
        select
          coalesce((select sum(vi.subtotal) from public.venta_items vi where vi.venta_id = v.id), 0) as subtotal_items,
          coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0) as envio
      ) s
      left join public.clientes c on c.id = v.cliente_id
      left join public.cupones cu on cu.id = v.cupon_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and round(s.subtotal_items - (v.total + v.adelanto_monto - s.envio), 2) > 0
    ) f;

  elsif p_seccion = 'comisiones' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        rs.fecha,
        u.nombre_completo as asistente,
        sv.nombre as servicio,
        c.nombre as cliente,
        rs.precio,
        rs.porcentaje_aplicado as porcentaje,
        coalesce(rs.pago_asistente, 0) as pago
      from public.registro_servicios rs
      join public.usuarios u on u.id = rs.usuario_id
      left join public.servicios sv on sv.id = rs.servicio_id
      left join public.clientes c on c.id = rs.cliente_id
      where rs.estado = 'ACTIVO'
        and u.rol <> 'ADMINISTRADOR'
        and rs.fecha >= p_desde and rs.fecha < p_hasta
    ) f;

  elsif p_seccion = 'envios' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        c.nombre as cliente,
        p.tipo_entrega,
        p.costo_delivery as envio
      from public.pedidos_web p
      join public.ventas v on v.id = p.venta_id
      left join public.clientes c on c.id = v.cliente_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and coalesce(p.costo_delivery, 0) > 0
    ) f;

  else
    raise exception 'Sección de detalle desconocida: %', p_seccion using errcode = '22023';
  end if;

  return v_filas;
end
$function$;

CREATE OR REPLACE FUNCTION public.resumen_estadisticas(p_desde timestamp with time zone, p_hasta timestamp with time zone, p_incluir_detalle boolean DEFAULT true)
 RETURNS TABLE(ingreso_bruto numeric, cantidad_ventas bigint, costo_productos numeric, comisiones_pagadas numeric, tendencia jsonb, top_productos jsonb, top_servicios jsonb, metodos_pago jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with ventas_periodo as (
    select v.id, v.fecha, v.total, v.metodo_pago,
           v.total + v.adelanto_monto - coalesce(
             (select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id),
             0
           ) as total_sin_envio
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.nombre, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol <> 'ADMINISTRADOR'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  ),
  costo_total as (
    select coalesce(sum(pv.costo * i.cantidad), 0) as costo
    from items_periodo i
    join public.productos_vista pv on pv.id = i.producto_id
    where i.tipo = 'PRODUCTO'
  ),
  tendencia_dias as (
    select (fecha at time zone 'America/Lima')::date as dia, coalesce(sum(total_sin_envio), 0) as monto
    from ventas_periodo
    group by 1
  ),
  top_prod as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'PRODUCTO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  top_serv as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'SERVICIO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  metodos as (
    select metodo_pago as metodo, count(*) as cantidad, coalesce(sum(total), 0) as monto
    from ventas_periodo
    group by metodo_pago
  )
  select
    coalesce((select sum(total_sin_envio) from ventas_periodo), 0) as ingreso_bruto,
    (select count(*) from ventas_periodo) as cantidad_ventas,
    (select costo from costo_total) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('fecha', dia, 'monto', monto) order by dia) from tendencia_dias),
        '[]'::jsonb
      )
    else '[]'::jsonb end as tendencia,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_prod),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_productos,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_serv),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_servicios,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)) from metodos),
        '[]'::jsonb
      )
    else '[]'::jsonb end as metodos_pago
$function$;

-- confirmar_venta y detalle_dashboard conservan su firma: CREATE OR REPLACE mantiene sus permisos.

commit;
