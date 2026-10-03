-- =========================================================
-- QA-035 — Solo ADMINISTRADOR y CAJERA agregan stock; el historial solo lo escribe la RPC
--
-- Regla de negocio aprobada. Inventario es una pantalla de ADMIN/CAJERA, pero
-- agregar_stock() solo exigía `rol_actual() is not null`, así que una cuenta
-- ASISTENTE podía subir el stock real por la API. Además la política
-- movimientos_insert (usuario_id = auth.uid()) permitía a cualquier personal insertar
-- filas arbitrarias en movimientos_stock, falsificando el historial sin tocar el stock.
--
-- Cambios:
--  1. agregar_stock(): rechaza roles distintos de ADMINISTRADOR y CAJERA. Sin sesión
--     y CLIENTE (rol_actual() nulo) siguen con el mismo mensaje. Se conservan la
--     validación de cantidad, la regla de negocio cerrado (ADMIN exento), el bloqueo
--     de fila y el guardado atómico de stock + historial (misma firma; conserva grants).
--  2. movimientos_stock: se elimina la política movimientos_insert y se revocan
--     INSERT/UPDATE/DELETE a anon y authenticated. El movimiento solo nace dentro de
--     agregar_stock() (security definer, propietario postgres). SELECT no cambia.
--     No se tocan TRUNCATE/REFERENCES/TRIGGER (revisión aparte).
--  3. agregar_stock(): EXECUTE se revoca a PUBLIC/anon (antes heredado) y se mantiene
--     para authenticated. productos conserva sus políticas (solo ADMIN inserta/edita,
--     incluida la edición de stock_actual desde el modal de producto).
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

  if public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA') then
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
$$;

revoke execute on function public.agregar_stock(uuid, int, text) from public, anon;
grant execute on function public.agregar_stock(uuid, int, text) to authenticated;

drop policy if exists movimientos_insert on public.movimientos_stock;
revoke insert, update, delete on public.movimientos_stock from anon, authenticated;

commit;
