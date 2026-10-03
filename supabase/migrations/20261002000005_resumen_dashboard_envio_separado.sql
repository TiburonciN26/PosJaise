-- =========================================================
-- QA-031 — Dashboard mezclaba el envío con los descuentos
--
-- resumen_dashboard() calculaba descuentos = sum(venta_items.subtotal) -
-- sum(ventas.total). Pero ventas.total INCLUYE el delivery (confirmar_venta lo
-- suma DESPUÉS del descuento/cupón), así que una venta con envío "restaba" el
-- cargo de envío de los descuentos: con subtotal 10, cupón 1.50 y envío 10
-- (total 18.50) el descuento acumulado bajaba 8.50 en vez de subir 1.50, y
-- podía volverse negativo.
--
-- Cambio: descuentos = sum(items) - sum(total - envío) y el envío cobrado sale
-- como columna propia (envio_cobrado), para que el neto siga cuadrando con
-- Estadísticas (ingreso neto = sum(ventas.total) = bruto - descuentos + envío).
-- El envío de una venta se lee de pedidos_web.costo_delivery (único origen:
-- verificar_pago_pedido_web pasa p_costo_delivery; el POS nunca lo usa), así
-- que corrige también el histórico sin tocar ninguna venta ni importe.
-- No se asume coste del repartidor ni se cambia cómo se trata el envío como ingreso.
--
-- Cambia el tipo de retorno (columna nueva al final) => drop + create. Mismos
-- permisos por defecto que tenía; sigue siendo SECURITY INVOKER.
-- =========================================================

begin;

drop function if exists public.resumen_dashboard(timestamptz, timestamptz);

create function public.resumen_dashboard(p_desde timestamptz, p_hasta timestamptz)
returns table (
  ingreso_productos numeric,
  ingreso_servicios numeric,
  costo_productos numeric,
  comisiones_pagadas numeric,
  descuentos numeric,
  productos_vendidos bigint,
  servicios_realizados bigint,
  cantidad_ventas bigint,
  envio_cobrado numeric
)
language sql
stable
set search_path = public, pg_temp
as $function$
  with ventas_periodo as (
    select v.id, v.total,
           coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0) as envio
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
      and u.rol <> 'ADMINISTRADOR'
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
      (select sum(subtotal) from items_periodo)
        - (select coalesce(sum(total - envio), 0) from ventas_periodo),
      0
    ) as descuentos,
    coalesce(sum(cantidad) filter (where tipo = 'PRODUCTO'), 0) as productos_vendidos,
    coalesce(sum(cantidad) filter (where tipo = 'SERVICIO'), 0) as servicios_realizados,
    (select count(*) from ventas_periodo) as cantidad_ventas,
    (select coalesce(sum(envio), 0) from ventas_periodo) as envio_cobrado
  from items_periodo
$function$;

commit;
