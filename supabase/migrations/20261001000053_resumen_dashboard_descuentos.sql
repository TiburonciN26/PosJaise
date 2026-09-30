-- =========================================================
-- POS Negocio 2 — Descuentos totales en el Resumen del período
-- (Dashboard)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 48_ingreso_servicios_y_comisiones.sql ya se haya
-- corrido (resumen_dashboard con comisiones_pagadas).
--
-- ingreso_productos/ingreso_servicios ya suman venta_items.subtotal,
-- que es el precio ANTES de aplicar el descuento general de la venta
-- (confirmar_venta primero arma esos items, recién después descuenta
-- sobre el total). Entonces:
--   sum(items.subtotal) del período  =  sum(ventas.total) + sum(descuentos)
-- Por eso "descuentos" sale de la resta entre ambos, sin necesidad de
-- reinterpretar descuento_pct/descuento_monto por separado (uno de los
-- dos siempre es 0, y esto ya cubre ambos casos con la misma cuenta).
-- =========================================================

begin;

drop function if exists public.resumen_dashboard(timestamptz, timestamptz);

create or replace function public.resumen_dashboard(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_productos numeric,
  ingreso_servicios numeric,
  costo_productos numeric,
  comisiones_pagadas numeric,
  descuentos numeric,
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
    select v.id, v.total
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
    coalesce(
      (select sum(subtotal) from items_periodo) - (select coalesce(sum(total), 0) from ventas_periodo),
      0
    ) as descuentos,
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas
  from items_periodo
$$;

grant execute on function public.resumen_dashboard(timestamptz, timestamptz) to authenticated;

commit;
