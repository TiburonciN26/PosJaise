-- =========================================================
-- Estadísticas: el envío cobrado deja de contar como ingreso
--
-- Decisión de la dueña (2026-11-12): el delivery de los pedidos web lo paga
-- la clienta y se le entrega completo al repartidor. Es dinero de paso, no
-- ganancia: si una clienta compra unos aretes de S/ 20 y paga S/ 10 de
-- envío, el negocio vendió S/ 20, no S/ 30. Hasta ahora ventas.total (que
-- incluye el envío, confirmar_venta lo suma después del descuento) entraba
-- entero en "Ingreso neto" y en la ganancia, y como el pago al repartidor no
-- se resta en ningún lado, la ganancia salía inflada en el monto del envío.
--
-- Cambio: resumen_estadisticas() resta el envío de cada venta al calcular
-- ingreso_bruto (el "Ingreso neto" de la pantalla) y la tendencia diaria. Así
-- cuadra con el Dashboard, cuyo ingreso neto pasa a ser bruto − descuentos
-- (sin sumar envio_cobrado, que queda solo como dato informativo).
-- metodos_pago SIGUE usando ventas.total: ese desglose responde "cuánto
-- entró por Yape/efectivo/…", y el envío sí entró por ese medio.
--
-- El envío se lee de pedidos_web.costo_delivery, igual que resumen_dashboard
-- (20261002000005): es el único origen (el POS nunca cobra envío), así que
-- también corrige el histórico sin tocar ninguna venta ni importe.
--
-- Misma firma y mismo tipo de retorno => create or replace conserva los
-- grants que ya tenía. Sigue siendo SECURITY INVOKER (solo la
-- ADMINISTRADORA ve Estadísticas, y es_admin() le da SELECT en pedidos_web).
-- =========================================================

begin;

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
    select v.id, v.fecha, v.total, v.metodo_pago,
           v.total - coalesce(
             (select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id),
             0
           ) as total_sin_envio
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
      and u.rol <> 'ADMINISTRADOR'
      and rs.fecha >= p_desde and rs.fecha < p_hasta
  ),
  costo_total as (
    select coalesce(sum(pv.costo * i.cantidad), 0) as costo
    from items_periodo i
    join public.productos_vista pv on pv.id = i.producto_id
    where i.tipo = 'PRODUCTO'
  ),
  tendencia_dias as (
    select (fecha at time zone 'America/Lima')::date as dia, coalesce(sum(total_sin_envio), 0) as monto
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
    coalesce((select sum(total_sin_envio) from ventas_periodo), 0) as ingreso_bruto,
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

commit;
