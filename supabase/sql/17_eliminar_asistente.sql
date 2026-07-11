-- =========================================================
-- POS Negocio 2 — Fase 5: eliminar/desactivar asistente (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Misma lógica que eliminar_producto/eliminar_servicio: si la
-- asistente ya tiene servicios registrados en venta_items, no
-- se borra (dejaría esas líneas históricas con asistente_id =
-- NULL) — se desactiva en su lugar. Si nunca atendió nada, se
-- borra de verdad.
-- =========================================================

begin;

create or replace function public.eliminar_asistente(p_id uuid)
returns text  -- 'ELIMINADO' o 'DESACTIVADO'
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tiene_ventas boolean;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede eliminar asistentes';
  end if;

  select exists(
    select 1 from public.venta_items where asistente_id = p_id
  ) into v_tiene_ventas;

  if v_tiene_ventas then
    update public.asistentes set activo = false where id = p_id;
    return 'DESACTIVADO';
  else
    delete from public.asistentes where id = p_id;
    return 'ELIMINADO';
  end if;
end;
$$;

grant execute on function public.eliminar_asistente(uuid) to authenticated;

commit;
