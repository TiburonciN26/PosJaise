-- =========================================================
-- Recompensas Fase 2 — lectores del portal de la clienta.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
--  1. mis_puntos() y mi_fidelizacion() conservan firma y se vuelven coherentes con
--     el libro nuevo cuando recompensas_config.activo = true. Con el programa
--     apagado devuelven EXACTAMENTE lo de antes (fórmula antigua).
--       * activo: puntos = monedas disponibles (floor, puede ser negativo);
--         nivel/umbrales/puntos_para_siguiente salen de la CLASIFICACIÓN
--         (no del saldo gastable); visitas/gastado siguen siendo el histórico.
--       * activo: sellos_actuales = sellos pendientes dentro de la tarjeta de 5
--         (módulo positivo, también con sellos negativos) y
--         recompensas_disponibles = floor(sellos / 5), nunca negativo.
--     Así las pantallas antiguas (Inicio, Citas, Carrito de servicios) y las
--     nuevas muestran el mismo saldo.
--  2. mis_cupones() añade las condiciones congeladas del cupón y su vigencia
--     (columnas nuevas al final; los lectores existentes no se rompen).
--  3. catalogo_recompensas_publico(): lectura pública de exposición mínima del
--     catálogo PUBLICADO (QA-037). No devuelve nada personal ni la protección
--     de costos; solo indica si el premio de servicio se rige por «piso» o por
--     el límite de la mitad. Vacío mientras el programa esté apagado.
-- =========================================================

begin;

create or replace function public.mis_puntos()
returns table (
  puntos                 int,
  visitas                int,
  gastado                numeric,
  nivel                  text,
  umbral_premium         int,
  umbral_vip             int,
  puntos_para_siguiente  int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cid uuid := public.mi_cliente_id();
  v_cfg public.recompensas_config;
  s record;
begin
  select * into v_cfg from public.recompensas_config where id = 1;

  if v_cfg.activo and v_cid is not null then
    select * into s from public.recompensas_saldos(v_cid);
    return query
    select
      floor(s.monedas)::int,
      (select count(distinct (rs.fecha at time zone 'America/Lima')::date)::int
         from public.registro_servicios rs where rs.cliente_id = v_cid and rs.estado = 'ACTIVO'),
      (select coalesce(sum(rs.precio), 0)
         from public.registro_servicios rs where rs.cliente_id = v_cid and rs.estado = 'ACTIVO'),
      s.nivel,
      round(v_cfg.umbral_premium)::int,
      round(v_cfg.umbral_vip)::int,
      case s.nivel
        when 'VIP' then 0
        when 'PREMIUM' then greatest(ceil(v_cfg.umbral_vip - s.clasificacion), 0)::int
        else greatest(ceil(v_cfg.umbral_premium - s.clasificacion), 0)::int
      end;
    return;
  end if;

  -- Programa apagado: fórmula anterior sin cambios (20261002000002).
  return query
  with base as (
    select
      count(distinct (fecha at time zone 'America/Lima')::date)::int as visitas,
      coalesce(sum(precio), 0) as gastado
    from public.registro_servicios
    where cliente_id = public.mi_cliente_id()
      and estado = 'ACTIVO'
  ),
  bono as (
    select coalesce(puntos_bono, 0) as valor
    from public.clientes
    where id = public.mi_cliente_id()
  ),
  cfg as (
    select * from public.config_puntos where id = 1
  ),
  calc as (
    select
      floor(base.visitas * cfg.puntos_por_visita + base.gastado * cfg.puntos_por_sol_gastado)::int
        + coalesce(bono.valor, 0) as puntos,
      base.visitas,
      base.gastado,
      cfg.umbral_premium,
      cfg.umbral_vip
    from base, cfg, bono
  )
  select
    calc.puntos,
    calc.visitas,
    calc.gastado,
    case
      when calc.puntos >= calc.umbral_vip then 'VIP'
      when calc.puntos >= calc.umbral_premium then 'PREMIUM'
      else 'BASICO'
    end as nivel,
    calc.umbral_premium,
    calc.umbral_vip,
    case
      when calc.puntos >= calc.umbral_vip then 0
      when calc.puntos >= calc.umbral_premium then calc.umbral_vip - calc.puntos
      else calc.umbral_premium - calc.puntos
    end as puntos_para_siguiente
  from calc;
end;
$$;
revoke execute on function public.mis_puntos() from public, anon;
grant execute on function public.mis_puntos() to authenticated;

create or replace function public.mi_fidelizacion()
returns table (
  visitas_totales         int,
  visitas_por_recompensa  int,
  sellos_actuales         int,
  recompensas_disponibles int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cid uuid := public.mi_cliente_id();
  v_cfg public.recompensas_config;
  s record;
begin
  select * into v_cfg from public.recompensas_config where id = 1;

  if v_cfg.activo and v_cid is not null then
    select * into s from public.recompensas_saldos(v_cid);
    return query
    select
      (select count(distinct (rs.fecha at time zone 'America/Lima')::date)::int
         from public.registro_servicios rs where rs.cliente_id = v_cid and rs.estado = 'ACTIVO'),
      v_cfg.sellos_por_premio,
      (((s.sellos % v_cfg.sellos_por_premio) + v_cfg.sellos_por_premio) % v_cfg.sellos_por_premio)::int,
      greatest(floor(s.sellos::numeric / v_cfg.sellos_por_premio), 0)::int;
    return;
  end if;

  -- Programa apagado: lectura anterior sin cambios (20261002000002).
  return query
  with visitas as (
    select count(distinct (rs.fecha at time zone 'America/Lima')::date)::int as total
    from public.registro_servicios rs
    where rs.cliente_id = public.mi_cliente_id()
      and rs.estado = 'ACTIVO'
  )
  select
    visitas.total as visitas_totales,
    5 as visitas_por_recompensa,
    (visitas.total % 5)::int as sellos_actuales,
    greatest(
      (visitas.total / 5) - coalesce(
        (select c.fidelizacion_recompensas_reclamadas from public.clientes c where c.id = public.mi_cliente_id()),
        0
      ),
      0
    )::int as recompensas_disponibles
  from visitas;
end;
$$;
revoke execute on function public.mi_fidelizacion() from public, anon;
grant execute on function public.mi_fidelizacion() to authenticated;

-- ---------------------------------------------------------
-- mis_cupones(): condiciones congeladas y vigencia (columnas al final).
-- ---------------------------------------------------------
drop function if exists public.mis_cupones();
create function public.mis_cupones()
returns table (
  id uuid, codigo text, origen text, valor numeric, tipo_descuento text, promocion_id uuid,
  estado text, creado_en timestamptz, canjeado_en timestamptz,
  vigente_hasta timestamptz, vencido boolean, nombre_premio text, alcance text,
  minimo_compra numeric, tope numeric, nivel_minimo text, servicio_nombre text,
  costo_aplicado numeric, nivel_aplicado text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.codigo, c.origen, c.valor, c.tipo_descuento, c.promocion_id, c.estado,
         c.creado_en, c.canjeado_en,
         c.vigente_hasta,
         (c.estado = 'DISPONIBLE' and c.vigente_hasta is not null and c.vigente_hasta <= now()),
         c.nombre_premio, c.alcance, c.minimo_compra, c.tope, c.nivel_minimo, sv.nombre,
         c.costo_aplicado, c.nivel_aplicado
  from public.cupones c
  left join public.servicios sv on sv.id = c.servicio_id
  where c.cliente_id = public.mi_cliente_id()
  order by (c.estado = 'DISPONIBLE') desc, c.creado_en desc;
$$;
revoke execute on function public.mis_cupones() from public, anon;
grant execute on function public.mis_cupones() to authenticated;

-- ---------------------------------------------------------
-- Catálogo público (sin datos personales ni costos internos).
-- ---------------------------------------------------------
create or replace function public.catalogo_recompensas_publico()
returns table (
  id uuid, nombre text, descripcion text, origen text, tipo text, valor numeric,
  servicio_nombre text, alcance text, minimo_compra numeric, tope numeric, nivel_minimo text,
  costo_basico numeric, costo_premium numeric, costo_vip numeric, sellos_por_premio int,
  reclamo_desde timestamptz, reclamo_hasta timestamptz,
  cupon_vigencia_dias int, cupon_vence_el timestamptz, regla_servicio text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cat.id, cat.nombre, cat.descripcion, cat.origen, cat.tipo, cat.valor, sv.nombre,
         cat.alcance, cat.minimo_compra, cat.tope, cat.nivel_minimo,
         case when cat.origen = 'MONEDAS' then cat.costo_basico end,
         case when cat.origen = 'MONEDAS' then coalesce(cat.costo_premium, cat.costo_basico) end,
         case when cat.origen = 'MONEDAS' then coalesce(cat.costo_vip, cat.costo_premium, cat.costo_basico) end,
         cfg.sellos_por_premio,
         cat.reclamo_desde, cat.reclamo_hasta, cat.cupon_vigencia_dias, cat.cupon_vence_el,
         case when cat.tipo <> 'SERVICIO' then null
              when exists (select 1 from public.servicios_proteccion sp where sp.servicio_id = cat.servicio_id)
                then 'PISO' else 'MITAD' end
  from public.recompensas_catalogo cat
  join public.recompensas_config cfg on cfg.id = 1
  left join public.servicios sv on sv.id = cat.servicio_id
  where cfg.activo and cat.activo
  order by cat.origen, cat.nombre;
$$;
revoke execute on function public.catalogo_recompensas_publico() from public;
grant execute on function public.catalogo_recompensas_publico() to anon, authenticated;

commit;
