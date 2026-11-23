-- =========================================================
-- Dashboard: detalle del «Resumen del período»
--
-- El Resumen solo muestra totales (Ingreso productos, Ingreso servicios, Descuentos, Comisiones, Envío). Para saber de qué
-- está hecho cada monto había que ir al Historial de ventas, donde todo está mezclado. detalle_dashboard() devuelve las
-- filas que componen cada total, para el mismo rango de fechas del Dashboard.
--
-- POR QUÉ UNA RPC y no consultas sueltas en el navegador: el detalle tiene que CUADRAR al centavo con resumen_dashboard()
-- (mismos filtros: ventas ACTIVA en [p_desde, p_hasta); comisiones de registro_servicios ACTIVO de personal que no es
-- ADMINISTRADOR). Armarlo en el cliente repetiría esos criterios en dos sitios (y PostgREST corta a 1000 filas).
-- Si cambia un filtro en resumen_dashboard(), cambiarlo aquí también.
--
-- p_seccion: 'productos' | 'servicios' | 'descuentos' | 'comisiones' | 'envios'. Cada pestaña pide solo la suya.
--   · productos   → una fila por producto (unidades, ingreso, costo, ganancia, stock actual) con sus ventas anidadas.
--   · servicios   → una fila por servicio cobrado (precio = venta_items.subtotal, igual que ingreso_servicios).
--   · descuentos  → ventas cuyo subtotal de ítems supera lo cobrado sin envío (misma cuenta que resumen_dashboard.descuentos).
--   · comisiones  → registro_servicios del período (misma condición que comisiones_periodo).
--   · envios      → costo_delivery de los pedidos web de las ventas del período (informativo).
--
-- SECURITY INVOKER (RLS de venta_items/ventas/registro_servicios ya limita a admin) + chequeo explícito es_admin(): el costo
-- de los productos solo lo ve el admin (productos_vista) y el Dashboard es solo de la ADMINISTRADORA.
-- =========================================================

begin;

create or replace function public.detalle_dashboard(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_seccion text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
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
        sum(vi.subtotal) as ingreso,
        coalesce(sum(pv.costo * vi.cantidad), 0) as costo,
        sum(vi.subtotal) - coalesce(sum(pv.costo * vi.cantidad), 0) as ganancia,
        pv.stock_actual as stock_actual,
        jsonb_agg(
          jsonb_build_object(
            'fecha', v.fecha,
            'codigo', v.codigo,
            'cliente', c.nombre,
            'vendedor', u.nombre_completo,
            'cantidad', vi.cantidad,
            'precio_unitario', vi.precio_unitario,
            'subtotal', vi.subtotal
          ) order by v.fecha desc
        ) as ventas
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
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
        vi.subtotal as precio,
        vi.pago_asistente as comision
      from public.venta_items vi
      join public.ventas v on v.id = vi.venta_id
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
$$;

revoke execute on function public.detalle_dashboard(timestamptz, timestamptz, text) from public;
grant execute on function public.detalle_dashboard(timestamptz, timestamptz, text) to authenticated;

commit;
