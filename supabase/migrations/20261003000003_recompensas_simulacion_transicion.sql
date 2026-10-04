-- =========================================================
-- Recompensas Fase 2 — simulación de la transición ×5 (SOLO LECTURA).
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Estas funciones NO escriben nada: son STABLE, no crean aperturas, marcas ni
-- aportes, y solo las puede llamar ADMINISTRADOR. Reproducen la fórmula
-- ANTERIOR (mis_puntos de 20261002000002 y mi_fidelizacion) con los datos
-- reales del esquema, para poder revisar la conversión antes de ejecutarla.
--
-- Fórmula antigua por clienta (config_puntos id=1):
--   visitas   = días de Lima distintos con atenciones ACTIVO
--   gastado   = suma de registro_servicios.precio de esas atenciones ACTIVO
--   puntos    = floor(visitas*puntos_por_visita + gastado*puntos_por_sol_gastado)
--               + clientes.puntos_bono
-- Los productos nunca sumaron puntos: la apertura NO regala monedas de productos.
-- Anular una venta nunca bajó los puntos (la atención sigue ACTIVO): no hay
-- reversión histórica por ese camino.
--
-- Atribución auditable (suma exacta de la fórmula antigua):
--   VISITA_DIA  = visitas * puntos_por_visita
--   ATENCION    = gastado * puntos_por_sol_gastado   (por registro_servicio)
--   BONO_MANUAL = puntos_bono
--   REDONDEO    = floor(...) - (VISITA_DIA + ATENCION)   (<= 0)
-- Apertura: monedas = puntos * 5; clasificación inicial = el mismo valor;
-- umbrales efectivos = umbrales de config_puntos * 5 (el nivel se conserva).
-- Sellos pendientes = visitas - 5 * recompensas reclamadas (se conserva íntegro,
-- también si supera 20). Solo clientas con cuenta web vinculada acumulan.
-- =========================================================

begin;

create or replace function public.recompensas_simular_transicion()
returns table (
  cliente_id          uuid,
  vinculada           boolean,
  visitas             int,
  gastado             numeric,
  puntos_bono         int,
  puntos_antiguos     int,
  nivel_antiguo       text,
  aporte_visitas      numeric,
  aporte_atenciones   numeric,
  aporte_bono         numeric,
  aporte_redondeo     numeric,
  monedas_apertura    numeric,
  clasificacion_inicial numeric,
  nivel_nuevo         text,
  reclamadas          int,
  sellos_pendientes   int,
  atenciones_activas  int,
  atenciones_sin_cobrar int,
  ventas_con_servicios  int,
  anomalias           text[]
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.config_puntos;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede simular la transición.';
  end if;
  select * into v_cfg from public.config_puntos where id = 1;

  return query
  with base as (
    select c.id as cid,
           (c.cliente_web_id is not null) as vinc,
           coalesce(c.puntos_bono, 0) as bono,
           coalesce(c.fidelizacion_recompensas_reclamadas, 0) as recl,
           count(distinct (rs.fecha at time zone 'America/Lima')::date) filter (where rs.estado = 'ACTIVO')::int as vis,
           coalesce(sum(rs.precio) filter (where rs.estado = 'ACTIVO'), 0) as gas,
           (count(*) filter (where rs.estado = 'ACTIVO'))::int as atn,
           (count(*) filter (where rs.estado = 'ACTIVO' and rs.venta_id is null))::int as atn_sc
    from public.clientes c
    left join public.registro_servicios rs on rs.cliente_id = c.id
    group by c.id
  ), calc as (
    select b.*,
           b.vis * v_cfg.puntos_por_visita as a_vis,
           b.gas * v_cfg.puntos_por_sol_gastado as a_atn,
           floor(b.vis * v_cfg.puntos_por_visita + b.gas * v_cfg.puntos_por_sol_gastado)::int as piso
    from base b
  )
  select k.cid, k.vinc, k.vis, k.gas, k.bono,
         (k.piso + k.bono)::int,
         case when k.piso + k.bono >= v_cfg.umbral_vip then 'VIP'
              when k.piso + k.bono >= v_cfg.umbral_premium then 'PREMIUM' else 'BASICO' end,
         k.a_vis, k.a_atn, k.bono::numeric,
         k.piso - (k.a_vis + k.a_atn),
         ((k.piso + k.bono) * 5)::numeric,
         ((k.piso + k.bono) * 5)::numeric,
         case when (k.piso + k.bono) * 5 >= v_cfg.umbral_vip * 5 then 'VIP'
              when (k.piso + k.bono) * 5 >= v_cfg.umbral_premium * 5 then 'PREMIUM' else 'BASICO' end,
         k.recl,
         (k.vis - 5 * k.recl)::int,
         k.atn, k.atn_sc,
         (select count(distinct v.id)::int from public.ventas v
            join public.venta_items i on i.venta_id = v.id and i.tipo = 'SERVICIO'
           where v.cliente_id = k.cid),
         array_remove(array[
           case when not k.vinc and (k.piso + k.bono) > 0 then 'SIN_CUENTA_WEB_CON_PUNTOS' end,
           case when k.vis - 5 * k.recl < 0 then 'RECLAMADAS_SUPERAN_VISITAS' end,
           case when k.vis - 5 * k.recl > 20 then 'SELLOS_HEREDADOS_MAYOR_20' end,
           case when k.atn_sc > 0 then 'ATENCIONES_PENDIENTES_DE_COBRO' end
         ], null)
  from calc k
  order by k.cid;
end;
$$;
revoke execute on function public.recompensas_simular_transicion() from public, anon;
grant execute on function public.recompensas_simular_transicion() to authenticated;

-- Resumen de reconciliación (un solo objeto) y avisos de lo no atribuible.
create or replace function public.recompensas_simular_transicion_resumen()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.config_puntos;
  v_rc public.recompensas_config;
  r jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede simular la transición.';
  end if;
  select * into v_cfg from public.config_puntos where id = 1;
  select * into v_rc from public.recompensas_config where id = 1;

  select jsonb_build_object(
    'solo_lectura', true,
    'clientas_total', count(*),
    'clientas_vinculadas', count(*) filter (where vinculada),
    'puntos_antiguos_vinculadas', coalesce(sum(puntos_antiguos) filter (where vinculada), 0),
    'monedas_apertura_vinculadas', coalesce(sum(monedas_apertura) filter (where vinculada), 0),
    'conciliacion_x5_ok', coalesce(sum(monedas_apertura) filter (where vinculada), 0)
                           = 5 * coalesce(sum(puntos_antiguos) filter (where vinculada), 0),
    'conciliacion_aportes_ok', bool_and(
        abs((aporte_visitas + aporte_atenciones + aporte_bono + aporte_redondeo) - puntos_antiguos) < 0.000001),
    'nivel_conservado_en_todas', bool_and(nivel_antiguo = nivel_nuevo),
    'por_nivel', jsonb_build_object(
        'BASICO', count(*) filter (where vinculada and nivel_nuevo = 'BASICO'),
        'PREMIUM', count(*) filter (where vinculada and nivel_nuevo = 'PREMIUM'),
        'VIP', count(*) filter (where vinculada and nivel_nuevo = 'VIP')),
    'umbrales', jsonb_build_object(
        'antiguos', jsonb_build_array(v_cfg.umbral_premium, v_cfg.umbral_vip),
        'efectivos_x5', jsonb_build_array(v_cfg.umbral_premium * 5, v_cfg.umbral_vip * 5),
        'recompensas_config_actual', jsonb_build_array(v_rc.umbral_premium, v_rc.umbral_vip),
        'coinciden', v_rc.umbral_premium = v_cfg.umbral_premium * 5 and v_rc.umbral_vip = v_cfg.umbral_vip * 5),
    'sellos_pendientes_total', coalesce(sum(sellos_pendientes) filter (where vinculada and sellos_pendientes > 0), 0),
    'sellos_heredados_mayor_20', count(*) filter (where vinculada and sellos_pendientes > 20),
    'atenciones_pendientes_de_cobro', coalesce(sum(atenciones_sin_cobrar) filter (where vinculada), 0),
    'clientas_con_atenciones_pendientes', count(*) filter (where vinculada and atenciones_sin_cobrar > 0),
    'ventas_historicas_con_servicios', coalesce(sum(ventas_con_servicios) filter (where vinculada), 0),
    'sin_cuenta_web_con_puntos', count(*) filter (where 'SIN_CUENTA_WEB_CON_PUNTOS' = any (anomalias)),
    'puntos_sin_cuenta_web', coalesce(sum(puntos_antiguos) filter (where not vinculada), 0),
    'reclamadas_superan_visitas', count(*) filter (where 'RECLAMADAS_SUPERAN_VISITAS' = any (anomalias)),
    'cupones_antiguos', (select coalesce(jsonb_object_agg(origen || '/' || estado, n), '{}'::jsonb)
                          from (select origen, estado, count(*) n from public.cupones
                                 where catalogo_id is null group by 1, 2) q),
    'ya_hay_apertura', exists (select 1 from public.recompensas_movimientos where tipo = 'APERTURA'),
    'exposicion_economica', 'PENDIENTE: el catálogo real aún no está definido; no se calcula ni se afirma cobertura'
  ) into r
  from public.recompensas_simular_transicion();

  return r;
end;
$$;
revoke execute on function public.recompensas_simular_transicion_resumen() from public, anon;
grant execute on function public.recompensas_simular_transicion_resumen() to authenticated;

commit;
