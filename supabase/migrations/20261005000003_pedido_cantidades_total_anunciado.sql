-- =========================================================
-- QA-057 — la cantidad y el importe del pedido deben ser los ANUNCIADOS a la clienta.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte. Recompensas permanece apagado.
--
-- Hallazgo (Codex, por interfaz y con sesión real): con la vista previa retenida y el PATCH de la cantidad sin llegar al
-- servidor, la interfaz anunciaba S/90 (2 unidades) y habilitaba «Confirmar pedido», pero el servidor leía 1 unidad y creaba
-- el pedido por S/40.
--
-- Cambio en el servidor (la interfaz se corrige aparte):
--   * confirmar_pedido_productos() recibe, además, lo que la clienta confirmó: p_cantidades (producto, cantidad) y
--     p_total_esperado. Si lo guardado no coincide en productos y cantidades, o si el total calculado por el servidor
--     (precios, descuento y protección autoritativos) no es el anunciado, RECHAZA: sin pedido ni escrituras parciales y
--     pidiendo actualizar. Nunca corrige el importe en silencio. Los dos parámetros son opcionales (nulos = sin
--     comprobación) para no romper a otros llamadores; la interfaz SIEMPRE los envía.
--   * vista_previa_cupon_pedido() acepta p_cantidades y devuelve cantidades_coinciden: una vista previa calculada sobre un
--     carrito distinto del que ve la clienta no se puede tomar como válida. Sigue siendo de SOLO LECTURA y sin datos internos.
-- Se reemplazan las firmas (DROP + CREATE) para que PostgREST no vea dos sobrecargas ambiguas.
-- =========================================================

begin;

drop function if exists public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text);
drop function if exists public.vista_previa_cupon_pedido(text, uuid[]);

CREATE OR REPLACE FUNCTION public.confirmar_pedido_productos(p_producto_ids uuid[], p_tipo_entrega text, p_fecha_entrega date, p_hora_entrega time without time zone, p_metodo_pago text, p_comprobante_url text, p_zona_delivery_id uuid DEFAULT NULL::uuid, p_direccion text DEFAULT NULL::text, p_celular_entrega text DEFAULT NULL::text, p_codigo_cupon text DEFAULT NULL::text, p_tipo_comprobante text DEFAULT 'BOLETA'::text, p_ruc text DEFAULT NULL::text, p_razon_social text DEFAULT NULL::text, p_cantidades jsonb DEFAULT NULL::jsonb, p_total_esperado numeric DEFAULT NULL::numeric)
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
  v_total               numeric(10, 2);
  v_distintas           int;
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

  -- QA-057: lo guardado debe ser EXACTAMENTE lo que la clienta vio y confirmó (mismos productos y cantidades). Si una
  -- mutación del carrito no llegó al servidor, se rechaza: la excepción revierte el pedido recién insertado.
  if p_cantidades is not null then
    select count(*) into v_distintas
    from (select producto_id, cantidad from public.pedidos_web_items where pedido_id = v_pedido_id) g
    full join (select x.producto_id, x.cantidad from jsonb_to_recordset(p_cantidades) as x(producto_id uuid, cantidad int)) c
      on c.producto_id = g.producto_id
    where g.producto_id is null or c.producto_id is null or g.cantidad is distinct from c.cantidad;
    if v_distintas > 0 then
      raise exception 'Tu carrito cambió mientras confirmabas: las cantidades guardadas no coinciden con las que viste. Actualiza el carrito y vuelve a confirmar. No se creó ningún pedido.'
        using hint = 'CARRITO_DESFASADO';
    end if;
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

  -- QA-057: el total que se cobra debe ser el anunciado. Precios, descuento y protección siguen siendo los del servidor
  -- (no se confía en precios del navegador): si no coinciden, se rechaza sin pedido y se pide actualizar.
  v_total := round(v_subtotal - v_descuento_cupon, 2) + v_costo_delivery;
  if p_total_esperado is not null and v_total <> round(p_total_esperado, 2) then
    raise exception 'El total cambió: ahora es S/ % y no S/ %. Actualiza el carrito y vuelve a confirmar. No se creó ningún pedido.', v_total, round(p_total_esperado, 2)
      using hint = 'TOTAL_DISTINTO';
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

revoke execute on function public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric) from public;
grant execute on function public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric) to anon, authenticated, service_role;

-- Vista previa: SOLO LECTURA (stable; no consume el cupón, no reserva stock, no crea pedidos, no acredita).
create or replace function public.vista_previa_cupon_pedido(p_codigo text, p_producto_ids uuid[], p_cantidades jsonb default null)
returns table (valido boolean, motivo text, subtotal numeric, descuento numeric, cantidades_coinciden boolean)
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
  v_coinciden boolean := true;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    return query select false, 'Completa tu perfil antes de aplicar un cupón.'::text, 0::numeric, 0::numeric, true;
    return;
  end if;
  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    return query select false, 'Selecciona al menos un producto.'::text, 0::numeric, 0::numeric, true;
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
    return query select false, 'No se encontraron productos válidos en tu carrito.'::text, 0::numeric, 0::numeric, true;
    return;
  end if;

  if p_cantidades is not null then
    select not exists (
      select 1
      from (select (i->>'producto_id')::uuid as producto_id, (i->>'cantidad')::int as cantidad from jsonb_array_elements(v_items) i) g
      full join (select x.producto_id, x.cantidad from jsonb_to_recordset(p_cantidades) as x(producto_id uuid, cantidad int)) c
        on c.producto_id = g.producto_id
      where g.producto_id is null or c.producto_id is null or g.cantidad is distinct from c.cantidad)
      into v_coinciden;
    if not v_coinciden then
      return query select false, 'Tu carrito todavía se está actualizando. Vuelve a intentarlo en un momento.'::text, v_subtotal, 0::numeric, false;
      return;
    end if;
  end if;

  begin
    v_eval := public.recompensas_validar_cupon_pedido(v_cliente_id, p_codigo, v_items);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return query select false, public.recompensas_motivo_cliente(v_msg, v_hint), v_subtotal, 0::numeric, true;
    return;
  end;
  return query select true, null::text, v_subtotal, (v_eval->>'descuento')::numeric, true;
end;
$$;
revoke execute on function public.vista_previa_cupon_pedido(text, uuid[], jsonb) from public, anon;
grant execute on function public.vista_previa_cupon_pedido(text, uuid[], jsonb) to authenticated;

commit;
