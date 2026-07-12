-- =========================================================
-- POS Negocio 2 — M2 de la 4ª auditoría: "Rendimiento por
-- asistente" en Estadísticas había quedado como la última
-- consulta sin agregación server-side (todo lo demás de esa
-- pantalla ya pasa por resumen_estadisticas desde la 2ª/3ª
-- auditoría). Traía TODOS los registro_servicios del período
-- para agrupar por asistente en el navegador — mismo problema ya
-- resuelto en las otras 4 pantallas.
--
-- Excluye CANCELADO y a quien no tenga ficha de asistente (ej. el
-- admin registrando lo suyo bajo su propio usuario) — mismo
-- criterio que el agrupado en el cliente que reemplaza.
-- security invoker: respeta la RLS de registro_servicios.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

create or replace function public.resumen_asistentes_periodo(p_desde timestamptz, p_hasta timestamptz)
returns table (
  usuario_id uuid,
  nombre text,
  servicios bigint,
  monto numeric,
  comision numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.usuario_id,
    u.nombre_completo as nombre,
    count(*) as servicios,
    coalesce(sum(r.precio), 0) as monto,
    coalesce(sum(r.pago_asistente), 0) as comision
  from public.registro_servicios r
  join public.usuarios u on u.id = r.usuario_id
  where r.fecha >= p_desde and r.fecha < p_hasta
    and r.estado <> 'CANCELADO'
    and u.rol = 'ASISTENTE'
  group by r.usuario_id, u.nombre_completo
$$;

grant execute on function public.resumen_asistentes_periodo(timestamptz, timestamptz) to authenticated;
