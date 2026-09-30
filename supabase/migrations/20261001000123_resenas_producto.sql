-- =========================================================
-- Migración 7/8 del rediseño de Productos/Detalle: reseñas POR PRODUCTO
-- en el Detalle ("Lo que dicen nuestras clientas") — mismo patrón que
-- 116_resenas_servicio.sql: tabla y RPCs propias (no se toca `resenas`,
-- que es una reseña general por clienta, unique(cliente_id)).
--
-- Regla de quién puede reseñar (decisión confirmada con el usuario):
-- SOLO clientas con un pedidos_web ENTREGADO que incluyó ese producto —
-- se valida DENTRO de guardar_mi_resena_producto(), no confiando en el
-- cliente. pedidos_web_items.producto_id puede quedar NULL si el
-- producto se borró después (on delete set null, ver
-- 85_carrito_pedidos_web.sql), así que esos pedidos nunca califican
-- para reseñar nada — comportamiento correcto, no hace falta un caso
-- especial.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

begin;

create table public.resenas_producto (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  producto_id    uuid not null references public.productos(id) on delete cascade,
  calificacion   int not null check (calificacion between 1 and 5),
  comentario     text,
  estado         text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, producto_id)
);

create index resenas_producto_producto_id_idx on public.resenas_producto (producto_id);

alter table public.resenas_producto enable row level security;

grant select, update on public.resenas_producto to authenticated;

create policy resenas_producto_select on public.resenas_producto
  for select to authenticated
  using (cliente_id = public.mi_cliente_id() or estado = 'APROBADA' or public.es_admin());

create policy resenas_producto_update_admin on public.resenas_producto
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- Sin policy de INSERT a propósito: se escribe solo vía
-- guardar_mi_resena_producto() (security definer), que valida la compra.
create or replace function public.guardar_mi_resena_producto(
  p_producto_id  uuid,
  p_calificacion int,
  p_comentario   text
)
returns public.resenas_producto
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid := public.mi_cliente_id();
  v_fila public.resenas_producto;
begin
  if v_cliente_id is null then
    raise exception 'Solo clientas registradas pueden reseñar.';
  end if;

  if not exists (
    select 1
    from public.pedidos_web_items i
    join public.pedidos_web p on p.id = i.pedido_id
    where i.producto_id = p_producto_id
      and p.cliente_id = v_cliente_id
      and p.estado = 'ENTREGADO'
  ) then
    raise exception 'Solo pueden reseñar las clientas que ya compraron este producto.';
  end if;

  insert into public.resenas_producto (cliente_id, producto_id, calificacion, comentario, estado, actualizado_en)
  values (v_cliente_id, p_producto_id, p_calificacion, p_comentario, 'PENDIENTE', now())
  on conflict (cliente_id, producto_id)
  do update set
    calificacion = excluded.calificacion,
    comentario = excluded.comentario,
    estado = 'PENDIENTE',
    actualizado_en = now()
  returning * into v_fila;

  return v_fila;
end;
$$;

grant execute on function public.guardar_mi_resena_producto(uuid, int, text) to authenticated;
revoke execute on function public.guardar_mi_resena_producto(uuid, int, text) from public;

-- Mi propia reseña de un producto puntual (prellenar el formulario o
-- mostrar "en revisión" mientras no está APROBADA).
create or replace function public.mi_resena_producto(p_producto_id uuid)
returns public.resenas_producto
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.resenas_producto
  where producto_id = p_producto_id and cliente_id = public.mi_cliente_id();
$$;

grant execute on function public.mi_resena_producto(uuid) to authenticated;
revoke execute on function public.mi_resena_producto(uuid) from public;

-- Lista pública (APROBADA) de un producto, para las 3 tarjetas del Detalle.
create or replace function public.resenas_producto_publicas(p_producto_id uuid)
returns table (
  id           uuid,
  nombre       text,
  calificacion int,
  comentario   text,
  creado_en    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rp.id, c.nombre, rp.calificacion, rp.comentario, rp.creado_en
  from public.resenas_producto rp
  join public.clientes c on c.id = rp.cliente_id
  where rp.producto_id = p_producto_id
    and rp.estado = 'APROBADA'
  order by rp.creado_en desc;
$$;

grant execute on function public.resenas_producto_publicas(uuid) to authenticated;
revoke execute on function public.resenas_producto_publicas(uuid) from public;

-- Resumen (promedio + distribución 5→1) para el bloque grande de la
-- izquierda del Detalle.
create or replace function public.resenas_producto_resumen(p_producto_id uuid)
returns table (
  total     bigint,
  promedio  numeric,
  cinco     bigint,
  cuatro    bigint,
  tres      bigint,
  dos       bigint,
  uno       bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*),
    coalesce(round(avg(calificacion), 1), 0),
    count(*) filter (where calificacion = 5),
    count(*) filter (where calificacion = 4),
    count(*) filter (where calificacion = 3),
    count(*) filter (where calificacion = 2),
    count(*) filter (where calificacion = 1)
  from public.resenas_producto
  where producto_id = p_producto_id and estado = 'APROBADA';
$$;

grant execute on function public.resenas_producto_resumen(uuid) to authenticated;
revoke execute on function public.resenas_producto_resumen(uuid) from public;

commit;
