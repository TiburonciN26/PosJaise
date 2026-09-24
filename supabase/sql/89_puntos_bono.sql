-- =========================================================
-- POS Negocio 2 — Pestaña Web: puntos manuales/de cortesía por cliente
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 88_puntos.sql ya se haya corrido.
--
-- A pedido del usuario: probar visualmente la tarjeta Premium sin
-- depender de visitas/gasto reales todavía inexistentes ("dale 10
-- puntos por ahora solo para ver el funcionamiento de la segunda
-- tarjeta"). En vez de insertar una visita/venta falsa (eso ensuciaría
-- Historial/Fidelización con datos inventados), se agrega una columna
-- de ajuste manual que se suma tal cual al cálculo de mis_puntos() —
-- también sirve como una función real a futuro (ej. puntos de cortesía
-- por un reclamo), no es solo un hack de prueba.
-- =========================================================

begin;

alter table public.clientes
  add column puntos_bono int not null default 0;

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
      count(distinct fecha)::int as visitas,
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

grant execute on function public.mis_puntos() to authenticated;
revoke execute on function public.mis_puntos() from public;

-- Ajuste de prueba pedido por el usuario: el único cliente Web real del
-- proyecto (Turqui) recibe 10 puntos de cortesía para ver la tarjeta
-- Premium funcionando. Reversible en cualquier momento con
-- `update clientes set puntos_bono = 0 where id = '...'`.
update public.clientes
set puntos_bono = 10
where id = 'ee58fa80-4099-44a0-ac76-019b4fc36689';

commit;
