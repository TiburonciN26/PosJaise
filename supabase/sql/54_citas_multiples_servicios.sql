-- =========================================================
-- POS Negocio 2 — Citas con múltiples servicios
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 47_citas.sql ya se haya corrido.
--
-- Antes una cita tenía un solo servicio_id/duracion_min en la propia
-- fila. Ahora una cita puede agendar varios servicios (ej. corte +
-- tinte) — se mueven a una tabla hija, cita_servicios, mismo patrón
-- que venta_items en 03_rls.sql (hereda visibilidad de su padre).
--
-- completar_cita() se reescribe para completar TODOS los servicios de
-- la cita a la vez (decisión explícita: no completar de a uno) — recibe
-- un array de {cita_servicio_id, precio} y crea un registro_servicios
-- por cada uno, en un solo paso atómico, igual que antes pero para N
-- líneas en vez de 1.
-- =========================================================

begin;

create table public.cita_servicios (
  id                    uuid primary key default gen_random_uuid(),
  cita_id               uuid not null references public.citas (id) on delete cascade,
  servicio_id           uuid references public.servicios (id) on delete set null,
  duracion_min          int not null default 30,
  registro_servicio_id  uuid references public.registro_servicios (id) on delete set null,
  created_at            timestamptz not null default now()
);

create index idx_cita_servicios_cita_id on public.cita_servicios (cita_id);

alter table public.cita_servicios enable row level security;

grant select, insert, update, delete on public.cita_servicios to authenticated;

create policy cita_servicios_select on public.cita_servicios
  for select to authenticated
  using (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and (
          public.es_admin()
          or c.asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
        )
    )
  );

create policy cita_servicios_insert on public.cita_servicios
  for insert to authenticated
  with check (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and (
          public.es_admin()
          or c.asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
        )
    )
  );

create policy cita_servicios_update on public.cita_servicios
  for update to authenticated
  using (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and (
          public.es_admin()
          or c.asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and (
          public.es_admin()
          or c.asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
        )
    )
  );

create policy cita_servicios_delete on public.cita_servicios
  for delete to authenticated
  using (
    exists (
      select 1 from public.citas c
      where c.id = cita_servicios.cita_id
        and (
          public.es_admin()
          or c.asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
        )
    )
  );

-- Migra cada cita existente (servicio_id/duracion_min en la propia fila)
-- a su primera línea en cita_servicios, sin perder el registro_servicio_id
-- ya vinculado si la cita estaba completada.
insert into public.cita_servicios (cita_id, servicio_id, duracion_min, registro_servicio_id)
select id, servicio_id, duracion_min, registro_servicio_id
from public.citas
where servicio_id is not null;

alter table public.citas
  drop column servicio_id,
  drop column duracion_min,
  drop column registro_servicio_id;

-- ---------------------------------------------------------
-- completar_cita(): ahora recibe un array de líneas (una por cada
-- servicio de la cita) en vez de un solo servicio/precio. Crea un
-- registro_servicios por línea y liga cada una a su cita_servicios.
-- ---------------------------------------------------------
drop function if exists public.completar_cita(uuid, uuid, uuid, numeric, timestamptz, text);

create or replace function public.completar_cita(
  p_cita_id     uuid,
  p_items       jsonb, -- [{ "cita_servicio_id": uuid, "precio": numeric }, ...]
  p_cliente_id  uuid,
  p_fecha       timestamptz,
  p_nota        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita          record;
  v_item          jsonb;
  v_cita_servicio_id uuid;
  v_servicio_id   uuid;
  v_precio        numeric;
  v_registro_id   uuid;
  v_ids           jsonb := '[]'::jsonb;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null then
    raise exception 'La cita no existe';
  end if;

  if not public.es_admin()
     and v_cita.asistente_id not in (select id from public.asistentes where usuario_id = auth.uid()) then
    raise exception 'No tienes permiso sobre esta cita';
  end if;

  if v_cita.estado in ('COMPLETADA', 'CANCELADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La cita no tiene servicios para completar';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cita_servicio_id := (v_item->>'cita_servicio_id')::uuid;
    v_precio := (v_item->>'precio')::numeric;

    if v_precio is null or v_precio < 0 then
      raise exception 'Precio inválido';
    end if;

    select servicio_id into v_servicio_id
    from public.cita_servicios
    where id = v_cita_servicio_id and cita_id = p_cita_id
    for update;

    if not found then
      raise exception 'Servicio de la cita no encontrado';
    end if;

    insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio, fecha, nota)
    values (auth.uid(), v_servicio_id, p_cliente_id, v_precio, coalesce(p_fecha, v_cita.fecha_hora), p_nota)
    returning id into v_registro_id;

    update public.cita_servicios
    set registro_servicio_id = v_registro_id
    where id = v_cita_servicio_id;

    v_ids := v_ids || to_jsonb(v_registro_id);
  end loop;

  update public.citas
  set estado = 'COMPLETADA'
  where id = p_cita_id;

  return v_ids;
end;
$$;

grant execute on function public.completar_cita(uuid, jsonb, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------
-- Descripción legible en Auditoría: citas ya no tiene servicio_id en
-- su propia fila, así que la descripción queda solo con el cliente
-- (se redefine completa, mismo motivo que en migraciones anteriores).
-- ---------------------------------------------------------
create or replace function public.descripcion_de_fila(p_tabla text, p_fila jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado text;
begin
  if p_tabla = 'registro_servicios' then
    select s.nombre into v_resultado
    from public.servicios s
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Atención');
  end if;

  if p_tabla = 'porcentajes' then
    select s.nombre || ' — ' || a.nombres_completos into v_resultado
    from public.servicios s
    join public.asistentes a on a.id = (p_fila->>'asistente_id')::uuid
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Porcentaje');
  end if;

  if p_tabla = 'estado_negocio' then
    return 'Negocio';
  end if;

  if p_tabla = 'citas' then
    select c.nombre into v_resultado
    from public.clientes c
    where c.id = (p_fila->>'cliente_id')::uuid;
    return coalesce(v_resultado, 'Cita');
  end if;

  return coalesce(
    p_fila->>'nombre', p_fila->>'nombres_completos', p_fila->>'nombre_completo',
    p_fila->>'codigo', p_fila->>'id'
  );
end;
$$;

commit;
