-- =========================================================
-- Migración 8/10 del rediseño de Servicios/Detalle: "Se suele reservar
-- junto con" (combo sugerido).
-- Ejecutar en Supabase → SQL Editor → New query
--
-- El README dejaba a elegir entre un campo manual (servicios.combo_con)
-- o calcularlo con las citas — se hacen los DOS: `combo_con` es un
-- override manual del admin (ModalServicio.jsx) para cuando quiere
-- forzar una combinación concreta (ej. recién lanzada, sin historial
-- todavía); si no lo puso, `servicios_combo_sugerido()` calcula el
-- servicio que más veces se reservó JUNTO a este en la misma cita
-- (mismo patrón security definer que servicios_mas_pedidos(), migración
-- 109 — necesita ver TODAS las citas, no solo las propias).
-- =========================================================

begin;

alter table public.servicios
  add column if not exists combo_con uuid references public.servicios(id) on delete set null;

create or replace function public.servicios_combo_sugerido(p_servicio_id uuid)
returns table (
  servicio_id uuid,
  veces       bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cs2.servicio_id,
    count(*) as veces
  from public.cita_servicios cs1
  join public.cita_servicios cs2 on cs2.cita_id = cs1.cita_id and cs2.servicio_id <> cs1.servicio_id
  join public.citas c on c.id = cs1.cita_id
  where cs1.servicio_id = p_servicio_id
    and c.estado <> 'CANCELADA'
  group by cs2.servicio_id
  order by veces desc
  limit 1;
$$;

grant execute on function public.servicios_combo_sugerido(uuid) to authenticated;
revoke execute on function public.servicios_combo_sugerido(uuid) from public;

commit;
