-- =========================================================
-- POS Negocio 2 — Pestaña Web: Sistema de puntos / niveles de tarjeta
-- Ejecutar en Supabase → SQL Editor → New query
--
-- A pedido del usuario: el chanchito del header (ver
-- implementacionesWed.md §7.13) abre una subpágina "Mis puntos" con una
-- tarjeta que sube de nivel automáticamente (Básico → Premium → VIP)
-- según ciertos requisitos. Confirmado con el usuario (AskUserQuestion):
-- los puntos suman TANTO por visitas completadas como por monto
-- gastado, pero las cantidades exactas de cada uno todavía no están
-- decididas ("aun esta por definir la cantidades exactas") — por eso
-- los dos multiplicadores viven en una tabla de configuración editable
-- (`config_puntos`, panel "Puntos Web" en el POS), no hardcodeados en
-- una función: el negocio puede ajustarlos después sin un despliegue
-- nuevo, mismo criterio que `zonas_delivery` (85_carrito_pedidos_web.sql).
-- Los umbrales de nivel sí los confirmó el usuario: 10 puntos → Premium,
-- 30 puntos → VIP. Por defecto todo cliente nuevo empieza en Básico (0
-- puntos) — no hace falta ninguna fila por cliente para eso, "Básico" es
-- simplemente "menos que el umbral de Premium".
--
-- Fuente de los puntos (reutiliza datos que YA existen, no crea una
-- bitácora nueva — mismo espíritu que mi_fidelizacion(), 78_fidelizacion_
-- web.sql): visitas = count(distinct fecha) en registro_servicios (una
-- visita con 2 servicios sigue siendo 1 visita); gastado = suma de
-- registro_servicios.precio de esas mismas filas. Los pedidos de
-- productos (pedidos_web) NO se suman todavía a "gastado" — se puede
-- agregar después si el negocio lo pide, hoy solo se documenta acá para
-- no perder la idea.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Configuración (fila única, id fijo = 1)
-- ---------------------------------------------------------
create table public.config_puntos (
  id                      int primary key default 1,
  puntos_por_visita       numeric(10, 2) not null default 1,
  puntos_por_sol_gastado  numeric(10, 4) not null default 0.05,
  umbral_premium          int not null default 10,
  umbral_vip              int not null default 30,
  actualizado_en          timestamptz not null default now(),
  constraint config_puntos_singleton check (id = 1)
);

insert into public.config_puntos (id) values (1);

alter table public.config_puntos enable row level security;
grant select on public.config_puntos to authenticated;
grant update on public.config_puntos to authenticated;

-- Lectura abierta a cualquier autenticado: el cliente necesita ver los
-- umbrales para saber "cuánto le falta" en su propia tarjeta.
create policy config_puntos_select on public.config_puntos
  for select to authenticated
  using (true);

create policy config_puntos_update_admin on public.config_puntos
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---------------------------------------------------------
-- 2. Puntos y nivel del cliente autenticado
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
      count(distinct fecha)::int as visitas,
      coalesce(sum(precio), 0) as gastado
    from public.registro_servicios
    where cliente_id = public.mi_cliente_id()
      and estado = 'ACTIVO'
  ),
  cfg as (
    select * from public.config_puntos where id = 1
  ),
  calc as (
    select
      floor(base.visitas * cfg.puntos_por_visita + base.gastado * cfg.puntos_por_sol_gastado)::int as puntos,
      base.visitas,
      base.gastado,
      cfg.umbral_premium,
      cfg.umbral_vip
    from base, cfg
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

commit;
