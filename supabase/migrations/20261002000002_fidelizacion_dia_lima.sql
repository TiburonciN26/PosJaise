-- =========================================================
-- POS Negocio 2 — QA-012: sellos/puntos duplicados por dos atenciones
-- el mismo día
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 89_puntos_bono.sql y 97_cupones_fidelizacion.sql ya se
-- hayan corrido.
--
-- Bug reproducido: registro_servicios.fecha es timestamptz (hora exacta
-- de la atención, default now() en 19_registro_servicios.sql), no una
-- fecha pura. mis_puntos(), mi_fidelizacion(), generar_cupon_fidelizacion()
-- y mi_historial_fidelizacion() contaban "visitas" con
-- count(distinct fecha) — eso cuenta instantes distintos, no días
-- distintos. Dos atenciones el mismo día real a horas distintas (ej.
-- 10am y 3pm, o dos citas completadas el mismo día) ya tenían fecha
-- distinta y se contaban como 2 visitas, duplicando puntos por visita
-- y sellos de fidelización. mi_historial_fidelizacion() además podía
-- devolver el mismo día dos veces: el DISTINCT corría sobre el
-- timestamptz crudo, antes de truncarlo a date vía el tipo de retorno.
--
-- Mismo patrón que el fix de zona horaria de es_hoy()
-- (12_fix_zona_horaria_es_hoy.sql): se trunca a date en hora de Perú
-- (America/Lima), no en UTC ni en la hora exacta del registro. No
-- cambia la fórmula de puntos/sellos en sí (fórmulas y umbrales
-- intactos), solo qué cuenta como "un día".
-- =========================================================

begin;

-- ---------------------------------------------------------
-- mis_puntos() — versión viva: 89_puntos_bono.sql.
-- ---------------------------------------------------------
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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

-- ---------------------------------------------------------
-- mi_fidelizacion() — versión viva: 97_cupones_fidelizacion.sql.
-- ---------------------------------------------------------
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
$$;

-- ---------------------------------------------------------
-- generar_cupon_fidelizacion() — versión viva: 97_cupones_fidelizacion.sql,
-- mismo cuerpo salvo el conteo de visitas.
-- ---------------------------------------------------------
create or replace function public.generar_cupon_fidelizacion()
returns table (codigo text, valor numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id      uuid;
  v_visitas_totales int;
  v_reclamadas      int;
  v_disponibles     int;
  v_porcentaje      numeric;
  v_codigo          text;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de generar un cupón.';
  end if;

  select count(distinct (fecha at time zone 'America/Lima')::date)::int into v_visitas_totales
  from public.registro_servicios
  where cliente_id = v_cliente_id and estado = 'ACTIVO';

  select fidelizacion_recompensas_reclamadas into v_reclamadas
  from public.clientes
  where id = v_cliente_id
  for update;

  v_disponibles := (v_visitas_totales / 5) - coalesce(v_reclamadas, 0);

  if v_disponibles <= 0 then
    raise exception 'Todavía no completaste una tarjeta de 5 visitas.';
  end if;

  select porcentaje_recompensa into v_porcentaje from public.config_fidelizacion where id = 1;

  update public.clientes
  set fidelizacion_recompensas_reclamadas = fidelizacion_recompensas_reclamadas + 1
  where id = v_cliente_id;

  v_codigo := public.generar_codigo_cupon();

  insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento)
  values (v_cliente_id, v_codigo, 'FIDELIZACION', v_porcentaje, 'PORCENTAJE');

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    v_cliente_id,
    'FIDELIZACION',
    '¡Generaste un cupón!',
    'Tu cupón de ' || v_porcentaje || '% de descuento ya está listo. Muéstralo en tu próxima visita.',
    '/fidelizacion'
  );

  return query select v_codigo, v_porcentaje;
end;
$$;

-- ---------------------------------------------------------
-- mi_historial_fidelizacion() — versión viva: 97_cupones_fidelizacion.sql.
-- El DISTINCT ahora corre sobre la fecha ya truncada a día de Lima, no
-- sobre el timestamptz crudo (antes podía devolver el mismo día dos
-- veces si el truncado solo pasaba al convertir al tipo de retorno).
-- ---------------------------------------------------------
create or replace function public.mi_historial_fidelizacion()
returns table (fecha date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct (rs.fecha at time zone 'America/Lima')::date as fecha
  from public.registro_servicios rs
  where rs.cliente_id = public.mi_cliente_id()
    and rs.estado = 'ACTIVO'
  order by fecha desc;
$$;

commit;
