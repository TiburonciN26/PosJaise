-- =========================================================
-- Dashboard: el ingreso es lo que de verdad entró (después de descuentos)
--
-- ANTES: «Ingreso productos» e «Ingreso servicios» sumaban venta_items.subtotal, o sea el importe ANTES del descuento de la
-- venta, y el «Ingreso bruto» del Dashboard era esa suma (venta de 10 + venta de 60 con 5 de descuento → 70). El descuento se
-- restaba aparte, así que el «bruto» mostraba plata que nunca entró a caja.
--
-- AHORA: el descuento de cada venta se reparte entre sus ítems en proporción a su subtotal y esos importes NETOS son los que se
-- suman (10 + 55 = 65). Los netos de una venta suman exactamente ventas.total - envío, el mismo «Ingreso neto» de Estadísticas.
--   · resumen_dashboard: ingreso_productos e ingreso_servicios ahora son netos. «descuentos» no cambia (ítems - (total - envío))
--     y pasa a ser solo informativo: ya está restado del ingreso, no hay que restarlo otra vez.
--   · detalle_dashboard: las pestañas Productos y Servicios muestran los mismos importes netos (su pie sigue cuadrando con el
--     Resumen). En Productos la ganancia = ingreso neto - costo. Descuentos, Comisiones y Envío no cambian.
-- Sin descuentos el reparto no cambia nada (factor 1). El costo, las comisiones y los descuentos de las demás pantallas no se tocan.
-- =========================================================

begin;

CREATE OR REPLACE FUNCTION public.resumen_dashboard(p_desde timestamp with time zone, p_hasta timestamp with time zone)
 RETURNS TABLE(ingreso_productos numeric, ingreso_servicios numeric, costo_productos numeric, comisiones_pagadas numeric, descuentos numeric, productos_vendidos bigint, servicios_realizados bigint, cantidad_ventas bigint, envio_cobrado numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with ventas_periodo as (
    select v.id, v.total,
           coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0) as envio,
           coalesce((select sum(x.subtotal) from public.venta_items x where x.venta_id = v.id), 0) as subtotal_items
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
  ),
  items_periodo as (
    -- neto: lo que de verdad ingresó por este ítem = su subtotal menos la parte del descuento de la venta que le toca
    -- (el descuento se reparte en proporción al subtotal de cada ítem; el envío no es ingreso). Sumados, los netos de una venta
    -- dan exactamente ventas.total - envío.
    select vi.tipo, vi.cantidad, vi.subtotal, vi.producto_id,
           coalesce(vi.subtotal * (v.total - v.envio) / nullif(v.subtotal_items, 0), 0) as neto
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
    coalesce(sum(neto) filter (where tipo = 'PRODUCTO'), 0) as ingreso_productos,
    coalesce(sum(neto) filter (where tipo = 'SERVICIO'), 0) as ingreso_servicios,
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

CREATE OR REPLACE FUNCTION public.detalle_dashboard(p_desde timestamp with time zone, p_hasta timestamp with time zone, p_seccion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_filas jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede ver el detalle del dashboard' using errcode = '42501';
  end if;

  if p_seccion = 'productos' then
    select coalesce(jsonb_agg(f order by f.ingreso desc, f.nombre), '[]'::jsonb) into v_filas
    from (
      select
        coalesce(pv.nombre, vi.nombre) as nombre,
        vi.producto_id,
        sum(vi.cantidad)::int as unidades,
        sum(n.valor) as ingreso,
        coalesce(sum(pv.costo * vi.cantidad), 0) as costo,
        sum(n.valor) - coalesce(sum(pv.costo * vi.cantidad), 0) as ganancia,
        pv.stock_actual as stock_actual,
        jsonb_agg(
          jsonb_build_object(
            'fecha', v.fecha,
            'codigo', v.codigo,
            'cliente', c.nombre,
            'vendedor', u.nombre_completo,
            'cantidad', vi.cantidad,
            'precio_unitario', vi.precio_unitario,
            'subtotal', n.valor
          ) order by v.fecha desc
        ) as ventas
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
      cross join lateral (
        select coalesce(
          vi.subtotal * (v.total - coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0))
            / nullif((select sum(x.subtotal) from public.venta_items x where x.venta_id = v.id), 0),
          0) as valor
      ) n
      left join public.productos_vista pv on pv.id = vi.producto_id
      left join public.clientes c on c.id = coalesce(vi.cliente_id, v.cliente_id)
      left join public.usuarios u on u.id = v.vendedor_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and vi.tipo = 'PRODUCTO'
      group by vi.producto_id, coalesce(pv.nombre, vi.nombre), pv.stock_actual
    ) f;

  elsif p_seccion = 'servicios' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        vi.nombre as servicio,
        c.nombre as cliente,
        a.nombres_completos as asistente,
        vi.cantidad,
        n.valor as precio,
        vi.pago_asistente as comision
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
      cross join lateral (
        select coalesce(
          vi.subtotal * (v.total - coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0))
            / nullif((select sum(x.subtotal) from public.venta_items x where x.venta_id = v.id), 0),
          0) as valor
      ) n
      left join public.clientes c on c.id = coalesce(vi.cliente_id, v.cliente_id)
      left join public.asistentes a on a.id = vi.asistente_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and vi.tipo = 'SERVICIO'
    ) f;

  elsif p_seccion = 'descuentos' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        c.nombre as cliente,
        s.subtotal_items as subtotal,
        s.subtotal_items - (v.total - s.envio) as descuento,
        v.descuento_pct,
        v.descuento_monto,
        cu.codigo as cupon,
        v.total - s.envio as total
      from public.ventas v
      cross join lateral (
        select
          coalesce((select sum(vi.subtotal) from public.venta_items vi where vi.venta_id = v.id), 0) as subtotal_items,
          coalesce((select sum(p.costo_delivery) from public.pedidos_web p where p.venta_id = v.id), 0) as envio
      ) s
      left join public.clientes c on c.id = v.cliente_id
      left join public.cupones cu on cu.id = v.cupon_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and round(s.subtotal_items - (v.total - s.envio), 2) > 0
    ) f;

  elsif p_seccion = 'comisiones' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        rs.fecha,
        u.nombre_completo as asistente,
        sv.nombre as servicio,
        c.nombre as cliente,
        rs.precio,
        rs.porcentaje_aplicado as porcentaje,
        coalesce(rs.pago_asistente, 0) as pago
      from public.registro_servicios rs
      join public.usuarios u on u.id = rs.usuario_id
      left join public.servicios sv on sv.id = rs.servicio_id
      left join public.clientes c on c.id = rs.cliente_id
      where rs.estado = 'ACTIVO'
        and u.rol <> 'ADMINISTRADOR'
        and rs.fecha >= p_desde and rs.fecha < p_hasta
    ) f;

  elsif p_seccion = 'envios' then
    select coalesce(jsonb_agg(f order by f.fecha desc), '[]'::jsonb) into v_filas
    from (
      select
        v.fecha,
        v.codigo,
        c.nombre as cliente,
        p.tipo_entrega,
        p.costo_delivery as envio
      from public.pedidos_web p
      join public.ventas v on v.id = p.venta_id
      left join public.clientes c on c.id = v.cliente_id
      where v.estado = 'ACTIVA' and v.fecha >= p_desde and v.fecha < p_hasta
        and coalesce(p.costo_delivery, 0) > 0
    ) f;

  else
    raise exception 'Sección de detalle desconocida: %', p_seccion using errcode = '22023';
  end if;

  return v_filas;
end
$function$;

commit;
