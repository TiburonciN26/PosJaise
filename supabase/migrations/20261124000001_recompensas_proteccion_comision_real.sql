-- =========================================================
-- Recompensas — protección de servicios con la COMISIÓN REAL de la asistente.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Por qué: la protección de un servicio usaba un único «% protegido de asistente» por servicio, una ESTIMACIÓN. Pero cada
-- asistente tiene un porcentaje distinto para cada servicio (tabla porcentajes) y cada atención ya guarda su comisión real
-- (registro_servicios.porcentaje_aplicado / pago_asistente). Regla confirmada por la dueña (2026-11-24): a la asistente se le
-- paga su comisión sobre el PRECIO REAL del servicio; una promoción o cupón del salón NO la reduce. Por eso el piso de un
-- cupón debe descontar el pago real y fijo de esa asistente, no un porcentaje supuesto.
--
-- Qué cambia (orden de prioridad del costo de mano de obra de UNA línea de venta):
--   1. COMISION_REAL : la atención vendida → su comisión (precio de la atención x % de esa asistente en ese servicio, o el pago
--                      guardado si ya no hay %). Nunca baja por un descuento o cupón del salón.
--   2. DUENA         : la atención la hizo una cuenta ADMINISTRADOR (se queda con el 100 %, no es un pago en efectivo) → 0.
--   3. COMISION_MAX  : sin atención conocida (p. ej. el catálogo en la vista de caja) → el % MÁS ALTO que algún asistente
--                      activo tenga en ese servicio (caso conservador).
--   4. PORCENTAJE    : la estimación antigua (servicios_proteccion.asistente_pct) si nadie tiene % asignado.
--   5. IMPORTE_FIJO  : la protección antigua en S/ si tampoco hay porcentaje.
-- Sin fila en servicios_proteccion el comportamiento NO cambia (respaldo del 50 %): sin materiales no hay piso confiable.
--
-- Cambios de firma: recompensas_proteccion_servicio gana un 3.er parámetro opcional (la atención). Se elimina la firma de
-- 2 parámetros para no dejar una sobrecarga ambigua. confirmar_venta y recompensas_evaluar_cupon pasan la atención de cada
-- línea; su comportamiento no cambia en nada más (las definiciones son las vigentes con el parche en los puntos de llamada).
-- No se tocan comisiones, pagos a asistentes, ventas históricas ni datos.
-- =========================================================

begin;

drop function if exists public.recompensas_proteccion_servicio(uuid, numeric);

create or replace function public.recompensas_proteccion_servicio(
  p_servicio_id uuid,
  p_precio numeric,
  p_registro_servicio_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_p public.servicios_proteccion;
  v_asis numeric;
  v_modo text;
  v_rs record;
  v_pct_max numeric;
  v_pct_vigente numeric;
begin
  select * into v_p from public.servicios_proteccion where servicio_id = p_servicio_id;
  if v_p.servicio_id is null then
    -- Sin configurar (distinto de cero explícito): respaldo del 50 %; protege lo que debe quedar cobrado.
    return jsonb_build_object('modo', 'RESPALDO_50', 'configurada', false,
      'total', p_precio - floor(p_precio * 50) / 100);
  end if;

  -- 1 y 2: la atención que se está vendiendo.
  if p_registro_servicio_id is not null then
    select rs.pago_asistente, rs.precio, rs.usuario_id, u.rol into v_rs
    from public.registro_servicios rs
    left join public.usuarios u on u.id = rs.usuario_id
    where rs.id = p_registro_servicio_id and rs.servicio_id = p_servicio_id;
    if found then
      if v_rs.rol = 'ADMINISTRADOR' then
        v_asis := 0;
        v_modo := 'DUENA';
      else
        -- El disparador de comisión (calcular_comision_registro_servicio) vuelve a calcular el pago con el % VIGENTE al
        -- marcar la atención como vendida; el piso usa ese mismo importe para coincidir con lo que realmente se paga.
        select p.porcentaje into v_pct_vigente
        from public.porcentajes p
        join public.asistentes a on a.id = p.asistente_id
        where a.usuario_id = v_rs.usuario_id and p.servicio_id = p_servicio_id;
        if v_pct_vigente is not null then
          v_asis := round(v_rs.precio * v_pct_vigente / 100, 2);
          v_modo := 'COMISION_REAL';
        elsif v_rs.pago_asistente is not null then
          v_asis := v_rs.pago_asistente;
          v_modo := 'COMISION_REAL';
        end if;
      end if;
    end if;
  end if;

  -- 3: sin atención conocida, el % más alto entre las asistentes activas con porcentaje para este servicio.
  if v_asis is null then
    select max(p.porcentaje) into v_pct_max
    from public.porcentajes p
    join public.asistentes a on a.id = p.asistente_id and a.activo
    left join public.usuarios u on u.id = a.usuario_id
    where p.servicio_id = p_servicio_id
      and p.porcentaje is not null
      and coalesce(u.rol, '') <> 'ADMINISTRADOR';
    if v_pct_max is not null then
      v_asis := ceil(p_precio * v_pct_max) / 100;   -- precio x % / 100, hacia arriba al centavo
      v_modo := 'COMISION_MAX';
    end if;
  end if;

  -- 4 y 5: la protección antigua (estimación) solo como último recurso.
  if v_asis is null then
    if v_p.asistente_pct is not null then
      v_modo := 'PORCENTAJE';
      v_asis := ceil(p_precio * v_p.asistente_pct) / 100;
    else
      v_modo := 'IMPORTE_FIJO';
      v_asis := v_p.asistente;
    end if;
  end if;

  return jsonb_build_object('modo', v_modo, 'configurada', true,
    'materiales', v_p.materiales, 'asistente_pct', v_p.asistente_pct, 'asistente', v_asis,
    'otros', v_p.otros, 'precio', p_precio, 'total', v_p.materiales + v_asis + v_p.otros,
    'registro_servicio_id', p_registro_servicio_id);
end;
$$;
revoke execute on function public.recompensas_proteccion_servicio(uuid, numeric, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------
-- recompensas_evaluar_cupon (definición vigente + atención por línea)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompensas_evaluar_cupon(p_cupon_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_reg_premio uuid;
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
        v_reg_premio := nullif(v_linea->>'registro_servicio_id', '')::uuid;
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
        - (public.recompensas_proteccion_servicio(v_cupon.servicio_id, v_elig_total, v_reg_premio)->>'total')::numeric, 0);
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
        (v_linea->>'servicio_id')::uuid, (v_linea->>'subtotal')::numeric,
        nullif(v_linea->>'registro_servicio_id', '')::uuid);
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
$function$;

-- ---------------------------------------------------------
-- confirmar_venta (definición vigente + atención por línea en la protección)
-- ---------------------------------------------------------
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

  -- El adelanto de una cita NO es un descuento: es dinero que la clienta ya entregó al agendar (y que entró a caja). La venta vale
  -- lo mismo con o sin adelanto (ventas.total = subtotal - descuento real); el adelanto va aparte (p_adelanto_monto), se guarda en
  -- ventas.adelanto_monto y solo reduce lo que se COBRA HOY (total - adelanto). p_descuento_monto / p_descuento_pct / cupón son
  -- SOLO descuentos reales y conviven con él. Se valida más abajo contra lo pendiente en las citas del ticket.
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
      -- Comisión REAL de la atención (la que ya quedó guardada): el pago a la asistente no baja por un descuento del salón.
      v_prot_json := public.recompensas_proteccion_servicio(
        (v_linea->>'servicio_id')::uuid, (v_linea->>'subtotal')::numeric,
        nullif(v_linea->>'registro_servicio_id', '')::uuid);
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

  v_total := round(v_total - v_desc_total, 2);

  -- Delivery se suma DESPUÉS del cupón/descuento — nunca se descuenta.
  v_total := v_total + p_costo_delivery;

  if p_metodo_pago = 'Efectivo' then
    -- Lo que se cobra hoy: el total de la venta (con envío) menos el adelanto que la clienta ya entregó.
    if p_monto_recibido is null or p_monto_recibido < v_total - p_adelanto_monto then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total - p_adelanto_monto;
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

commit;
