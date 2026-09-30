-- =========================================================
-- Migración 10/10 del rediseño de Servicios/Detalle: reseñas POR
-- SERVICIO en el Detalle ("Lo que dicen nuestras clientas").
-- Ejecutar en Supabase → SQL Editor → New query
--
-- NO se reutiliza ni se modifica `resenas` (86_resenas.sql): esa tabla
-- tiene `unique (cliente_id)` — una sola reseña general por clienta de
-- por vida, para el muro de Nosotros (resenas_publicas()) y "Mis
-- reseñas" (MisResenasCliente.jsx). Forzar servicio_id ahí habría
-- significado tocar esa unicidad y arriesgar esa función ya en
-- producción. En vez de eso, tabla y RPCs propias, mismo patrón de
-- moderación (PENDIENTE → admin aprueba/rechaza) y mismas RPCs
-- security definer para escribir/leer (guardar_mi_resena() / mi_resena()
-- / resenas_publicas() de esa migración).
--
-- Regla de quién puede reseñar (pendiente en el README): SOLO clientas
-- con una cita COMPLETADA que incluyó ese servicio — se valida DENTRO de
-- guardar_mi_resena_servicio(), no confiando en el cliente.
-- =========================================================

begin;

create table public.resenas_servicio (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  servicio_id    uuid not null references public.servicios(id) on delete cascade,
  calificacion   int not null check (calificacion between 1 and 5),
  comentario     text,
  estado         text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, servicio_id)
);

create index resenas_servicio_servicio_id_idx on public.resenas_servicio (servicio_id);

alter table public.resenas_servicio enable row level security;

grant select, update on public.resenas_servicio to authenticated;

create policy resenas_servicio_select on public.resenas_servicio
  for select to authenticated
  using (cliente_id = public.mi_cliente_id() or estado = 'APROBADA' or public.es_admin());

create policy resenas_servicio_update_admin on public.resenas_servicio
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- Sin policy de INSERT a propósito: se escribe solo vía
-- guardar_mi_resena_servicio() (security definer), que valida que la
-- clienta de verdad se hizo ese servicio antes de dejarla reseñar.
create or replace function public.guardar_mi_resena_servicio(
  p_servicio_id  uuid,
  p_calificacion int,
  p_comentario   text
)
returns public.resenas_servicio
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid := public.mi_cliente_id();
  v_fila public.resenas_servicio;
begin
  if v_cliente_id is null then
    raise exception 'Solo clientas registradas pueden reseñar.';
  end if;

  if not exists (
    select 1
    from public.cita_servicios cs
    join public.citas c on c.id = cs.cita_id
    where cs.servicio_id = p_servicio_id
      and c.cliente_id = v_cliente_id
      and c.estado = 'COMPLETADA'
  ) then
    raise exception 'Solo pueden reseñar las clientas que ya se hicieron este servicio.';
  end if;

  insert into public.resenas_servicio (cliente_id, servicio_id, calificacion, comentario, estado, actualizado_en)
  values (v_cliente_id, p_servicio_id, p_calificacion, p_comentario, 'PENDIENTE', now())
  on conflict (cliente_id, servicio_id)
  do update set
    calificacion = excluded.calificacion,
    comentario = excluded.comentario,
    estado = 'PENDIENTE',
    actualizado_en = now()
  returning * into v_fila;

  return v_fila;
end;
$$;

grant execute on function public.guardar_mi_resena_servicio(uuid, int, text) to authenticated;
revoke execute on function public.guardar_mi_resena_servicio(uuid, int, text) from public;

-- Mi propia reseña de un servicio puntual (para prellenar el formulario
-- si ya reseñó, o mostrar "en revisión" mientras no está APROBADA).
create or replace function public.mi_resena_servicio(p_servicio_id uuid)
returns public.resenas_servicio
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.resenas_servicio
  where servicio_id = p_servicio_id and cliente_id = public.mi_cliente_id();
$$;

grant execute on function public.mi_resena_servicio(uuid) to authenticated;
revoke execute on function public.mi_resena_servicio(uuid) from public;

-- Lista pública (APROBADA) de un servicio, para las 3 tarjetas del
-- Detalle — mismo shape que resenas_publicas().
create or replace function public.resenas_servicio_publicas(p_servicio_id uuid)
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
  select rs.id, c.nombre, rs.calificacion, rs.comentario, rs.creado_en
  from public.resenas_servicio rs
  join public.clientes c on c.id = rs.cliente_id
  where rs.servicio_id = p_servicio_id
    and rs.estado = 'APROBADA'
  order by rs.creado_en desc;
$$;

grant execute on function public.resenas_servicio_publicas(uuid) to authenticated;
revoke execute on function public.resenas_servicio_publicas(uuid) from public;

-- Resumen (promedio + distribución 5→1) para el bloque grande de la
-- izquierda del Detalle.
create or replace function public.resenas_servicio_resumen(p_servicio_id uuid)
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
  from public.resenas_servicio
  where servicio_id = p_servicio_id and estado = 'APROBADA';
$$;

grant execute on function public.resenas_servicio_resumen(uuid) to authenticated;
revoke execute on function public.resenas_servicio_resumen(uuid) from public;

commit;
