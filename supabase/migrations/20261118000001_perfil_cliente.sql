-- Perfil de clienta en el POS (pestaña Clientes → clic en una fila abre su perfil completo).
--
-- Hasta ahora lo que se sabe de una clienta estaba repartido en otras pestañas (Historial, Citas, Deudas, Recompensas…)
-- y los puntos ni siquiera se veían en el POS. El perfil junta todo; esta migración da lo que el front no puede
-- armar con una consulta simple:
--
--  1. `clientes.creado_en` («Cliente desde»): se agrega SIN default y se rellena desde `auditoria` (la fila «creado»
--     más antigua de cada clienta); recién después se le pone `default now()`. Si se agregara con el default de una vez,
--     Postgres llenaría todas las filas con la fecha de esta migración (mismo cuidado que 20261112000015 en servicios).
--     Este UPDATE no llena Auditoría: `registrar_auditoria()` salta la clave `creado_en`. `clientes` da sus permisos a
--     `authenticated` a nivel de TABLA, así que la columna nueva se hereda sin GRANT extra.
--  2. `perfil_cliente_resumen(id)`: los indicadores del encabezado en una sola llamada (total gastado, visitas, ticket
--     promedio, última visita, servicio y asistente favoritos, citas, deuda pendiente, puntos y nivel, referidos) más
--     los conteos de cada sección desplegable. Los puntos salen de `recompensas_saldos()`, que no tiene grant para
--     `authenticated`: por eso esto va en una función security definer.
--  3. `visitas_cliente(id, limite, desde)`: una fila por DÍA (hora de Lima) con las atenciones y las ventas de la
--     clienta. Agrupar por día del lado del servidor permite paginar por días y no por filas sueltas.
--     Un día cuenta como visita si tuvo una atención no cancelada o una venta activa.
--  1b. `clientes_dni_formato`: el DNI vuelve al formulario de cliente; 8 dígitos (ver el detalle abajo).
--  4. `servicios_cliente_resumen(id)` y `productos_cliente_resumen(id)`: una fila por servicio / producto, para que la
--     sección «Servicios» no repita lo que ya muestra «Visitas» (decisión del 2026-11-18).
--
-- Todas son solo para ADMINISTRADOR (42501 para cualquier otro rol), igual que la pestaña Clientes. Las demás secciones
-- del perfil (citas, puntos, deudas, cupones, reseñas, pedidos) se leen directo de sus tablas: RLS ya deja a la
-- administración leerlas.
--
-- Fuente de los servicios: `registro_servicios` (las atenciones). Todo servicio vendido nace de una atención
-- (`registrar_venta` exige `registro_servicio_id` y le pone `venta_id`), así que ahí están todos, cobrados o no.
begin;

-- 1. Cliente desde ----------------------------------------------------------------------------------------------
alter table public.clientes add column if not exists creado_en timestamptz;

update public.clientes c
set creado_en = a.primera
from (
  select registro_id, min(fecha) as primera
  from public.auditoria
  where tabla = 'clientes' and campo is null and valor_nuevo = 'creado'
  group by registro_id
) a
where a.registro_id = c.id::text
  and c.creado_en is null;

alter table public.clientes alter column creado_en set default now();

-- 1b. DNI con formato ---------------------------------------------------------------------------------------------
-- El formulario de cliente vuelve a pedir el DNI (se había sacado en la 67 por ser un dato que casi nadie llenaba;
-- pedido del 2026-11-18: el perfil lo muestra y se quiere poder cargarlo). Peruano: exactamente 8 dígitos, igual que
-- `clientes_ruc_formato` hace con el RUC. NOT VALID: rige para todo INSERT/UPDATE desde ahora, pero no revisa las
-- filas viejas, así la migración no falla si en producción quedó algún DNI cargado a mano con otro formato (esa fila
-- recién tendrá que corregirse la próxima vez que se edite). Sin índice único: puede haber clientas duplicadas
-- con el mismo DNI y un UNIQUE haría fallar la migración.
alter table public.clientes drop constraint if exists clientes_dni_formato;
alter table public.clientes add constraint clientes_dni_formato check (dni is null or dni ~ '^[0-9]{8}$') not valid;

-- 2. Resumen del encabezado -------------------------------------------------------------------------------------
create or replace function public.perfil_cliente_resumen(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_gastado numeric;
  v_ventas int;
  v_visitas int;
  v_primera date;
  v_ultima date;
  v_servicio jsonb;
  v_asistente jsonb;
  v_citas jsonb;
  v_proxima jsonb;
  v_deuda numeric;
  v_puntos jsonb;
  v_referida_por jsonb;
  v_referidas int;
  v_conteos jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo la administración puede ver el perfil de una clienta' using errcode = '42501';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    return null;
  end if;

  select coalesce(sum(total), 0), count(*)
    into v_total_gastado, v_ventas
  from public.ventas
  where cliente_id = p_cliente_id and estado = 'ACTIVA';

  with dias as (
    select (fecha at time zone 'America/Lima')::date as dia
    from public.registro_servicios
    where cliente_id = p_cliente_id and estado <> 'CANCELADO'
    union
    select (fecha at time zone 'America/Lima')::date
    from public.ventas
    where cliente_id = p_cliente_id and estado = 'ACTIVA'
  )
  select count(*), min(dia), max(dia) into v_visitas, v_primera, v_ultima from dias;

  select jsonb_build_object('nombre', s.nombre, 'veces', count(*))
    into v_servicio
  from public.registro_servicios rs
  join public.servicios s on s.id = rs.servicio_id
  where rs.cliente_id = p_cliente_id and rs.estado <> 'CANCELADO'
  group by s.id, s.nombre
  order by count(*) desc, max(rs.fecha) desc
  limit 1;

  select jsonb_build_object('nombre', u.nombre_completo, 'veces', count(*))
    into v_asistente
  from public.registro_servicios rs
  join public.usuarios u on u.id = rs.usuario_id
  where rs.cliente_id = p_cliente_id and rs.estado <> 'CANCELADO'
  group by u.id, u.nombre_completo
  order by count(*) desc, max(rs.fecha) desc
  limit 1;

  select jsonb_build_object(
           'total', count(*),
           'completadas', count(*) filter (where estado = 'COMPLETADA'),
           'canceladas', count(*) filter (where estado = 'CANCELADA'),
           'no_asistio', count(*) filter (where estado = 'NO_ASISTIO'),
           'pendientes', count(*) filter (where estado not in ('COMPLETADA', 'CANCELADA', 'NO_ASISTIO')))
    into v_citas
  from public.citas
  where cliente_id = p_cliente_id;

  select jsonb_build_object('id', c.id, 'fecha_hora', c.fecha_hora, 'estado', c.estado, 'asistente', a.nombres_completos)
    into v_proxima
  from public.citas c
  left join public.asistentes a on a.id = c.asistente_id
  where c.cliente_id = p_cliente_id
    and c.fecha_hora >= now()
    and c.estado not in ('COMPLETADA', 'CANCELADA', 'NO_ASISTIO')
  order by c.fecha_hora
  limit 1;

  select coalesce(sum(greatest(d.monto - coalesce(p.pagado, 0), 0)), 0)
    into v_deuda
  from public.deudas d
  left join (
    select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id
  ) p on p.deuda_id = d.id
  where d.cliente_id = p_cliente_id and d.estado = 'PENDIENTE';

  select jsonb_build_object('monedas', s.monedas, 'clasificacion', s.clasificacion, 'nivel', s.nivel, 'sellos', s.sellos)
    into v_puntos
  from public.recompensas_saldos(p_cliente_id) s;

  select jsonb_build_object('id', r.id, 'nombre', r.nombre)
    into v_referida_por
  from public.clientes c
  join public.clientes r on r.id = c.referido_por
  where c.id = p_cliente_id;

  select count(*) into v_referidas from public.clientes where referido_por = p_cliente_id;

  select jsonb_build_object(
    'servicios', (select count(distinct servicio_id) from public.registro_servicios
                  where cliente_id = p_cliente_id and estado <> 'CANCELADO'),
    'productos', (select count(distinct vi.producto_id) from public.venta_items vi
                  join public.ventas v on v.id = vi.venta_id
                  where v.cliente_id = p_cliente_id and v.estado = 'ACTIVA' and vi.tipo = 'PRODUCTO'),
    'movimientos_puntos', (select count(*) from public.recompensas_movimientos where cliente_id = p_cliente_id)
                        + (select count(*) from public.recompensas_sellos_movs where cliente_id = p_cliente_id),
    'deudas', (select count(*) from public.deudas where cliente_id = p_cliente_id),
    'cupones', (select count(*) from public.cupones where cliente_id = p_cliente_id),
    'resenas', (select count(*) from public.resenas where cliente_id = p_cliente_id)
             + (select count(*) from public.resenas_servicio where cliente_id = p_cliente_id)
             + (select count(*) from public.resenas_producto where cliente_id = p_cliente_id),
    'pedidos', (select count(*) from public.pedidos_web where cliente_id = p_cliente_id)
  ) into v_conteos;

  return jsonb_build_object(
    'total_gastado', v_total_gastado,
    'ventas', v_ventas,
    'ticket_promedio', case when v_ventas > 0 then round(v_total_gastado / v_ventas, 2) else 0 end,
    'visitas', v_visitas,
    'primera_visita', v_primera,
    'ultima_visita', v_ultima,
    'dias_desde_ultima', case when v_ultima is null then null
                              else (now() at time zone 'America/Lima')::date - v_ultima end,
    'servicio_frecuente', v_servicio,
    'asistente_favorita', v_asistente,
    'citas', v_citas,
    'proxima_cita', v_proxima,
    'deuda_pendiente', v_deuda,
    'puntos', v_puntos,
    'referida_por', v_referida_por,
    'referidas', v_referidas,
    'conteos', v_conteos
  );
end;
$$;

revoke execute on function public.perfil_cliente_resumen(uuid) from public;
grant execute on function public.perfil_cliente_resumen(uuid) to authenticated;

-- 3. Visitas por día --------------------------------------------------------------------------------------------
create or replace function public.visitas_cliente(p_cliente_id uuid, p_limite int default 20, p_desde int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo la administración puede ver el perfil de una clienta' using errcode = '42501';
  end if;

  with dias as (
    select (fecha at time zone 'America/Lima')::date as dia
    from public.registro_servicios
    where cliente_id = p_cliente_id and estado <> 'CANCELADO'
    union
    select (fecha at time zone 'America/Lima')::date
    from public.ventas
    where cliente_id = p_cliente_id and estado = 'ACTIVA'
  ), pagina as (
    select dia from dias order by dia desc
    limit least(greatest(coalesce(p_limite, 20), 1), 100) offset greatest(coalesce(p_desde, 0), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'dia', p.dia,
    'servicios', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rs.id,
               'nombre', s.nombre,
               'asistente', u.nombre_completo,
               'precio', rs.precio,
               'estado', rs.estado,
               'nota', rs.nota,
               'hora', rs.fecha,
               'cobrado', rs.venta_id is not null
             ) order by rs.fecha), '[]'::jsonb)
      from public.registro_servicios rs
      join public.servicios s on s.id = rs.servicio_id
      left join public.usuarios u on u.id = rs.usuario_id
      where rs.cliente_id = p_cliente_id
        and (rs.fecha at time zone 'America/Lima')::date = p.dia
    ),
    'ventas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id,
               'codigo', v.codigo,
               'hora', v.fecha,
               'total', v.total,
               'metodo_pago', v.metodo_pago,
               'estado', v.estado,
               'descuento_pct', v.descuento_pct,
               'descuento_monto', v.descuento_monto,
               'cupon', cu.codigo,
               'vendedor', uv.nombre_completo,
               'productos', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'nombre', vi.nombre, 'cantidad', vi.cantidad, 'subtotal', vi.subtotal
                        ) order by vi.nombre), '[]'::jsonb)
                 from public.venta_items vi
                 where vi.venta_id = v.id and vi.tipo = 'PRODUCTO'
               )
             ) order by v.fecha), '[]'::jsonb)
      from public.ventas v
      left join public.cupones cu on cu.id = v.cupon_id
      left join public.usuarios uv on uv.id = v.vendedor_id
      where v.cliente_id = p_cliente_id
        and (v.fecha at time zone 'America/Lima')::date = p.dia
    ),
    'total_pagado', (
      select coalesce(sum(v.total), 0)
      from public.ventas v
      where v.cliente_id = p_cliente_id and v.estado = 'ACTIVA'
        and (v.fecha at time zone 'America/Lima')::date = p.dia
    )
  ) order by p.dia desc), '[]'::jsonb)
  into v_resultado
  from pagina p;

  return v_resultado;
end;
$$;

revoke execute on function public.visitas_cliente(uuid, int, int) from public;
grant execute on function public.visitas_cliente(uuid, int, int) to authenticated;

-- 4. Resúmenes por servicio y por producto ----------------------------------------------------------------------
create or replace function public.servicios_cliente_resumen(p_cliente_id uuid)
returns table (
  servicio_id uuid,
  nombre text,
  veces int,
  primera timestamptz,
  ultima timestamptz,
  precio_promedio numeric,
  total numeric,
  asistente_frecuente text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administración puede ver el perfil de una clienta' using errcode = '42501';
  end if;

  return query
  select s.id,
         s.nombre,
         count(*)::int,
         min(rs.fecha),
         max(rs.fecha),
         round(avg(rs.precio), 2),
         coalesce(sum(rs.precio), 0),
         mode() within group (order by u.nombre_completo)
  from public.registro_servicios rs
  join public.servicios s on s.id = rs.servicio_id
  left join public.usuarios u on u.id = rs.usuario_id
  where rs.cliente_id = p_cliente_id and rs.estado <> 'CANCELADO'
  group by s.id, s.nombre
  order by count(*) desc, max(rs.fecha) desc;
end;
$$;

revoke execute on function public.servicios_cliente_resumen(uuid) from public;
grant execute on function public.servicios_cliente_resumen(uuid) to authenticated;

create or replace function public.productos_cliente_resumen(p_cliente_id uuid)
returns table (
  producto_id uuid,
  nombre text,
  veces int,
  unidades int,
  ultima timestamptz,
  total numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administración puede ver el perfil de una clienta' using errcode = '42501';
  end if;

  return query
  select vi.producto_id,
         coalesce(max(p.nombre), max(vi.nombre)),
         count(distinct v.id)::int,
         coalesce(sum(vi.cantidad), 0)::int,
         max(v.fecha),
         coalesce(sum(vi.subtotal), 0)
  from public.venta_items vi
  join public.ventas v on v.id = vi.venta_id
  left join public.productos p on p.id = vi.producto_id
  where v.cliente_id = p_cliente_id and v.estado = 'ACTIVA' and vi.tipo = 'PRODUCTO'
  group by vi.producto_id
  order by count(distinct v.id) desc, max(v.fecha) desc;
end;
$$;

revoke execute on function public.productos_cliente_resumen(uuid) from public;
grant execute on function public.productos_cliente_resumen(uuid) to authenticated;

-- Índices para las búsquedas por clienta que hace el perfil. Revisado en Local: estas tablas no tenían ninguno que
-- empezara por `cliente_id` (deudas, cupones y recompensas sí lo tienen), así que cada perfil recorría la tabla entera.
create index if not exists idx_registro_servicios_cliente_fecha on public.registro_servicios (cliente_id, fecha desc);
create index if not exists idx_ventas_cliente_fecha on public.ventas (cliente_id, fecha desc);
create index if not exists idx_citas_cliente_fecha on public.citas (cliente_id, fecha_hora desc);
create index if not exists idx_pedidos_web_cliente_fecha on public.pedidos_web (cliente_id, creado_en desc);
create index if not exists idx_clientes_referido_por on public.clientes (referido_por) where referido_por is not null;

commit;
