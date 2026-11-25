-- =========================================================
-- Recompensas — el tope del cupón es PAREJO por servicio (no depende de quién atienda)
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Por qué: con la comisión real (migración 20261124000001) dos clientas con el mismo servicio podían tener topes de cupón
-- distintos según quién las atendió (con una asistente al 40 % el tope bajaba; con la dueña no). Desde la clienta eso no es justo.
-- Ahora el PISO del cupón de un servicio usa siempre el % más alto entre las asistentes activas (caso conservador, igual para
-- todas), y solo sube si quien atendió realmente cobra más que ese máximo.
--
-- El costo REAL de cada venta (comisión de quien atendió; la dueña = 0) no se pierde: se guarda en la foto de la venta como
-- 'asistente_real' / 'total_real' y es lo que usa el reporte de rentabilidad. Las monedas y los sellos no dependen de la asistente
-- (se calculan sobre lo gastado), así que no cambian.
--
-- Cambia la FIRMA de salida solo agregando claves al jsonb (modo_real, asistente_real, total_real); las llamadas siguen igual.
-- =========================================================

begin;

create or replace function public.recompensas_proteccion_servicio(
  p_servicio_id uuid,
  p_precio numeric,
  p_registro_servicio_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_p public.servicios_proteccion;
  v_asis numeric;        -- mano de obra del PISO del cupón (pareja para todas las clientas)
  v_modo text;
  v_asis_real numeric;   -- mano de obra REAL de la atención vendida (solo para el reporte de rentabilidad)
  v_modo_real text;
  v_rs record;
  v_pct_max numeric;
  v_pct_vigente numeric;
  v_desglose jsonb;
begin
  select * into v_p from public.servicios_proteccion where servicio_id = p_servicio_id;
  if v_p.servicio_id is null then
    -- Sin configurar (distinto de cero explícito): respaldo del 50 %; protege lo que debe quedar cobrado.
    return jsonb_build_object('modo', 'RESPALDO_50', 'configurada', false,
      'total', p_precio - floor(p_precio * 50) / 100);
  end if;

  -- Costo REAL de la atención que se está vendiendo (no decide cuánto cupón se puede usar; solo se guarda para medir ganancia).
  if p_registro_servicio_id is not null then
    select rs.pago_asistente, rs.precio, rs.usuario_id, u.rol into v_rs
    from public.registro_servicios rs
    left join public.usuarios u on u.id = rs.usuario_id
    where rs.id = p_registro_servicio_id and rs.servicio_id = p_servicio_id;
    if found then
      if v_rs.rol = 'ADMINISTRADOR' then
        v_asis_real := 0;
        v_modo_real := 'DUENA';
      else
        -- El disparador de comisión (calcular_comision_registro_servicio) vuelve a calcular el pago con el % VIGENTE al
        -- marcar la atención como vendida; se usa ese mismo importe para coincidir con lo que realmente se paga.
        select p.porcentaje into v_pct_vigente
        from public.porcentajes p
        join public.asistentes a on a.id = p.asistente_id
        where a.usuario_id = v_rs.usuario_id and p.servicio_id = p_servicio_id;
        if v_pct_vigente is not null then
          v_asis_real := round(v_rs.precio * v_pct_vigente / 100, 2);
          v_modo_real := 'COMISION_REAL';
        elsif v_rs.pago_asistente is not null then
          v_asis_real := v_rs.pago_asistente;
          v_modo_real := 'COMISION_REAL';
        end if;
      end if;
    end if;
  end if;

  -- PISO del cupón, PAREJO por servicio (2026-11-24): dos clientas con el mismo servicio tienen el mismo tope sin importar quién las
  -- atienda. Se usa el % más alto entre las asistentes activas con porcentaje para este servicio (caso conservador: el piso protege
  -- aunque atienda la asistente que más cobra). Sin ninguna, la estimación antigua como último recurso.
  select max(p.porcentaje) into v_pct_max
  from public.porcentajes p
  join public.asistentes a on a.id = p.asistente_id and a.activo
  left join public.usuarios u on u.id = a.usuario_id
  where p.servicio_id = p_servicio_id
    and p.porcentaje is not null
    and coalesce(u.rol, '') <> 'ADMINISTRADOR';
  if v_pct_max is not null then
    v_asis := ceil(p_precio * v_pct_max) / 100;   -- precio x % / 100, hacia arriba al centavo
    v_modo := 'COMISION_MAX';
  elsif v_p.asistente_pct is not null then
    v_modo := 'PORCENTAJE';
    v_asis := ceil(p_precio * v_p.asistente_pct) / 100;
  else
    v_modo := 'IMPORTE_FIJO';
    v_asis := v_p.asistente;
  end if;

  -- Si quien atendió ya no figura entre las activas (o cobra más que el máximo vigente) el piso nunca baja de lo que realmente se paga.
  if v_asis_real is not null and v_asis_real > v_asis then
    v_asis := v_asis_real;
    v_modo := coalesce(v_modo_real, v_modo);
  end if;

  -- Desglose por categoría de la receta (INSUMO, DESCARTABLE, HERRAMIENTA, TARJETA_POS, OTRO y LOCAL). LOCAL es informativo:
  -- no entra en el piso. Queda guardado con la venta para saber, a largo plazo, en qué se fue el costo.
  select jsonb_object_agg(x.categoria, x.monto) into v_desglose
  from (select categoria, ceil(sum(subtotal) * 100) / 100 as monto
        from public.servicios_costos_detalle where servicio_id = p_servicio_id group by categoria) x;

  return jsonb_build_object('modo', v_modo, 'configurada', true,
    'materiales', v_p.materiales, 'asistente_pct', v_p.asistente_pct, 'asistente', v_asis,
    'otros', v_p.otros, 'precio', p_precio, 'total', v_p.materiales + v_asis + v_p.otros,
    -- Costo REAL de esa venta (comisión de quien atendió; la dueña = 0): lo que usa el reporte de rentabilidad.
    'modo_real', coalesce(v_modo_real, v_modo),
    'asistente_real', coalesce(v_asis_real, v_asis),
    'total_real', v_p.materiales + coalesce(v_asis_real, v_asis) + v_p.otros,
    'registro_servicio_id', p_registro_servicio_id, 'desglose', coalesce(v_desglose, '{}'::jsonb));
end;
$$;
revoke execute on function public.recompensas_proteccion_servicio(uuid, numeric, uuid) from public, anon, authenticated;

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
                then case when coalesce((d.proteccion ->> 'configurada')::boolean, false) then coalesce((d.proteccion ->> 'total_real')::numeric, (d.proteccion ->> 'total')::numeric) end
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
