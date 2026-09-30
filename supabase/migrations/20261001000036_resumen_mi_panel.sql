-- =========================================================
-- POS Negocio 2 — M2 de la 3ª auditoría: Mi Panel era la
-- única lista sin paginar. Traía todas las atenciones del
-- período; admin + "Todos" + rango largo crece sin techo.
--
-- La lista en sí se pagina con .range() en el cliente (es una
-- sola tabla con joins, no hace falta un RPC como en Auditoría).
-- Este RPC solo cubre el resumen del header (cantidad + total),
-- que con paginación ya no se puede sumar desde el array cargado
-- —reflejaría solo la página visible— igual que resumen_historial.
--
-- Devuelve los dos totales (precio y pago_asistente) porque la
-- pantalla muestra uno u otro según el rol: el admin ve el precio
-- del servicio, la asistente ve su comisión. Excluye CANCELADO.
--
-- security invoker: respeta la RLS de registro_servicios (la
-- asistente solo ve lo suyo; el admin ve todo), así que el filtro
-- por usuario cae solo para no-admin aunque no se pase el param.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

create or replace function public.resumen_mi_panel(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_usuario_id uuid default null
)
returns table (
  cantidad bigint,
  total_precio numeric,
  total_pago_asistente numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) as cantidad,
    coalesce(sum(precio), 0) as total_precio,
    coalesce(sum(coalesce(pago_asistente, 0)), 0) as total_pago_asistente
  from public.registro_servicios
  where fecha >= p_desde and fecha < p_hasta
    and estado <> 'CANCELADO'
    and (p_usuario_id is null or usuario_id = p_usuario_id)
$$;

grant execute on function public.resumen_mi_panel(timestamptz, timestamptz, uuid) to authenticated;
