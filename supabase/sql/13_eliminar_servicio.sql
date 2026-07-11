-- =========================================================
-- POS Negocio 2 — Fase 5: eliminar/desactivar servicio (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Misma lógica que eliminar_producto: si el servicio ya tiene
-- ventas asociadas en venta_items, no se borra (dejaría esas
-- líneas históricas con servicio_id = NULL) — se desactiva en
-- su lugar. Si nunca se vendió, se borra de verdad.
-- =========================================================

begin;

create or replace function public.eliminar_servicio(p_id uuid)
returns text  -- 'ELIMINADO' o 'DESACTIVADO'
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tiene_ventas boolean;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede eliminar servicios';
  end if;

  select exists(
    select 1 from public.venta_items where servicio_id = p_id
  ) into v_tiene_ventas;

  if v_tiene_ventas then
    update public.servicios set activo = false where id = p_id;
    return 'DESACTIVADO';
  else
    delete from public.servicios where id = p_id;
    return 'ELIMINADO';
  end if;
end;
$$;

grant execute on function public.eliminar_servicio(uuid) to authenticated;

commit;
