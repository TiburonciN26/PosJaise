-- =========================================================
-- POS Negocio 2 — Fase 4: anular venta (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Tanto ADMINISTRADOR como ASISTENTE pueden anular. La asistente
-- solo puede anular ventas de HOY (mismo límite que ya tiene para
-- verlas en el historial) — se valida aquí explícitamente porque
-- la función es SECURITY DEFINER y por lo tanto no pasa por RLS.
--
-- Nunca se borra la venta: solo cambia estado -> ANULADA y se
-- devuelve el stock de los productos vendidos. Todo en una sola
-- transacción (atómico).
-- =========================================================

begin;

create or replace function public.anular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_fecha timestamptz;
  v_rol text;
  v_item record;
begin
  v_rol := public.rol_actual();
  if v_rol is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  -- Bloquea la fila: si dos anulaciones de la misma venta llegan
  -- casi al mismo tiempo, la segunda espera y ve el estado ya
  -- actualizado, evitando devolver el stock dos veces.
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

  if v_rol = 'ASISTENTE' and not public.es_hoy(v_fecha) then
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
end;
$$;

grant execute on function public.anular_venta(uuid) to authenticated;

commit;
