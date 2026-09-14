-- =========================================================
-- POS Negocio 2 — Pestaña Web: Fidelización (solo ver progreso)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 77_historial_web.sql ya se haya corrido.
--
-- Alcance de esta fase (decisión explícita): SOLO ver progreso. El
-- canje real en caja (que el cajero lo vea y lo aplique en Ventas)
-- queda para una fase aparte — no se toca Ventas.jsx ni se agrega
-- ninguna función de "canjear" todavía.
--
-- Por eso NO se crea ninguna tabla de movimientos (fidelizacion_
-- movimientos, planeada en implementacionesWed.md §2.5): esa bitácora
-- solo hace falta para registrar canjes, que no existen todavía en
-- este alcance — crearla ahora sería una tabla sin escritor real,
-- diseño prematuro. El progreso se calcula al vuelo a partir de
-- registro_servicios, que ya ES el registro fuente de verdad de cada
-- visita completada.
--
-- Regla del programa (dada por el negocio): 1 sello por VISITA
-- completada (no por servicio — una visita con 2 servicios sigue
-- siendo 1 sello). 5 sellos = 20% de descuento. "Visita" se identifica
-- por (cliente_id, fecha) distintos en registro_servicios: tanto
-- completar_cita() como el registro manual de Mi Panel insertan todas
-- las líneas de una misma visita con el mismo valor de fecha (no
-- now() por línea) — confirmado con datos reales del proyecto.
-- =========================================================

begin;

create or replace function public.mi_fidelizacion()
returns table (
  visitas_totales         int,
  visitas_por_recompensa  int,
  sellos_actuales         int,
  recompensas_disponibles int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(distinct fecha)::int as visitas_totales,
    5 as visitas_por_recompensa,
    (count(distinct fecha) % 5)::int as sellos_actuales,
    (count(distinct fecha) / 5)::int as recompensas_disponibles
  from public.registro_servicios
  where cliente_id = public.mi_cliente_id()
    and estado = 'ACTIVO';
$$;

grant execute on function public.mi_fidelizacion() to authenticated;
revoke execute on function public.mi_fidelizacion() from public;

commit;
