-- =========================================================
-- POS Negocio 2 — Pestaña Web: Citas desde la Web
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 74_horario_atencion.sql ya se haya corrido.
--
-- Un cliente puede: ver sus propias citas, agendar una nueva (eligiendo
-- servicio(s) + asistente específico + horario libre), cancelarla o
-- reprogramarla — siempre con al menos 3 horas de anticipación, y
-- siempre re-validando el hueco en el SERVIDOR (nunca confiando en lo
-- que ya calculó el navegador, para no permitir dos citas pisadas por
-- una condición de carrera).
--
-- No hay "cualquier asistente disponible": el cliente elige uno
-- específico — decisión a propósito, ver implementacionesWed.md §2.3,
-- para no tener que resolver auto-asignación en esta primera versión.
--
-- citas.creado_por era NOT NULL apuntando a usuarios (personal) — un
-- cliente Web no tiene fila ahí. Se agrega una columna paralela, mismo
-- patrón que cliente_id/cliente_nombre_referencia que ya conviven en
-- esta misma tabla (60_citas_cliente_referencia.sql).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. citas: autoría desde la Web
-- ---------------------------------------------------------
alter table public.citas alter column creado_por drop not null;

alter table public.citas
  add column if not exists creado_por_cliente_web_id uuid
    references public.clientes_web (id) on delete set null;

alter table public.citas drop constraint if exists citas_creado_por_check;
alter table public.citas add constraint citas_creado_por_check
  check (creado_por is not null or creado_por_cliente_web_id is not null);

-- ---------------------------------------------------------
-- 2. RLS: el cliente lee SUS propias citas. Política nueva, aparte de
-- la de staff (56_rol_cajera_asistente.sql) — RLS permisiva: basta con
-- que UNA policy autorice, así que esto no le quita nada al personal.
-- Nunca hay policy de INSERT/UPDATE para CLIENTE: todo pasa por las RPC
-- de abajo (security definer, evitan RLS por completo).
-- ---------------------------------------------------------
create policy citas_select_propio_web on public.citas
  for select to authenticated
  using (
    cliente_id in (select id from public.clientes where cliente_web_id = auth.uid())
  );

create policy cita_servicios_select_propio_web on public.cita_servicios
  for select to authenticated
  using (
    exists (
      select 1
      from public.citas c
      join public.clientes cl on cl.id = c.cliente_id
      where c.id = cita_servicios.cita_id
        and cl.cliente_web_id = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 3. Horarios disponibles: calcula huecos libres de un asistente en un
-- día dado para una duración total (suma de los servicios elegidos).
-- Reglas: respeta horario_atencion() (días que atiende + los 2 bloques
-- del día — el servicio tiene que caber DENTRO de un bloque, no puede
-- empezar en el bloque 1 y terminar en el 2, cruzando el descanso), no
-- se pisa con ninguna cita ya agendada de ese asistente ese día
-- (cualquier estado salvo CANCELADA), y no ofrece horarios ya pasados.
-- p_excluir_cita_id: al reprogramar, la cita que se está moviendo no
-- debe contar como "ocupando" su propio horario viejo.
-- ---------------------------------------------------------
create or replace function public.horarios_disponibles_cita(
  p_asistente_id   uuid,
  p_fecha          date,
  p_duracion_min   int,
  p_excluir_cita_id uuid default null
)
returns table (inicio timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias         int[];
  v_b1_inicio    time;
  v_b1_fin       time;
  v_b2_inicio    time;
  v_b2_fin       time;
  v_paso         constant int := 15;
begin
  if p_asistente_id is null then
    raise exception 'Falta el asistente';
  end if;

  if p_duracion_min is null or p_duracion_min <= 0 then
    raise exception 'Duración inválida';
  end if;

  select dias_atencion, bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin
  into v_dias, v_b1_inicio, v_b1_fin, v_b2_inicio, v_b2_fin
  from public.estado_negocio
  where id = 1;

  if v_dias is null or not (extract(isodow from p_fecha)::int = any(v_dias)) then
    return;
  end if;

  return query
  with bloques(inicio, fin) as (
    values (v_b1_inicio, v_b1_fin), (v_b2_inicio, v_b2_fin)
  ),
  candidatos as (
    -- p_fecha + b.inicio da un timestamp "naive" (sin zona) — "at time
    -- zone 'America/Lima'" lo interpreta como hora de pared de Lima y
    -- recién ahí lo convierte a timestamptz real. Sin esto, el resultado
    -- dependería de la zona horaria de sesión de Postgres (normalmente
    -- UTC), corriendo los horarios ~5 horas — mismo bug que ya se
    -- corrigió una vez en es_hoy() (12_fix_zona_horaria_es_hoy.sql).
    select
      (((p_fecha + b.inicio) at time zone 'America/Lima')
        + (n * v_paso || ' minutes')::interval) as inicio
    from bloques b
    cross join lateral generate_series(
      0,
      greatest(
        0,
        floor((extract(epoch from (b.fin - b.inicio)) / 60 - p_duracion_min) / v_paso)
      )::int
    ) as n
    where b.inicio is not null and b.fin is not null
  ),
  ocupados as (
    select
      c.fecha_hora as inicio,
      c.fecha_hora + (coalesce(sum(cs.duracion_min), 30) || ' minutes')::interval as fin
    from public.citas c
    left join public.cita_servicios cs on cs.cita_id = c.id
    where c.asistente_id = p_asistente_id
      and c.estado <> 'CANCELADA'
      -- mismo motivo: sacar el día calendario de un timestamptz también
      -- depende de la zona horaria de sesión si no se fija a Lima.
      and (c.fecha_hora at time zone 'America/Lima')::date = p_fecha
      and (p_excluir_cita_id is null or c.id <> p_excluir_cita_id)
    group by c.id, c.fecha_hora
  )
  select cand.inicio
  from candidatos cand
  where cand.inicio > now()
    and not exists (
      select 1 from ocupados o
      where cand.inicio < o.fin
        and o.inicio < cand.inicio + (p_duracion_min || ' minutes')::interval
    )
  order by cand.inicio;
end;
$$;

grant execute on function public.horarios_disponibles_cita(uuid, date, int, uuid) to authenticated;
revoke execute on function public.horarios_disponibles_cita(uuid, date, int, uuid) from public;

-- ---------------------------------------------------------
-- 4. Agendar cita — valida todo en el servidor: que el cliente ya tenga
-- perfil vinculado, que el asistente exista y esté disponible para
-- citas (mismo criterio que asistentes_para_citas()), que la fecha sea
-- futura, y que el horario pedido siga realmente libre (recalcula
-- horarios_disponibles_cita en el momento — si otra persona agendó ese
-- mismo hueco un segundo antes, esto lo rechaza).
-- ---------------------------------------------------------
create or replace function public.agendar_cita_web(
  p_asistente_id  uuid,
  p_fecha_hora    timestamptz,
  p_servicio_ids  uuid[],
  p_nota          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id      uuid;
  v_cita_id         uuid;
  v_duracion_total  int;
  v_disponible      boolean;
  v_servicio_id     uuid;
  v_duracion        int;
  v_precio          numeric;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de agendar una cita';
  end if;

  if p_servicio_ids is null or array_length(p_servicio_ids, 1) is null then
    raise exception 'Elige al menos un servicio';
  end if;

  if not exists (
    select 1 from public.asistentes a
    where a.id = p_asistente_id
      and a.activo = true
      and (
        a.usuario_id is null
        or exists (select 1 from public.usuarios u where u.id = a.usuario_id and u.rol <> 'CAJERA')
      )
  ) then
    raise exception 'Ese asistente no está disponible';
  end if;

  if p_fecha_hora is null or p_fecha_hora <= now() then
    raise exception 'La fecha debe ser futura';
  end if;

  select coalesce(sum(duracion_min), 0) into v_duracion_total
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_duracion_total = 0 then
    raise exception 'Servicio inválido';
  end if;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      p_asistente_id, (p_fecha_hora at time zone 'America/Lima')::date, v_duracion_total
    ) h
    where h.inicio = p_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  insert into public.citas (
    cliente_id, asistente_id, creado_por, creado_por_cliente_web_id, fecha_hora, nota, estado
  )
  values (
    v_cliente_id, p_asistente_id, null, auth.uid(), p_fecha_hora, p_nota, 'PENDIENTE'
  )
  returning id into v_cita_id;

  foreach v_servicio_id in array p_servicio_ids loop
    select duracion_min, precio into v_duracion, v_precio
    from public.servicios
    where id = v_servicio_id and activo = true;

    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (v_cita_id, v_servicio_id, coalesce(v_duracion, 30), v_precio);
  end loop;

  return v_cita_id;
end;
$$;

grant execute on function public.agendar_cita_web(uuid, timestamptz, uuid[], text) to authenticated;
revoke execute on function public.agendar_cita_web(uuid, timestamptz, uuid[], text) from public;

-- ---------------------------------------------------------
-- 5. Cancelar mi cita — solo la propia, solo si todavía no pasó (menos
-- 3 horas de anticipación) y no está ya cerrada.
-- ---------------------------------------------------------
create or replace function public.cancelar_mi_cita_web(p_cita_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid;
  v_cita       record;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'No tienes un perfil vinculado';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null or v_cita.cliente_id is distinct from v_cliente_id then
    raise exception 'Esa cita no existe o no te pertenece';
  end if;

  if v_cita.estado in ('CANCELADA', 'COMPLETADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if v_cita.fecha_hora - now() < interval '3 hours' then
    raise exception 'Ya no puedes cancelar esta cita — comunícate directamente con el negocio.';
  end if;

  update public.citas set estado = 'CANCELADA' where id = p_cita_id;
end;
$$;

grant execute on function public.cancelar_mi_cita_web(uuid) to authenticated;
revoke execute on function public.cancelar_mi_cita_web(uuid) from public;

-- ---------------------------------------------------------
-- 6. Reprogramar mi cita — mismo servicio y asistente, nueva fecha/hora.
-- Mismas reglas de anticipación que cancelar, más la revalidación de
-- hueco libre (excluyendo la propia cita del chequeo de choques).
-- ---------------------------------------------------------
create or replace function public.reprogramar_mi_cita_web(
  p_cita_id         uuid,
  p_nueva_fecha_hora timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id     uuid;
  v_cita           record;
  v_duracion_total int;
  v_disponible     boolean;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'No tienes un perfil vinculado';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null or v_cita.cliente_id is distinct from v_cliente_id then
    raise exception 'Esa cita no existe o no te pertenece';
  end if;

  if v_cita.estado in ('CANCELADA', 'COMPLETADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if v_cita.fecha_hora - now() < interval '3 hours' then
    raise exception 'Ya no puedes reprogramar esta cita — comunícate directamente con el negocio.';
  end if;

  if p_nueva_fecha_hora is null or p_nueva_fecha_hora <= now() then
    raise exception 'La nueva fecha debe ser futura';
  end if;

  select coalesce(sum(duracion_min), 30) into v_duracion_total
  from public.cita_servicios
  where cita_id = p_cita_id;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      v_cita.asistente_id,
      (p_nueva_fecha_hora at time zone 'America/Lima')::date,
      v_duracion_total,
      p_cita_id
    ) h
    where h.inicio = p_nueva_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  update public.citas set fecha_hora = p_nueva_fecha_hora where id = p_cita_id;
end;
$$;

grant execute on function public.reprogramar_mi_cita_web(uuid, timestamptz) to authenticated;
revoke execute on function public.reprogramar_mi_cita_web(uuid, timestamptz) from public;

commit;
