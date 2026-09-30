-- =========================================================
-- POS Negocio 2 — Anular venta también deshace el cupón usado
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 95_cupones_referido.sql ya se haya corrido.
--
-- El usuario preguntó qué debía pasar si se anula una venta que usó un
-- cupón. Hueco real encontrado: anular_venta() ya reponía stock y
-- liberaba la atención, pero nunca tocaba el cupón — se quedaba
-- CANJEADO para siempre aunque la venta que lo "gastó" ya no existiera,
-- y si era un cupón de bienvenida que ya había generado el cupón de
-- recompensa de quien invitó, esa persona se quedaba con su recompensa
-- aunque la venta que la originó se deshiciera (hueco real: "vender y
-- anular" a propósito para farmear cupones).
--
-- Fix: al anular, el cupón usado vuelve a DISPONIBLE (como si nunca se
-- hubiera canjeado) y, si era de bienvenida y ya había generado el
-- cupón de recompensa de quien invitó y ESE todavía no se usó, se anula
-- también. Si el referidor ya lo gastó en otra venta real, eso no se
-- toca — no se puede deshacer una venta distinta ya completada.
-- =========================================================

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
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select estado, fecha into v_estado, v_fecha
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
    update public.cupones
    set estado = 'DISPONIBLE', canjeado_en = null, venta_id = null
    where id = v_cupon_id
    returning cliente_id, origen into v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      update public.cupones
      set estado = 'ANULADO'
      where origen = 'REFERIDO_RECOMPENSA'
        and referido_id = v_cupon_cliente_id
        and estado = 'DISPONIBLE';
    end if;
  end if;
end;
$function$;
