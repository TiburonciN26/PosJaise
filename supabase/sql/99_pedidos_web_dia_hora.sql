-- =========================================================
-- POS Negocio 2 — Pedidos Web: día y hora de entrega/recojo
-- Ejecutar en Supabase → SQL Editor → New query
-- Fase 3 del rediseño del carrito (docs/diseno-carrito/README.md) —
-- migración 1 de 5.
--
-- Antes de esto un pedido web no tenía ningún compromiso de tiempo — el
-- negocio coordinaba día/hora por fuera, a mano. Ahora la clienta elige
-- día y hora en el carrito (calendario + horario real del negocio), y
-- el servidor los valida contra `estado_negocio` (la misma fuente de
-- horario_atencion(), 74_horario_atencion.sql) antes de aceptar el
-- pedido — nunca confía en lo que ya validó el navegador.
--
-- `pedidos_web` estaba vacía (0 filas) al escribir esto, así que las
-- columnas nuevas pueden ir `not null` directo, sin default ni backfill.
--
-- confirmar_pedido_productos() cambia de firma (2 parámetros nuevos
-- obligatorios) — hace falta `drop function` antes: un `create or
-- replace` con una lista de parámetros distinta no reemplaza la función
-- vieja en Postgres, crea una segunda función superpuesta (mismo criterio
-- ya usado en 97_cupones_fidelizacion.sql cuando cambió el tipo de
-- retorno de mis_cupones()).
-- =========================================================

begin;

alter table public.pedidos_web
  add column if not exists fecha_entrega date not null,
  add column if not exists hora_entrega time not null;

drop function if exists public.confirmar_pedido_productos(uuid[], text, uuid, text, text);

create or replace function public.confirmar_pedido_productos(
  p_producto_ids     uuid[],
  p_tipo_entrega     text,
  p_fecha_entrega    date,
  p_hora_entrega     time,
  p_zona_delivery_id uuid default null,
  p_direccion        text default null,
  p_celular_entrega  text default null
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
    fecha_entrega, hora_entrega, costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    case when p_tipo_entrega = 'DELIVERY' then p_celular_entrega end,
    p_fecha_entrega, p_hora_entrega,
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

grant execute on function public.confirmar_pedido_productos(uuid[], text, date, time, uuid, text, text) to authenticated;
revoke execute on function public.confirmar_pedido_productos(uuid[], text, date, time, uuid, text, text) from public;

commit;
