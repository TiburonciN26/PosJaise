-- =========================================================
-- POS Negocio 2 — Fase 4: agregar stock (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Tanto ADMINISTRADOR como ASISTENTE pueden agregar stock, pero
-- la política RLS de UPDATE en productos es admin-only. Esta
-- función (SECURITY DEFINER) es la puerta controlada: bloquea
-- la fila (FOR UPDATE) para que dos cargas simultáneas del mismo
-- producto no se pisen, actualiza el stock, y deja registro en
-- movimientos_stock. Todo en una sola transacción.
-- =========================================================

begin;

create or replace function public.agregar_stock(
  p_producto_id uuid,
  p_cantidad int,
  p_nota text
)
returns table (stock_anterior int, stock_nuevo int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock_anterior int;
  v_stock_nuevo int;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
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
$$;

grant execute on function public.agregar_stock(uuid, int, text) to authenticated;

commit;
