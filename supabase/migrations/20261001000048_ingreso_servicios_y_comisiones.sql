-- =========================================================
-- POS Negocio 2 — Fase 9: comisiones pagadas en la cascada de
-- ganancia (Dashboard y Estadísticas)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- CORRECCIÓN sobre un primer intento de esta misma fase: se probó
-- cambiar la fuente de "ingreso por servicios" de venta_items a
-- registro_servicios, pero Ventas sí tiene un flujo real y usado de
-- vender un servicio por el carrito (ModalBuscarServicio →
-- confirmar_venta → venta_items), que Historial también suma. Mover
-- la fuente a registro_servicios habría hecho que Dashboard/
-- Estadísticas y Historial mostraran cifras de servicios distintas
-- para el mismo período. Se revierte esa parte: ingreso_productos,
-- ingreso_servicios/ingreso_bruto y servicios_realizados vuelven a
-- salir de ventas/venta_items, exactamente como en
-- 34_resumen_dashboard.sql / 37_resumen_estadisticas_sin_detalle.sql.
--
-- Lo único nuevo de verdad es comisiones_pagadas: lo que se les paga
-- a las ASISTENTES (pago_asistente en registro_servicios, sin
-- incluir lo que un ADMINISTRADOR registra de lo suyo — ahí se queda
-- con el 100% líquido, no es una comisión que el negocio "pague" a
-- alguien más). Vender un servicio por Ventas no genera comisión por
-- sí solo (el carrito no pide asistente ni % en el momento de la
-- venta) — para que una atención sume acá, igual que antes, tiene
-- que registrarse en Mi Panel o completarse desde una cita.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- resumen_dashboard: vuelve a leer ingreso_servicios/
-- servicios_realizados de venta_items; se agrega comisiones_pagadas.
-- DROP explícito: aunque los parámetros de entrada no cambian, sí
-- cambian las columnas de retorno (RETURNS TABLE), y Postgres no
-- deja hacer eso con CREATE OR REPLACE (42P13) — hay que borrar la
-- función vieja primero, mismo motivo que ya se documentó para
-- resumen_estadisticas más abajo.
-- ---------------------------------------------------------
drop function if exists public.resumen_dashboard(timestamptz, timestamptz);

create or replace function public.resumen_dashboard(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_productos numeric,
  ingreso_servicios numeric,
  costo_productos numeric,
  comisiones_pagadas numeric,
  productos_vendidos bigint,
  servicios_realizados bigint,
  cantidad_ventas bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ventas_periodo as (
    select v.id
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol = 'ASISTENTE'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  )
  select
    coalesce(sum(subtotal) filter (where tipo = 'PRODUCTO'), 0) as ingreso_productos,
    coalesce(sum(subtotal) filter (where tipo = 'SERVICIO'), 0) as ingreso_servicios,
    coalesce(
      (select sum(pv.costo * i.cantidad)
         from items_periodo i
         join public.productos_vista pv on pv.id = i.producto_id
        where i.tipo = 'PRODUCTO'),
      0
    ) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas
  from items_periodo
$$;

grant execute on function public.resumen_dashboard(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------
-- resumen_estadisticas: ingreso_bruto vuelve a ser solo
-- sum(ventas.total); se agrega comisiones_pagadas. top_servicios
-- sigue viniendo de venta_items, sin cambios.
-- ---------------------------------------------------------
drop function if exists public.resumen_estadisticas(timestamptz, timestamptz, boolean);

create or replace function public.resumen_estadisticas(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_incluir_detalle boolean default true
)
returns table (
  ingreso_bruto numeric,
  cantidad_ventas bigint,
  costo_productos numeric,
  comisiones_pagadas numeric,
  tendencia jsonb,
  top_productos jsonb,
  top_servicios jsonb,
  metodos_pago jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ventas_periodo as (
    select v.id, v.fecha, v.total, v.metodo_pago
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    select vi.tipo, vi.nombre, vi.cantidad, vi.subtotal, vi.producto_id
    from public.venta_items vi
    join ventas_periodo v on v.id = vi.venta_id
  ),
  comisiones_periodo as (
    select rs.pago_asistente
    from public.registro_servicios rs
    join public.usuarios u on u.id = rs.usuario_id
    where rs.estado = 'ACTIVO'
      and u.rol = 'ASISTENTE'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  ),
  costo_total as (
    select coalesce(sum(pv.costo * i.cantidad), 0) as costo
    from items_periodo i
    join public.productos_vista pv on pv.id = i.producto_id
    where i.tipo = 'PRODUCTO'
  ),
  tendencia_dias as (
    select (fecha at time zone 'America/Lima')::date as dia, coalesce(sum(total), 0) as monto
    from ventas_periodo
    group by 1
  ),
  top_prod as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'PRODUCTO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  top_serv as (
    select nombre, sum(cantidad) as cantidad, sum(subtotal) as ingreso
    from items_periodo
    where tipo = 'SERVICIO'
    group by nombre
    order by sum(cantidad) desc
    limit 5
  ),
  metodos as (
    select metodo_pago as metodo, count(*) as cantidad, coalesce(sum(total), 0) as monto
    from ventas_periodo
    group by metodo_pago
  )
  select
    coalesce((select sum(total) from ventas_periodo), 0) as ingreso_bruto,
    (select count(*) from ventas_periodo) as cantidad_ventas,
    (select costo from costo_total) as costo_productos,
    (select coalesce(sum(pago_asistente), 0) from comisiones_periodo) as comisiones_pagadas,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('fecha', dia, 'monto', monto) order by dia) from tendencia_dias),
        '[]'::jsonb
      )
    else '[]'::jsonb end as tendencia,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_prod),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_productos,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'ingreso', ingreso)) from top_serv),
        '[]'::jsonb
      )
    else '[]'::jsonb end as top_servicios,
    case when p_incluir_detalle then
      coalesce(
        (select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)) from metodos),
        '[]'::jsonb
      )
    else '[]'::jsonb end as metodos_pago
$$;

grant execute on function public.resumen_estadisticas(timestamptz, timestamptz, boolean) to authenticated;

commit;
