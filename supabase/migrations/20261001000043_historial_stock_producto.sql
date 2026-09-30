-- =========================================================
-- POS Negocio 2 — Fase 5: historial de stock de un producto (RPC)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Solo admin: el modal de detalle de producto muestra la foto a
-- cualquier rol, pero el historial de cargas de stock (quién,
-- cuándo, cuánto) es información de gestión, admin-only — mismo
-- criterio que el resto de RPCs de este archivo (rol_actual()).
-- SECURITY DEFINER para poder resolver el nombre del usuario que
-- cargó cada movimiento sin depender de RLS de "usuarios".
-- =========================================================

begin;

create or replace function public.historial_stock_producto(p_producto_id uuid)
returns table (
  fecha timestamptz,
  cantidad_agregada int,
  stock_anterior int,
  stock_nuevo int,
  nota text,
  usuario_nombre text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      m.fecha,
      m.cantidad_agregada,
      m.stock_anterior,
      m.stock_nuevo,
      m.nota,
      u.nombre_completo
    from public.movimientos_stock m
    left join public.usuarios u on u.id = m.usuario_id
    where m.producto_id = p_producto_id
    order by m.fecha desc;
end;
$$;

grant execute on function public.historial_stock_producto(uuid) to authenticated;

commit;
