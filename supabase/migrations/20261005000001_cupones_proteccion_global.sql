-- =========================================================
-- Protección económica de cupones: regla GLOBAL del carrito.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte. Recompensas permanece apagado.
--
-- Regla aprobada: un cupón se aplica solo si
--     subtotal (productos + servicios, SIN el envío cobrado a la clienta) - descuento del cupón >= protección total
-- donde la protección total es la suma de las protecciones de todas las partidas y cantidades. Si no se cumple, el
-- cupón se rechaza COMPLETO (no se recorta, no se consume, sin escrituras parciales). Sustituye el piso individual de
-- las partidas configuradas; el cupón sigue respetando su alcance, compra mínima, nivel, vigencia, tope y demás
-- condiciones. Los servicios SIN protección configurada conservan además su límite del 50 % por partida (el respaldo
-- vigente) y, para la suma global, protegen el importe que debe quedar cobrado según ese respaldo.
--
-- Servicios: el pago protegido a asistente pasa de importe fijo (S/) a un PORCENTAJE protegido (0-100) del precio
-- efectivo registrado en la atención (también si es variable). Es una ESTIMACIÓN del administrador: no consulta ni
-- promedia comisiones reales y no cambia Porcentajes, la comisión guardada en la atención ni los pagos a asistentes.
-- Transición compatible: la columna `asistente` (S/) se CONSERVA; mientras una fila no tenga `asistente_pct`, sigue
-- usando su importe fijo y la interfaz la marca como pendiente de actualización. Nada se convierte automáticamente
-- (S/20 no se vuelve 20 %). La protección se redondea HACIA ARRIBA al centavo (conservador).
--
-- Productos: tabla nueva productos_proteccion (solo ADMINISTRADOR) con transporte de abastecimiento y otros importes
-- protegidos. El costo de compra NO se copia: se lee de productos.costo. Como esa columna es NOT NULL DEFAULT 0, un
-- costo 0 no distingue «explícito cero» de «desconocido»: solo cuenta como conocido si es > 0 o si el administrador lo
-- confirmó (costo_confirmado). Costo desconocido => el cupón se bloquea (nunca se inventa un cero). La protección
-- limita cupones: las ventas sin cupón no se ven afectadas.
--
-- Trazabilidad: recompensas_venta_detalle.proteccion (por partida) y recompensas_venta_proteccion (por venta con
-- cupón: subtotal, descuento, protección total, descuento máximo). Las ventas históricas no se recalculan. La
-- protección estimada NO es un gasto real ni sustituye comisiones en Estadísticas/Dashboard.
--
-- Todo lo demás de confirmar_venta() es la definición vigente (20261004000001): misma firma, permisos QA-033, reparto
-- exacto de centavos, monedas sobre netos, sellos, referidos, cupones vencidos y códigos > 999.
-- =========================================================

begin;

-- 1. Servicios: porcentaje protegido de asistente (nulo = protección antigua en importe fijo, pendiente de actualizar).
alter table public.servicios_proteccion
  add column asistente_pct numeric(5, 2)
    check (asistente_pct is null or (asistente_pct >= 0 and asistente_pct <= 100));
comment on column public.servicios_proteccion.asistente_pct is
  'Porcentaje protegido de asistente (0-100) del precio efectivo; estimación del administrador. NULL = protección antigua: se usa asistente (S/) hasta que se actualice.';
comment on column public.servicios_proteccion.asistente is
  'Importe fijo antiguo (S/). Se conserva para el histórico y para filas aún no actualizadas a porcentaje.';

-- 2. Productos: transporte de abastecimiento y otros importes protegidos (solo ADMINISTRADOR).
create table public.productos_proteccion (
  producto_id      uuid primary key references public.productos (id) on delete cascade,
  transporte       numeric(10, 2) not null default 0 check (transporte >= 0),
  otros            numeric(10, 2) not null default 0 check (otros >= 0),
  costo_confirmado boolean not null default false,
  actualizado_en   timestamptz not null default now()
);
comment on column public.productos_proteccion.costo_confirmado is
  'El administrador confirma que el costo de compra registrado en productos.costo es correcto aunque sea 0.';
alter table public.productos_proteccion enable row level security;
revoke all on public.productos_proteccion from anon, authenticated;
grant select, insert, update, delete on public.productos_proteccion to authenticated;
create policy productos_proteccion_admin on public.productos_proteccion
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- 3. Protección usada por cada venta nueva con cupón (solo ADMINISTRADOR lee; solo la escribe confirmar_venta).
create table public.recompensas_venta_proteccion (
  venta_id         uuid primary key references public.ventas (id),
  subtotal         numeric(12, 2) not null,
  descuento        numeric(12, 2) not null,
  proteccion_total numeric(12, 2) not null,
  descuento_maximo numeric(12, 2) not null,
  creado_en        timestamptz not null default now()
);
alter table public.recompensas_venta_proteccion enable row level security;
revoke all on public.recompensas_venta_proteccion from anon, authenticated;
grant select on public.recompensas_venta_proteccion to authenticated;
create policy recompensas_venta_proteccion_admin on public.recompensas_venta_proteccion
  for select to authenticated using (public.es_admin());

-- 4. Cálculo de la protección (internas: no expuestas a la API; las llaman funciones security definer).
create or replace function public.recompensas_proteccion_servicio(p_servicio_id uuid, p_precio numeric)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_p public.servicios_proteccion;
  v_asis numeric;
  v_modo text;
begin
  select * into v_p from public.servicios_proteccion where servicio_id = p_servicio_id;
  if v_p.servicio_id is null then
    -- Sin configurar (distinto de cero explícito): respaldo del 50 %; protege lo que debe quedar cobrado.
    return jsonb_build_object('modo', 'RESPALDO_50', 'configurada', false,
      'total', p_precio - floor(p_precio * 50) / 100);
  end if;
  if v_p.asistente_pct is not null then
    v_modo := 'PORCENTAJE';
    v_asis := ceil(p_precio * v_p.asistente_pct) / 100;   -- precio x % / 100, hacia arriba al centavo
  else
    v_modo := 'IMPORTE_FIJO';   -- protección antigua pendiente de actualizar a porcentaje
    v_asis := v_p.asistente;
  end if;
  return jsonb_build_object('modo', v_modo, 'configurada', true,
    'materiales', v_p.materiales, 'asistente_pct', v_p.asistente_pct, 'asistente', v_asis,
    'otros', v_p.otros, 'precio', p_precio, 'total', v_p.materiales + v_asis + v_p.otros);
end;
$$;
revoke execute on function public.recompensas_proteccion_servicio(uuid, numeric) from public, anon, authenticated;

create or replace function public.recompensas_proteccion_producto(p_producto_id uuid, p_cantidad int)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_costo numeric;
  v_transporte numeric := 0;
  v_otros numeric := 0;
  v_conf boolean := false;
  v_conocido boolean;
  v_unit numeric;
begin
  select costo into v_costo from public.productos where id = p_producto_id;
  select transporte, otros, costo_confirmado into v_transporte, v_otros, v_conf
  from public.productos_proteccion where producto_id = p_producto_id;
  v_transporte := coalesce(v_transporte, 0);
  v_otros := coalesce(v_otros, 0);
  v_conf := coalesce(v_conf, false);
  v_conocido := v_costo is not null and (v_costo > 0 or v_conf);
  if not v_conocido then
    return jsonb_build_object('modo', 'COSTO', 'costo_conocido', false, 'cantidad', p_cantidad);
  end if;
  v_unit := v_costo + v_transporte + v_otros;
  return jsonb_build_object('modo', 'COSTO', 'costo_conocido', true, 'costo', v_costo,
    'transporte', v_transporte, 'otros', v_otros, 'unitaria', v_unit,
    'cantidad', p_cantidad, 'total', v_unit * p_cantidad);
end;
$$;
revoke execute on function public.recompensas_proteccion_producto(uuid, int) from public, anon, authenticated;

-- Caja consulta (no edita): mismo contrato; el piso referencial usa la protección efectiva con el precio de catálogo.
create or replace function public.proteccion_servicios_estado(p_servicio_ids uuid[])
returns table (servicio_id uuid, configurada boolean, piso numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id, (sp.servicio_id is not null),
         case when sp.servicio_id is null then null
              else (public.recompensas_proteccion_servicio(s.id, s.precio)->>'total')::numeric end
  from public.servicios s
  left join public.servicios_proteccion sp on sp.servicio_id = s.id
  where public.rol_actual() is not null
    and s.id = any (p_servicio_ids);
$$;
revoke execute on function public.proteccion_servicios_estado(uuid[]) from public, anon;
grant execute on function public.proteccion_servicios_estado(uuid[]) to authenticated;

-- 5. confirmar_venta con la regla global (resto idéntico a la definición vigente).
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
        v_desc_total := greatest(v_elig_total
          - (public.recompensas_proteccion_servicio(v_cupon.servicio_id, v_elig_total)->>'total')::numeric, 0);
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

  -- ---- Protección económica ---------------------------------------------
  -- Por partida se calcula SIEMPRE la protección (servicios: materiales + precio efectivo de la atención x % protegido
  -- de asistente + otros, o el importe antiguo mientras no se actualice, o el respaldo del 50 %; productos: costo de
  -- compra registrado + transporte de abastecimiento + otros, por unidad x cantidad). Se guarda en el detalle de la venta.
  --  * CUPÓN: regla global del carrito: subtotal (sin envío) - descuento >= suma de las protecciones. Sustituye el piso
  --    individual de las partidas configuradas; en servicios SIN configurar se conserva además el límite del 50 % por
  --    partida. Se rechaza completo (la excepción revierte la transacción: cupón, stock y libros intactos).
  --  * DESCUENTO MANUAL: conserva su comportamiento (piso por servicio configurado).
  for v_i in 0..v_n - 1 loop
    v_linea := v_items_resueltos -> v_i;
    if v_linea->>'tipo' = 'SERVICIO' then
      v_prot_json := public.recompensas_proteccion_servicio(
        (v_linea->>'servicio_id')::uuid, (v_linea->>'subtotal')::numeric);
      v_prot_total := v_prot_total + (v_prot_json->>'total')::numeric;

      if v_desc[v_i + 1] > 0 then
        if v_prot_json->>'modo' = 'RESPALDO_50' then
          -- Sin protección configurada: el cupón puede descontar hasta el 50 % del precio efectivo (truncado a
          -- centavos). El descuento manual conserva su comportamiento previo. Ausente != configurada en cero.
          if p_codigo_cupon is not null
             and v_desc[v_i + 1] > floor((v_linea->>'subtotal')::numeric * 50) / 100 then
            raise exception 'Este cupón supera el límite del servicio "%": en servicios sin protección configurada los cupones pueden descontar hasta el 50 %% del precio. Puedes utilizarlo en otra compra.', v_linea->>'nombre';
          end if;
        elsif p_codigo_cupon is null
              and (v_linea->>'subtotal')::numeric - v_desc[v_i + 1] < (v_prot_json->>'total')::numeric then
          raise exception 'El descuento deja el servicio "%" por debajo de su cobro mínimo.', v_linea->>'nombre';
        end if;
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
    v_prots := v_prots || jsonb_build_array(v_prot_json);
  end loop;

  v_subtotal_carrito := v_total;

  if p_codigo_cupon is not null then
    if v_desconocido is not null then
      raise exception 'Este cupón no se puede aplicar a esta compra: falta registrar el costo de compra de "%". Pide a un administrador que revise la protección del producto.', v_desconocido;
    end if;
    if v_subtotal_carrito - v_desc_total < v_prot_total then
      raise exception 'Este cupón supera el descuento permitido para esta compra. Puedes utilizarlo en otra compra.';
    end if;
  end if;

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

commit;
