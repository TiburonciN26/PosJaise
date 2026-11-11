-- 4.º rol de personal: ENCARGADA (mezcla de CAJERA + ASISTENTE, sin ser administradora).
--
-- POR QUÉ: la dueña (ADMINISTRADOR) trabajará menos y entra personal que VENDE (como la cajera) y también ATIENDE
-- (como la asistente: Mi Panel, comisión por servicio, completar sus propias citas). Hasta ahora cada cuenta tenía
-- exactamente uno de tres roles y el personal era exclusivo de cada uno.
--
-- DECISIÓN: un 4.º valor de `usuarios.rol` (no «varios roles por usuario», que obligaría a reescribir toda la RLS).
-- La ENCARGADA tiene exactamente la UNIÓN de lo que puede la CAJERA y la ASISTENTE. Todo lo que hoy es solo del
-- administrador (Dashboard, Estadísticas, Auditoría, Clientes, Deudas, Porcentajes, Chanchito, Asistentes,
-- Mobiliario, Web, crear/editar productos y servicios, costos, gastos FIJOS, abrir/cerrar negocio) sigue igual.
--
-- QUÉ SE TOCA (solo listas de roles; el cuerpo de cada función es el VIVO, extraído con pg_get_functiondef):
--   * CHECK usuarios_rol_check.
--   * Ventas: ventas_insert, ventas_select, venta_items_select.
--   * Gastos (cuaderno de gastos VARIABLES compartido entre cajeras y encargadas): gastos_insert/select/update.
--   * Funciones: confirmar_venta, anular_venta, agregar_stock. La ENCARGADA hereda el límite de la cajera: anula solo ventas de HOY.
--
-- INDEPENDIENTE DE COMPROBANTES: esta versión parte de los cuerpos que hay HOY en producción (verificado por hash: salvo las listas de
-- roles son idénticos), sin nada de comprobantes electrónicos (aún sin auditar ni proveedor elegido). Cuando comprobantes se apruebe,
-- su migración deberá volver a definir confirmar_venta/solicitar_comprobante/reemitir_comprobante e incluir también ENCARGADA.
--
-- QUÉ NO SE TOCA (ya funciona para la ENCARGADA, verificado):
--   * asistentes_para_citas / agendar_cita_web / reprogramar_mi_cita_web: filtran `u.rol <> 'CAJERA'`, así que
--     una ficha vinculada a una ENCARGADA SÍ es profesional seleccionable (justo lo que se necesita).
--   * resumen_dashboard / resumen_estadisticas / resumen_asistentes_periodo: filtran `<> 'ADMINISTRADOR'`, así que
--     su comisión cuenta como la de cualquier asistente.
--   * completar_cita, resumen_mi_panel, registro_servicios y el trigger de comisión: se deciden por el VÍNCULO
--     asistentes.usuario_id -> porcentajes, no por el rol. Por eso la ENCARGADA necesita su ficha en la pestaña
--     Asistentes (vinculada a su cuenta) y sus % en Porcentajes ANTES de registrar atenciones; sin ficha o sin %
--     el trigger lanza «Sin % asignado…» y solo puede anotarlas como PENDIENTES (el 100 % es solo del ADMINISTRADOR).
--   * Políticas «cualquier personal» (rol_actual() is not null): citas, catálogo, cupones, etc.
--
-- NOTA: no se crean helpers nuevos (puede_vender(), etc.): las listas literales son pocas, quedan a la vista y
-- evitan GRANT/REVOKE nuevos. CREATE OR REPLACE conserva los grants vigentes de las funciones.
-- Las cuentas de personal siguen creándose a mano (auth.users + fila en usuarios con rol 'ENCARGADA').

begin;

alter table public.usuarios drop constraint usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
  check (rol in ('ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA'));

-- ---------------------------------------------------------------------------------------------------------
-- Políticas RLS
-- ---------------------------------------------------------------------------------------------------------

drop policy ventas_insert on public.ventas;
create policy ventas_insert on public.ventas for insert to authenticated
  with check (
    public.rol_actual() in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA')
    and vendedor_id = auth.uid()
  );

drop policy ventas_select on public.ventas;
create policy ventas_select on public.ventas for select to authenticated
  using (
    es_admin()
    or (rol_actual() in ('CAJERA', 'ENCARGADA') and es_hoy(fecha))
  );

drop policy venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items for select to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (es_admin() or (rol_actual() in ('CAJERA', 'ENCARGADA') and es_hoy(v.fecha)))
    )
  );

drop policy gastos_insert on public.gastos;
create policy gastos_insert on public.gastos for insert to authenticated
  with check (
    es_admin()
    or (
      rol_actual() in ('CAJERA', 'ENCARGADA')
      and tipo = 'VARIABLE'
      and creado_por = auth.uid()
    )
  );

drop policy gastos_select on public.gastos;
create policy gastos_select on public.gastos for select to authenticated
  using (
    es_admin()
    or (
      rol_actual() in ('CAJERA', 'ENCARGADA')
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol in ('CAJERA', 'ENCARGADA')
      )
    )
  );

drop policy gastos_update on public.gastos;
create policy gastos_update on public.gastos for update to authenticated
  using (
    es_admin()
    or (
      rol_actual() in ('CAJERA', 'ENCARGADA')
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol in ('CAJERA', 'ENCARGADA')
      )
    )
  )
  with check (
    es_admin()
    or (
      rol_actual() in ('CAJERA', 'ENCARGADA')
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol in ('CAJERA', 'ENCARGADA')
      )
    )
  );

-- ---------------------------------------------------------------------------------------------------------
-- Funciones (cuerpo vivo con la lista de roles ampliada)
-- ---------------------------------------------------------------------------------------------------------

-- agregar_stock
CREATE OR REPLACE FUNCTION public.agregar_stock(p_producto_id uuid, p_cantidad integer, p_nota text)
 RETURNS TABLE(stock_anterior integer, stock_nuevo integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stock_anterior int;
  v_stock_nuevo int;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'Solo el administrador o la cajera pueden agregar stock';
  end if;

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a agregar debe ser mayor a 0';
  end if;

  select stock_actual into v_stock_anterior
  from public.productos
  where id = p_producto_id
  for update;

  if v_stock_anterior is null then
    raise exception 'El producto no existe';
  end if;

  v_stock_nuevo := v_stock_anterior + p_cantidad;

  update public.productos
  set stock_actual = v_stock_nuevo
  where id = p_producto_id;

  insert into public.movimientos_stock
    (producto_id, cantidad_agregada, stock_anterior, stock_nuevo, nota, usuario_id)
  values
    (p_producto_id, p_cantidad, v_stock_anterior, v_stock_nuevo, nullif(trim(p_nota), ''), auth.uid());

  return query select v_stock_anterior, v_stock_nuevo;
end;
$function$;

-- anular_venta
CREATE OR REPLACE FUNCTION public.anular_venta(p_venta_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- QA-033 (regla aprobada): solo ADMINISTRADOR, CAJERA y ENCARGADA anulan ventas.
  if v_rol not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
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

  if v_rol in ('CAJERA', 'ENCARGADA') and not public.es_hoy(v_fecha) then
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

-- confirmar_venta
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

commit;
