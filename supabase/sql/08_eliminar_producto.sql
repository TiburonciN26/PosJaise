-- =========================================================
-- POS Negocio 2 — Fase 4: eliminar/desactivar producto (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Regla: si el producto YA tiene ventas asociadas en venta_items,
-- borrarlo de verdad dejaría esas líneas históricas con
-- producto_id = NULL (por el ON DELETE SET NULL de la FK) —
-- se pierde la trazabilidad real hacia el producto, aunque el
-- nombre siga viéndose en el ticket (venta_items.nombre es una
-- copia guardada al momento de la venta).
--
-- Por eso: sin ventas asociadas -> DELETE real.
--          con ventas asociadas -> UPDATE activo = false.
-- Todo en una sola función (atómico), para no tener condición
-- de carrera entre "revisar si tiene ventas" y "borrar".
-- =========================================================

begin;

create or replace function public.eliminar_producto(p_id uuid)
returns text  -- 'ELIMINADO' o 'DESACTIVADO'
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tiene_ventas boolean;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede eliminar productos';
  end if;

  select exists(
    select 1 from public.venta_items where producto_id = p_id
  ) into v_tiene_ventas;

  if v_tiene_ventas then
    update public.productos set activo = false where id = p_id;
    return 'DESACTIVADO';
  else
    delete from public.productos where id = p_id;
    return 'ELIMINADO';
  end if;
end;
$$;

grant execute on function public.eliminar_producto(uuid) to authenticated;

commit;
