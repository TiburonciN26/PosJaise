-- =========================================================
-- Recompensas — reporte de RENTABILIDAD del programa y de cada servicio / producto.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Por qué: la dueña quiere saber, a largo plazo, si gana o pierde dinero (con y sin el programa de puntos) y si las clientas que
-- participan vienen más seguido y gastan más. Esta función solo LEE; no escribe nada ni cambia ninguna regla.
--
-- Fuente: recompensas_venta_detalle (una fila por línea de cada venta, con la protección/costo guardado EN ESE MOMENTO: comisión real
-- de la asistente, materiales, otros, desglose) + recompensas_movimientos / sellos (el libro del programa) + ventas + clientes.
-- Honestidad de los datos: solo se calcula margen en las líneas cuyo costo es CONOCIDO (servicio configurado, producto con costo
-- conocido). Las demás se cuentan aparte y se listan como «sin costo»: nunca se inventa un costo cero. El margen es DIRECTO
-- (precio cobrado − descuento − costo directo); el tiempo del local (categoría LOCAL) es informativo y no se resta.
--
-- Solo ADMINISTRADOR (comprobación dentro de la función). Periodo en días de Lima, máximo 800 días.
-- =========================================================

begin;

create or replace function public.recompensas_rentabilidad(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v_cfg public.recompensas_config;
  v_res jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver la rentabilidad.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El periodo no es válido.';
  end if;
  if p_hasta - p_desde > 800 then
    raise exception 'El periodo no puede superar 800 días.';
  end if;

  v_ini := p_desde::timestamp at time zone 'America/Lima';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Lima';
  select * into v_cfg from public.recompensas_config where id = 1;

  with vp as (
    select v.id, v.cliente_id, v.total, v.cupon_id, (v.fecha at time zone 'America/Lima')::date as dia
    from public.ventas v
    where v.estado = 'ACTIVA' and v.fecha >= v_ini and v.fecha < v_fin
  ),
  lin as (
    select d.venta_id, d.tipo, d.servicio_id, d.producto_id, d.subtotal, d.descuento, d.neto,
           case when d.tipo = 'SERVICIO'
                then coalesce((d.proteccion ->> 'configurada')::boolean, false)
                else coalesce((d.proteccion ->> 'costo_conocido')::boolean, false) end as conocido,
           case when d.tipo = 'SERVICIO'
                then case when coalesce((d.proteccion ->> 'configurada')::boolean, false) then (d.proteccion ->> 'total')::numeric end
                else case when coalesce((d.proteccion ->> 'costo_conocido')::boolean, false) then (d.proteccion ->> 'total')::numeric end end as costo,
           vp.cupon_id
    from public.recompensas_venta_detalle d
    join vp on vp.id = d.venta_id
  ),
  cup_rec as (
    select l.venta_id, sum(l.descuento) as descuento
    from lin l
    join public.cupones c on c.id = l.cupon_id and c.origen in ('RECOMPENSA_MONEDAS', 'RECOMPENSA_SELLOS')
    group by l.venta_id
  ),
  mov as (
    select m.tipo, m.monedas from public.recompensas_movimientos m
    where m.creado_en >= v_ini and m.creado_en < v_fin
  ),
  sel as (
    select s.tipo, s.delta from public.recompensas_sellos_movs s
    where s.creado_en >= v_ini and s.creado_en < v_fin
  ),
  saldos as (
    select cliente_id, sum(monedas) as monedas from public.recompensas_movimientos group by cliente_id
  ),
  coh as (
    select (c.cliente_web_id is not null) as miembra, vp.cliente_id,
           count(distinct vp.dia) as dias, count(*) as ventas, sum(vp.total) as ingreso
    from vp join public.clientes c on c.id = vp.cliente_id
    group by 1, 2
  ),
  coh_g as (
    select miembra,
           count(*) as clientas,
           sum(ventas) as ventas,
           sum(ingreso) as ingreso,
           round(sum(ingreso) / nullif(sum(ventas), 0), 2) as ticket,
           round(sum(ventas)::numeric / count(*), 2) as ventas_por_clienta,
           round(100.0 * count(*) filter (where dias >= 2) / count(*), 1) as recurrentes_pct
    from coh group by miembra
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'programa', jsonb_build_object(
      'activo', v_cfg.activo, 'corte', v_cfg.corte,
      'monedas_emitidas', coalesce((select sum(monedas) from mov where tipo = 'VENTA'), 0),
      'monedas_revertidas', coalesce((select -sum(monedas) from mov where tipo = 'VENTA_REVERSION'), 0),
      'monedas_canjeadas', coalesce((select -sum(monedas) from mov where tipo = 'CANJE'), 0),
      'canjes', (select count(*) from mov where tipo = 'CANJE') + (select count(*) from sel where tipo = 'CANJE_SELLOS'),
      'sellos_otorgados', coalesce((select sum(delta) from sel where tipo = 'SELLO'), 0),
      'sellos_canjeados', coalesce((select -sum(delta) from sel where tipo = 'CANJE_SELLOS'), 0),
      'monedas_pendientes_total', coalesce((select sum(monedas) from saldos where monedas > 0), 0),
      'clientas_con_saldo', (select count(*) from saldos where monedas > 0)
    ),
    'ventas', jsonb_build_object(
      'cantidad', (select count(*) from vp),
      'ingreso_bruto', coalesce((select sum(subtotal) from lin), 0),
      'descuentos', coalesce((select sum(descuento) from lin), 0),
      'neto', coalesce((select sum(neto) from lin), 0),
      'ventas_con_cupon_recompensa', (select count(*) from cup_rec),
      'descuento_por_recompensas', coalesce((select sum(descuento) from cup_rec), 0)
    ),
    'margen', jsonb_build_object(
      'lineas', (select count(*) from lin),
      'lineas_con_costo', (select count(*) from lin where conocido),
      'lineas_sin_costo', (select count(*) from lin where not conocido),
      'neto_con_costo', coalesce((select sum(neto) from lin where conocido), 0),
      'costo_directo', coalesce((select sum(costo) from lin where conocido), 0),
      'margen', coalesce((select sum(neto - costo) from lin where conocido), 0),
      'margen_pct', (select round(100.0 * sum(neto - costo) / nullif(sum(neto), 0), 1) from lin where conocido)
    ),
    'por_servicio', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.neto desc) from (
        select s.nombre, count(*) as lineas, sum(l.subtotal) as ingreso, sum(l.descuento) as descuento,
               sum(l.neto) as neto, sum(l.costo) as costo, sum(l.neto - l.costo) as margen
        from lin l join public.servicios s on s.id = l.servicio_id
        where l.tipo = 'SERVICIO' and l.conocido
        group by s.id, s.nombre order by sum(l.neto) desc limit 25) x), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.neto desc) from (
        select p.nombre, sum(vi.cantidad) as unidades, count(*) as lineas, sum(l.subtotal) as ingreso, sum(l.descuento) as descuento,
               sum(l.neto) as neto, sum(l.costo) as costo, sum(l.neto - l.costo) as margen
        from lin l
        join public.productos p on p.id = l.producto_id
        join public.venta_items vi on vi.venta_id = l.venta_id and vi.producto_id = l.producto_id
        where l.tipo = 'PRODUCTO' and l.conocido
        group by p.id, p.nombre order by sum(l.neto) desc limit 25) x), '[]'::jsonb),
    'sin_costo', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ingreso desc) from (
        select l.tipo, coalesce(s.nombre, p.nombre) as nombre, count(*) as lineas, sum(l.neto) as ingreso
        from lin l
        left join public.servicios s on s.id = l.servicio_id
        left join public.productos p on p.id = l.producto_id
        where not l.conocido
        group by l.tipo, coalesce(s.nombre, p.nombre) order by sum(l.neto) desc limit 15) x), '[]'::jsonb),
    'cohortes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grupo', case when miembra then 'MIEMBRAS' else 'RESTO' end,
        'clientas', clientas, 'ventas', ventas, 'ingreso', ingreso, 'ticket', ticket,
        'ventas_por_clienta', ventas_por_clienta, 'recurrentes_pct', recurrentes_pct)
        order by miembra desc) from coh_g), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;
revoke execute on function public.recompensas_rentabilidad(date, date) from public, anon;
grant execute on function public.recompensas_rentabilidad(date, date) to authenticated;

commit;
