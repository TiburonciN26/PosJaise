-- Almacén POS: control de las cosas INTERNAS del negocio que no se venden (agua para las trabajadoras, papel, guantes,
-- productos de limpieza…). Parecido a Inventario, pero separado de «productos»: no tiene precio de venta, no aparece en
-- Ventas ni en la web, y lo que importa es quién sacó qué y cuándo.
--
-- REGLAS (pedido de la dueña, 2026-11-12):
--   * SALIDAS (p. ej. «se usó 1 agua»): TODO el personal (cualquier rol con fila activa en usuarios). Como en el resto del
--     POS, con el negocio cerrado solo la administradora puede registrar.
--   * INGRESOS (p. ej. «llegaron 10 aguas»), crear / editar / eliminar artículos: SOLO la administradora.
--   * Cada ingreso guarda su COSTO total. El costo y el historial de movimientos (quién, cuándo, cuánto) solo los ve la
--     administradora, igual que el historial de stock de Inventario. El resto del personal ve los artículos y su stock.
--
-- DISEÑO:
--   * almacen_articulos: el catálogo con el stock actual. almacen_movimientos: cada ingreso o salida, con el stock antes y
--     después, quién lo hizo y la fecha.
--   * TODA escritura pasa por funciones security definer (sin GRANT de insert/update/delete en las tablas): así el stock y el
--     historial no pueden quedar desalineados ni falsificarse desde la API, y el stock nunca baja de 0. Mismo criterio que
--     agregar_stock() / movimientos_stock (QA-035).
--   * El stock inicial de un artículo nuevo se registra como su primer INGRESO (con su costo), para que el historial y el
--     «gastado en el mes» cuadren desde el primer día.
--   * Eliminar: si el artículo ya tiene movimientos se DESACTIVA (no se pierde el historial); si no, se borra. Igual que
--     eliminar_producto(). Los inactivos solo los ve la administradora.
--   * Cambios del catálogo quedan en Auditoría con el trigger estándar registrar_auditoria().

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------------------------
create table public.almacen_articulos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (char_length(btrim(nombre)) between 1 and 80),
  categoria    text check (categoria is null or char_length(categoria) between 1 and 40),
  unidad       text not null default 'unidad' check (char_length(btrim(unidad)) between 1 and 20),
  stock_actual integer not null default 0 check (stock_actual >= 0),
  stock_minimo integer not null default 3 check (stock_minimo >= 0),  -- 3: la pestaña ya no lo pide (pedido de la dueña)
  activo       boolean not null default true,
  creado_por   uuid references public.usuarios (id) on delete set null,
  creado_en    timestamptz not null default now()
);

create unique index almacen_articulos_nombre_unico on public.almacen_articulos (lower(btrim(nombre)));

comment on table public.almacen_articulos is
  'Artículos de uso interno del negocio (no se venden). Escritura solo vía guardar_articulo_almacen() y los RPC de movimientos.';

create table public.almacen_movimientos (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null references public.almacen_articulos (id) on delete cascade,
  tipo           text not null check (tipo in ('INGRESO', 'SALIDA')),
  cantidad       integer not null check (cantidad > 0),
  stock_anterior integer not null,
  stock_nuevo    integer not null check (stock_nuevo >= 0),
  costo_total    numeric(10, 2) check (costo_total is null or costo_total >= 0),
  nota           text check (nota is null or char_length(nota) <= 200),
  usuario_id     uuid references public.usuarios (id) on delete set null,
  fecha          timestamptz not null default now(),
  constraint almacen_movimientos_costo_solo_ingreso check (tipo = 'INGRESO' or costo_total is null)
);

create index almacen_movimientos_articulo_fecha on public.almacen_movimientos (articulo_id, fecha desc);
create index almacen_movimientos_fecha on public.almacen_movimientos (fecha desc);

comment on table public.almacen_movimientos is
  'Ingresos y salidas del almacén interno. Solo los crean registrar_ingreso_almacen() / registrar_salida_almacen().';

alter table public.almacen_articulos enable row level security;
alter table public.almacen_movimientos enable row level security;

-- Artículos: el personal ve los activos; la administradora también los inactivos. Sin políticas de escritura.
create policy almacen_articulos_select on public.almacen_articulos for select to authenticated
  using (public.es_admin() or ((select public.rol_actual()) is not null and activo));

-- Se revoca todo primero (la base Local da privilegios por defecto; producción no) y se da solo SELECT: en producción,
-- sin este GRANT la lectura daría 403 aunque la RLS deje pasar.
revoke all on table public.almacen_articulos from public, anon, authenticated;
grant select on public.almacen_articulos to authenticated;

-- Vista que lee la pestaña: agrega stock_bajo / sin_stock (mismo criterio que productos_vista, 20261001000029: bajo =
-- quedan pocos pero no cero) para filtrar con .eq(), ya que PostgREST no compara dos columnas entre sí. No son columnas
-- de la tabla para que el trigger de auditoría no registre cada cambio de esos indicadores como ruido.
-- security_invoker: se aplica la RLS de almacen_articulos de quien consulta (el personal no ve los inactivos).
create view public.almacen_articulos_vista with (security_invoker = true) as
  select a.id, a.nombre, a.categoria, a.unidad, a.stock_actual, a.stock_minimo, a.activo, a.creado_en,
         (a.stock_actual > 0 and a.stock_actual <= a.stock_minimo) as stock_bajo,
         (a.stock_actual = 0) as sin_stock
  from public.almacen_articulos a;

revoke all on table public.almacen_articulos_vista from public, anon, authenticated;
grant select on public.almacen_articulos_vista to authenticated;

-- Movimientos: sin políticas ni GRANT. Se leen solo con historial_almacen_articulo() (administradora), porque traen el costo.
revoke all on table public.almacen_movimientos from public, anon, authenticated;

drop trigger if exists auditoria_almacen_articulos on public.almacen_articulos;
create trigger auditoria_almacen_articulos
  after insert or update or delete on public.almacen_articulos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Salida (todo el personal)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.registrar_salida_almacen(p_articulo_id uuid, p_cantidad integer, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_articulo public.almacen_articulos%rowtype;
  v_nuevo    integer;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida' using errcode = '42501';
  end if;
  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.' using errcode = 'P0001';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_nota, '')) > 200 then
    raise exception 'La nota no puede pasar de 200 caracteres.' using errcode = 'P0001';
  end if;

  select * into v_articulo from public.almacen_articulos where id = p_articulo_id for update;
  if not found or not v_articulo.activo then
    raise exception 'Ese artículo ya no está disponible en el almacén.' using errcode = 'P0001';
  end if;
  if v_articulo.stock_actual < p_cantidad then
    raise exception 'Solo quedan % % de «%».', v_articulo.stock_actual, v_articulo.unidad, v_articulo.nombre
      using errcode = 'P0001';
  end if;

  v_nuevo := v_articulo.stock_actual - p_cantidad;
  update public.almacen_articulos set stock_actual = v_nuevo where id = p_articulo_id;

  insert into public.almacen_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, nota, usuario_id)
  values (p_articulo_id, 'SALIDA', p_cantidad, v_articulo.stock_actual, v_nuevo, nullif(btrim(p_nota), ''), auth.uid());

  return v_nuevo;
end;
$$;

revoke execute on function public.registrar_salida_almacen(uuid, integer, text) from public, anon;
grant execute on function public.registrar_salida_almacen(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Ingreso (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.registrar_ingreso_almacen(
  p_articulo_id uuid,
  p_cantidad integer,
  p_costo numeric,
  p_nota text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_articulo public.almacen_articulos%rowtype;
  v_nuevo    integer;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede registrar ingresos al almacén.' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if p_costo is null or p_costo < 0 or p_costo >= 100000000 then
    raise exception 'Ingresa el costo total del ingreso (0 o más).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_nota, '')) > 200 then
    raise exception 'La nota no puede pasar de 200 caracteres.' using errcode = 'P0001';
  end if;

  select * into v_articulo from public.almacen_articulos where id = p_articulo_id for update;
  if not found then
    raise exception 'Ese artículo no existe.' using errcode = 'P0001';
  end if;

  v_nuevo := v_articulo.stock_actual + p_cantidad;
  update public.almacen_articulos set stock_actual = v_nuevo where id = p_articulo_id;

  insert into public.almacen_movimientos
    (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, costo_total, nota, usuario_id)
  values
    (p_articulo_id, 'INGRESO', p_cantidad, v_articulo.stock_actual, v_nuevo, round(p_costo, 2),
     nullif(btrim(p_nota), ''), auth.uid());

  return v_nuevo;
end;
$$;

revoke execute on function public.registrar_ingreso_almacen(uuid, integer, numeric, text) from public, anon;
grant execute on function public.registrar_ingreso_almacen(uuid, integer, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Crear / editar artículo (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
-- p_id null = artículo nuevo: p_stock_inicial > 0 se registra como primer INGRESO con p_costo_inicial (obligatorio entonces).
-- p_id con valor = edición: no toca el stock (eso solo cambia con ingresos y salidas); p_stock_inicial/p_costo_inicial se ignoran.
create or replace function public.guardar_articulo_almacen(
  p_id uuid,
  p_nombre text,
  p_categoria text,
  p_unidad text,
  p_stock_minimo integer,
  p_activo boolean,
  p_stock_inicial integer default 0,
  p_costo_inicial numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre    text := btrim(coalesce(p_nombre, ''));
  v_categoria text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_unidad    text := coalesce(nullif(btrim(coalesce(p_unidad, '')), ''), 'unidad');
  v_id        uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede crear o editar artículos del almacén.' using errcode = '42501';
  end if;
  if char_length(v_nombre) = 0 or char_length(v_nombre) > 80 then
    raise exception 'El nombre es obligatorio (máximo 80 caracteres).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_categoria, '')) > 40 then
    raise exception 'La categoría no puede pasar de 40 caracteres.' using errcode = 'P0001';
  end if;
  if char_length(v_unidad) > 20 then
    raise exception 'La unidad no puede pasar de 20 caracteres.' using errcode = 'P0001';
  end if;
  if p_stock_minimo is null or p_stock_minimo < 0 then
    raise exception 'El stock mínimo debe ser 0 o más.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.almacen_articulos
    where lower(btrim(nombre)) = lower(v_nombre) and id is distinct from p_id
  ) then
    raise exception 'Ya existe un artículo llamado «%».', v_nombre using errcode = 'P0001';
  end if;

  if p_id is null then
    if p_stock_inicial is null or p_stock_inicial < 0 then
      raise exception 'El stock inicial debe ser 0 o más.' using errcode = 'P0001';
    end if;

    insert into public.almacen_articulos (nombre, categoria, unidad, stock_minimo, activo, creado_por)
    values (v_nombre, v_categoria, v_unidad, p_stock_minimo, coalesce(p_activo, true), auth.uid())
    returning id into v_id;

    if p_stock_inicial > 0 then
      perform public.registrar_ingreso_almacen(v_id, p_stock_inicial, p_costo_inicial, 'Stock inicial');
    end if;
    return v_id;
  end if;

  update public.almacen_articulos
     set nombre = v_nombre, categoria = v_categoria, unidad = v_unidad, stock_minimo = p_stock_minimo,
         activo = coalesce(p_activo, activo)
   where id = p_id;
  if not found then
    raise exception 'Ese artículo no existe.' using errcode = 'P0001';
  end if;
  return p_id;
end;
$$;

revoke execute on function public.guardar_articulo_almacen(uuid, text, text, text, integer, boolean, integer, numeric)
  from public, anon;
grant execute on function public.guardar_articulo_almacen(uuid, text, text, text, integer, boolean, integer, numeric)
  to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Eliminar artículo (solo administradora): con movimientos se desactiva; sin movimientos se borra.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.eliminar_articulo_almacen(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede eliminar artículos del almacén.' using errcode = '42501';
  end if;

  if exists (select 1 from public.almacen_movimientos where articulo_id = p_id) then
    update public.almacen_articulos set activo = false where id = p_id;
    return 'DESACTIVADO';
  end if;

  delete from public.almacen_articulos where id = p_id;
  return 'ELIMINADO';
end;
$$;

revoke execute on function public.eliminar_articulo_almacen(uuid) from public, anon;
grant execute on function public.eliminar_articulo_almacen(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Lecturas
-- ---------------------------------------------------------------------------------------------------------------
-- Historial de un artículo (solo administradora): quién, cuándo, cuánto y a qué costo. Los últimos 300 movimientos.
create or replace function public.historial_almacen_articulo(p_articulo_id uuid)
returns table (
  fecha timestamptz,
  tipo text,
  cantidad integer,
  stock_anterior integer,
  stock_nuevo integer,
  costo_total numeric,
  nota text,
  usuario_nombre text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.fecha, m.tipo, m.cantidad, m.stock_anterior, m.stock_nuevo, m.costo_total, m.nota, u.nombre_completo
  from public.almacen_movimientos m
  left join public.usuarios u on u.id = m.usuario_id
  where public.es_admin() and m.articulo_id = p_articulo_id
  order by m.fecha desc
  limit 300;
$$;

revoke execute on function public.historial_almacen_articulo(uuid) from public, anon;
grant execute on function public.historial_almacen_articulo(uuid) to authenticated;

-- Resumen para las tarjetas de la pestaña. gastado_mes (ingresos del mes en curso, hora de Lima) solo para la
-- administradora; al resto le llega null. Cuenta solo artículos activos.
create or replace function public.resumen_almacen()
returns table (total integer, bajo_stock integer, sin_stock integer, gastado_mes numeric, categorias text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where a.activo)::integer,
    count(*) filter (where a.activo and a.stock_actual > 0 and a.stock_actual <= a.stock_minimo)::integer,
    count(*) filter (where a.activo and a.stock_actual = 0)::integer,
    case when public.es_admin() then (
      select coalesce(sum(m.costo_total), 0)
      from public.almacen_movimientos m
      where m.tipo = 'INGRESO'
        and m.fecha >= (date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima')
    ) end,
    coalesce(
      array_agg(distinct a.categoria order by a.categoria) filter (where a.categoria is not null),
      '{}'
    )
  from public.almacen_articulos a
  where public.rol_actual() is not null;
$$;

revoke execute on function public.resumen_almacen() from public, anon;
grant execute on function public.resumen_almacen() to authenticated;

commit;
