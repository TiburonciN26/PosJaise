-- =========================================================
-- Recompensas — costeo DETALLADO de cada servicio y producto (receta de costos por líneas).
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Por qué: la dueña quiere saber con precisión, a largo plazo, si gana o pierde dinero con cada servicio y producto y con el
-- programa de puntos. Los campos genéricos «materiales» y «otros» no alcanzan: hay que poder detallar insumo por insumo.
--
-- Qué agrega (todo solo ADMINISTRADOR, RLS + funciones con comprobación es_admin()):
--   * servicios_costos_detalle: una fila por línea de costo de un servicio (cantidad x costo unitario). Categorías:
--       INSUMO, DESCARTABLE, HERRAMIENTA (desgaste por uso)  → suman a «materiales» del piso del cupón;
--       TARJETA_POS, OTRO                                    → suman a «otros» del piso;
--       LOCAL (tiempo/uso del local)                         → INFORMATIVO: no entra al piso, solo al margen real.
--     La mano de obra NO se escribe aquí: sale de la comisión real de la asistente (migración 20261124000001).
--   * productos_costos_detalle: líneas de costo por UNIDAD de un producto (TRANSPORTE, EMPAQUE, TARJETA_POS, OTRO). El costo de
--     compra sigue leyéndose de productos.costo (no se duplica).
--   * guardar_costeo_servicio / guardar_costeo_producto: reemplazan las líneas y sincronizan los totales en
--     servicios_proteccion / productos_proteccion EN LA MISMA TRANSACCIÓN (las funciones de protección y de venta no cambian de
--     contrato: siguen leyendo materiales/otros y transporte/otros). Los totales se redondean hacia ARRIBA al centavo.
--   * quitar_costeo_servicio / quitar_costeo_producto: dejan el elemento «sin configurar» (borra líneas y la fila de protección).
--   * almacen_costos_sugeridos(): último costo por unidad de compra de cada artículo del almacén (solo sugerencia editable).
--   * recompensas_proteccion_servicio / _producto: devuelven además 'desglose' (monto por categoría). Como confirmar_venta ya
--     guarda esa protección por línea en recompensas_venta_detalle.proteccion, cada venta conserva la FOTO del costo de ese
--     momento: cambiar una receta mañana no reescribe el historial.
-- No cambia ninguna venta, comisión ni dato existente.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Servicios: líneas de costo
-- ---------------------------------------------------------
create table public.servicios_costos_detalle (
  id                  uuid primary key default gen_random_uuid(),
  servicio_id         uuid not null references public.servicios (id) on delete cascade,
  categoria           text not null check (categoria in ('INSUMO', 'DESCARTABLE', 'HERRAMIENTA', 'TARJETA_POS', 'OTRO', 'LOCAL')),
  descripcion         text not null check (btrim(descripcion) <> '' and length(descripcion) <= 120),
  almacen_articulo_id uuid references public.almacen_articulos (id) on delete set null,
  cantidad            numeric(12, 4) not null check (cantidad > 0),
  unidad              text check (unidad is null or length(unidad) <= 30),
  costo_unitario      numeric(12, 4) not null check (costo_unitario >= 0),
  subtotal            numeric(16, 6) generated always as (cantidad * costo_unitario) stored,
  orden               int not null default 0,
  actualizado_en      timestamptz not null default now()
);
create index servicios_costos_detalle_servicio_idx on public.servicios_costos_detalle (servicio_id, orden);

alter table public.servicios_costos_detalle enable row level security;
revoke all on public.servicios_costos_detalle from anon, authenticated;
grant select, insert, update, delete on public.servicios_costos_detalle to authenticated;
create policy servicios_costos_detalle_admin on public.servicios_costos_detalle
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------
-- 2. Productos: líneas de costo por unidad
-- ---------------------------------------------------------
create table public.productos_costos_detalle (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid not null references public.productos (id) on delete cascade,
  categoria      text not null check (categoria in ('TRANSPORTE', 'EMPAQUE', 'TARJETA_POS', 'OTRO')),
  descripcion    text not null check (btrim(descripcion) <> '' and length(descripcion) <= 120),
  monto          numeric(12, 4) not null check (monto >= 0),   -- S/ por UNIDAD vendida
  orden          int not null default 0,
  actualizado_en timestamptz not null default now()
);
create index productos_costos_detalle_producto_idx on public.productos_costos_detalle (producto_id, orden);

alter table public.productos_costos_detalle enable row level security;
revoke all on public.productos_costos_detalle from anon, authenticated;
grant select, insert, update, delete on public.productos_costos_detalle to authenticated;
create policy productos_costos_detalle_admin on public.productos_costos_detalle
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------
-- 3. Guardar / quitar (atómico; solo ADMINISTRADOR)
-- ---------------------------------------------------------
create or replace function public.guardar_costeo_servicio(p_servicio_id uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l jsonb;
  v_i int := 0;
  v_cat text;
  v_desc text;
  v_cant numeric;
  v_cu numeric;
  v_art uuid;
  v_mat numeric;
  v_otros numeric;
  v_local numeric;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede guardar el costeo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.servicios where id = p_servicio_id) then
    raise exception 'El servicio no existe.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de costo no son válidas.';
  end if;
  if jsonb_array_length(p_lineas) > 60 then
    raise exception 'Máximo 60 líneas de costo por servicio.';
  end if;

  delete from public.servicios_costos_detalle where servicio_id = p_servicio_id;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_i := v_i + 1;
    v_cat := v_l ->> 'categoria';
    v_desc := btrim(coalesce(v_l ->> 'descripcion', ''));
    begin
      v_cant := (v_l ->> 'cantidad')::numeric;
      v_cu := (v_l ->> 'costo_unitario')::numeric;
    exception when others then
      raise exception 'Línea %: la cantidad o el costo no son números válidos.', v_i;
    end;
    if v_cat is null or v_cat not in ('INSUMO', 'DESCARTABLE', 'HERRAMIENTA', 'TARJETA_POS', 'OTRO', 'LOCAL') then
      raise exception 'Línea %: categoría no válida.', v_i;
    end if;
    if v_desc = '' or length(v_desc) > 120 then
      raise exception 'Línea %: escribe una descripción (hasta 120 caracteres).', v_i;
    end if;
    if v_cant is null or v_cant <= 0 or v_cant > 100000 then
      raise exception 'Línea %: la cantidad debe ser mayor a 0.', v_i;
    end if;
    if v_cu is null or v_cu < 0 or v_cu > 1000000 then
      raise exception 'Línea %: el costo unitario no es válido.', v_i;
    end if;
    v_art := null;
    if nullif(v_l ->> 'almacen_articulo_id', '') is not null then
      select id into v_art from public.almacen_articulos where id = (v_l ->> 'almacen_articulo_id')::uuid;
    end if;
    insert into public.servicios_costos_detalle
      (servicio_id, categoria, descripcion, almacen_articulo_id, cantidad, unidad, costo_unitario, orden)
    values
      (p_servicio_id, v_cat, v_desc, v_art, v_cant, nullif(btrim(coalesce(v_l ->> 'unidad', '')), ''), v_cu, v_i);
  end loop;

  select ceil(coalesce(sum(subtotal) filter (where categoria in ('INSUMO', 'DESCARTABLE', 'HERRAMIENTA')), 0) * 100) / 100,
         ceil(coalesce(sum(subtotal) filter (where categoria in ('TARJETA_POS', 'OTRO')), 0) * 100) / 100,
         ceil(coalesce(sum(subtotal) filter (where categoria = 'LOCAL'), 0) * 100) / 100
    into v_mat, v_otros, v_local
  from public.servicios_costos_detalle where servicio_id = p_servicio_id;

  -- Fila presente = configurado (aunque todo sea 0: decisión explícita). La estimación antigua de asistente no se usa
  -- (la mano de obra sale de la comisión real); en una fila nueva queda en 0 y en una existente no se toca.
  insert into public.servicios_proteccion (servicio_id, materiales, otros, asistente_pct)
  values (p_servicio_id, v_mat, v_otros, 0)
  on conflict (servicio_id) do update
    set materiales = excluded.materiales, otros = excluded.otros, actualizado_en = now();

  return jsonb_build_object('materiales', v_mat, 'otros', v_otros, 'local', v_local, 'lineas', v_i);
end;
$$;
revoke execute on function public.guardar_costeo_servicio(uuid, jsonb) from public, anon;
grant execute on function public.guardar_costeo_servicio(uuid, jsonb) to authenticated;

create or replace function public.quitar_costeo_servicio(p_servicio_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede quitar el costeo.' using errcode = '42501';
  end if;
  delete from public.servicios_costos_detalle where servicio_id = p_servicio_id;
  delete from public.servicios_proteccion where servicio_id = p_servicio_id;
end;
$$;
revoke execute on function public.quitar_costeo_servicio(uuid) from public, anon;
grant execute on function public.quitar_costeo_servicio(uuid) to authenticated;

create or replace function public.guardar_costeo_producto(p_producto_id uuid, p_lineas jsonb, p_costo_confirmado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l jsonb;
  v_i int := 0;
  v_cat text;
  v_desc text;
  v_monto numeric;
  v_transporte numeric;
  v_otros numeric;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede guardar el costeo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'El producto no existe.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de costo no son válidas.';
  end if;
  if jsonb_array_length(p_lineas) > 40 then
    raise exception 'Máximo 40 líneas de costo por producto.';
  end if;

  delete from public.productos_costos_detalle where producto_id = p_producto_id;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_i := v_i + 1;
    v_cat := v_l ->> 'categoria';
    v_desc := btrim(coalesce(v_l ->> 'descripcion', ''));
    begin
      v_monto := (v_l ->> 'monto')::numeric;
    exception when others then
      raise exception 'Línea %: el monto no es un número válido.', v_i;
    end;
    if v_cat is null or v_cat not in ('TRANSPORTE', 'EMPAQUE', 'TARJETA_POS', 'OTRO') then
      raise exception 'Línea %: categoría no válida.', v_i;
    end if;
    if v_desc = '' or length(v_desc) > 120 then
      raise exception 'Línea %: escribe una descripción (hasta 120 caracteres).', v_i;
    end if;
    if v_monto is null or v_monto < 0 or v_monto > 1000000 then
      raise exception 'Línea %: el monto no es válido.', v_i;
    end if;
    insert into public.productos_costos_detalle (producto_id, categoria, descripcion, monto, orden)
    values (p_producto_id, v_cat, v_desc, v_monto, v_i);
  end loop;

  select ceil(coalesce(sum(monto) filter (where categoria = 'TRANSPORTE'), 0) * 100) / 100,
         ceil(coalesce(sum(monto) filter (where categoria <> 'TRANSPORTE'), 0) * 100) / 100
    into v_transporte, v_otros
  from public.productos_costos_detalle where producto_id = p_producto_id;

  insert into public.productos_proteccion (producto_id, transporte, otros, costo_confirmado)
  values (p_producto_id, v_transporte, v_otros, coalesce(p_costo_confirmado, false))
  on conflict (producto_id) do update
    set transporte = excluded.transporte, otros = excluded.otros,
        costo_confirmado = excluded.costo_confirmado, actualizado_en = now();

  return jsonb_build_object('transporte', v_transporte, 'otros', v_otros, 'lineas', v_i);
end;
$$;
revoke execute on function public.guardar_costeo_producto(uuid, jsonb, boolean) from public, anon;
grant execute on function public.guardar_costeo_producto(uuid, jsonb, boolean) to authenticated;

create or replace function public.quitar_costeo_producto(p_producto_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede quitar el costeo.' using errcode = '42501';
  end if;
  delete from public.productos_costos_detalle where producto_id = p_producto_id;
  delete from public.productos_proteccion where producto_id = p_producto_id;
end;
$$;
revoke execute on function public.quitar_costeo_producto(uuid) from public, anon;
grant execute on function public.quitar_costeo_producto(uuid) to authenticated;

-- ---------------------------------------------------------
-- 4. Sugerencia de costo unitario desde el almacén (solo lectura; el valor se edita en la línea)
-- ---------------------------------------------------------
create or replace function public.almacen_costos_sugeridos()
returns table (articulo_id uuid, nombre text, unidad text, costo_unitario numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.nombre, a.unidad,
         (select round(m.costo_total / nullif(m.cantidad, 0), 4)
            from public.almacen_movimientos m
           where m.articulo_id = a.id and m.tipo = 'INGRESO' and m.costo_total is not null and m.cantidad > 0
           order by m.fecha desc limit 1)
  from public.almacen_articulos a
  where public.es_admin() and a.activo
  order by a.nombre;
$$;
revoke execute on function public.almacen_costos_sugeridos() from public, anon;
grant execute on function public.almacen_costos_sugeridos() to authenticated;

-- ---------------------------------------------------------
-- 5. Funciones de protección con desglose (la foto que conserva cada venta)
-- ---------------------------------------------------------
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
  v_asis numeric;
  v_modo text;
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

  -- 1 y 2: la atención que se está vendiendo.
  if p_registro_servicio_id is not null then
    select rs.pago_asistente, rs.precio, rs.usuario_id, u.rol into v_rs
    from public.registro_servicios rs
    left join public.usuarios u on u.id = rs.usuario_id
    where rs.id = p_registro_servicio_id and rs.servicio_id = p_servicio_id;
    if found then
      if v_rs.rol = 'ADMINISTRADOR' then
        v_asis := 0;
        v_modo := 'DUENA';
      else
        -- El disparador de comisión (calcular_comision_registro_servicio) vuelve a calcular el pago con el % VIGENTE al
        -- marcar la atención como vendida; el piso usa ese mismo importe para coincidir con lo que realmente se paga.
        select p.porcentaje into v_pct_vigente
        from public.porcentajes p
        join public.asistentes a on a.id = p.asistente_id
        where a.usuario_id = v_rs.usuario_id and p.servicio_id = p_servicio_id;
        if v_pct_vigente is not null then
          v_asis := round(v_rs.precio * v_pct_vigente / 100, 2);
          v_modo := 'COMISION_REAL';
        elsif v_rs.pago_asistente is not null then
          v_asis := v_rs.pago_asistente;
          v_modo := 'COMISION_REAL';
        end if;
      end if;
    end if;
  end if;

  -- 3: sin atención conocida, el % más alto entre las asistentes activas con porcentaje para este servicio.
  if v_asis is null then
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
    end if;
  end if;

  -- 4 y 5: la protección antigua (estimación) solo como último recurso.
  if v_asis is null then
    if v_p.asistente_pct is not null then
      v_modo := 'PORCENTAJE';
      v_asis := ceil(p_precio * v_p.asistente_pct) / 100;
    else
      v_modo := 'IMPORTE_FIJO';
      v_asis := v_p.asistente;
    end if;
  end if;

  -- Desglose por categoría de la receta (INSUMO, DESCARTABLE, HERRAMIENTA, TARJETA_POS, OTRO y LOCAL). LOCAL es informativo:
  -- no entra en el piso. Queda guardado con la venta para saber, a largo plazo, en qué se fue el costo.
  select jsonb_object_agg(x.categoria, x.monto) into v_desglose
  from (select categoria, ceil(sum(subtotal) * 100) / 100 as monto
        from public.servicios_costos_detalle where servicio_id = p_servicio_id group by categoria) x;

  return jsonb_build_object('modo', v_modo, 'configurada', true,
    'materiales', v_p.materiales, 'asistente_pct', v_p.asistente_pct, 'asistente', v_asis,
    'otros', v_p.otros, 'precio', p_precio, 'total', v_p.materiales + v_asis + v_p.otros,
    'registro_servicio_id', p_registro_servicio_id, 'desglose', coalesce(v_desglose, '{}'::jsonb));
end;
$$;
revoke execute on function public.recompensas_proteccion_servicio(uuid, numeric, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompensas_proteccion_producto(p_producto_id uuid, p_cantidad integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_costo numeric;
  v_transporte numeric := 0;
  v_otros numeric := 0;
  v_conf boolean := false;
  v_conocido boolean;
  v_unit numeric;
  v_desglose jsonb;
begin
  select costo into v_costo from public.productos where id = p_producto_id;
  select transporte, otros, costo_confirmado into v_transporte, v_otros, v_conf
  from public.productos_proteccion where producto_id = p_producto_id;
  v_transporte := coalesce(v_transporte, 0);
  v_otros := coalesce(v_otros, 0);
  v_conf := coalesce(v_conf, false);
  v_conocido := v_costo is not null and (v_costo > 0 or v_conf);
  if not v_conocido then
    return jsonb_build_object('modo', 'COSTO', 'costo_conocido', false, 'cantidad', p_cantidad);
  end if;
  v_unit := v_costo + v_transporte + v_otros;
  -- Desglose por categoría (por unidad): TRANSPORTE, EMPAQUE, TARJETA_POS y OTRO.
  select jsonb_object_agg(x.categoria, x.monto) into v_desglose
  from (select categoria, ceil(sum(monto) * 100) / 100 as monto
        from public.productos_costos_detalle where producto_id = p_producto_id group by categoria) x;
  return jsonb_build_object('modo', 'COSTO', 'costo_conocido', true, 'costo', v_costo,
    'transporte', v_transporte, 'otros', v_otros, 'unitaria', v_unit,
    'cantidad', p_cantidad, 'total', v_unit * p_cantidad, 'desglose', coalesce(v_desglose, '{}'::jsonb));
end;
$function$;
revoke execute on function public.recompensas_proteccion_producto(uuid, int) from public, anon, authenticated;

commit;
