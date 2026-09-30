-- =========================================================
-- POS Negocio 2 — Pestaña Web: reprogramar cita completa (servicios +
-- asistente + fecha/hora + nota)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 75_citas_web.sql ya se haya corrido.
--
-- A pedido del usuario: el botón "Reprogramar" del portal cliente no
-- solo debía permitir cambiar fecha/hora — también agregar/quitar
-- servicios (y, ya puestos, también cambiar de asistente). La función
-- reprogramar_mi_cita_web(uuid, timestamptz) de 75_citas_web.sql solo
-- cambiaba fecha_hora; se reemplaza por una versión con más parámetros
-- (misma firma de "editar toda la cita" que agendar_cita_web usa para
-- crearla) — se DROPea la vieja para no dejar dos funciones con el
-- mismo nombre y distinta firma conviviendo.
--
-- Decisiones confirmadas con el usuario (AskUserQuestion):
-- - Se puede cambiar cualquier campo: servicios, asistente, fecha/hora
--   y nota — no solo la fecha.
-- - El precio de cada servicio de la cita se actualiza al precio
--   ACTUAL del catálogo al guardar (mismo criterio que
--   agendar_cita_web) — no queda congelado al precio con el que se
--   agendó originalmente.
--
-- cita_servicios se reemplaza entero (DELETE + INSERT) en vez de un
-- diff fila por fila: más simple, y sus ids no se referencian desde
-- ningún otro lado sensible por fuera de (cita_id, servicio_id) — ver
-- guardar_mi_resena_servicio()/resenas_servicio (116_resenas_servicio.sql),
-- que solo mira cita_id/servicio_id/estado, nunca cita_servicios.id.
-- Solo puede pasar esto si la cita AÚN NO está COMPLETADA (validado
-- abajo, igual que ya lo hacía la función vieja), así que nunca se
-- pisa el historial de una cita ya cerrada.
-- =========================================================

begin;

drop function if exists public.reprogramar_mi_cita_web(uuid, timestamptz);

create or replace function public.reprogramar_mi_cita_web(
  p_cita_id          uuid,
  p_asistente_id     uuid,
  p_nueva_fecha_hora timestamptz,
  p_servicio_ids     uuid[],
  p_nota             text default null
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
  v_servicio_id    uuid;
  v_duracion       int;
  v_precio         numeric;
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

  select coalesce(sum(duracion_min), 0) into v_duracion_total
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_duracion_total = 0 then
    raise exception 'Servicio inválido';
  end if;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      p_asistente_id,
      (p_nueva_fecha_hora at time zone 'America/Lima')::date,
      v_duracion_total,
      p_cita_id
    ) h
    where h.inicio = p_nueva_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  update public.citas
  set asistente_id = p_asistente_id,
      fecha_hora    = p_nueva_fecha_hora,
      nota          = p_nota
  where id = p_cita_id;

  delete from public.cita_servicios where cita_id = p_cita_id;

  foreach v_servicio_id in array p_servicio_ids loop
    select duracion_min, precio into v_duracion, v_precio
    from public.servicios
    where id = v_servicio_id and activo = true;

    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (p_cita_id, v_servicio_id, coalesce(v_duracion, 30), v_precio);
  end loop;
end;
$$;

grant execute on function public.reprogramar_mi_cita_web(uuid, uuid, timestamptz, uuid[], text) to authenticated;
revoke execute on function public.reprogramar_mi_cita_web(uuid, uuid, timestamptz, uuid[], text) from public;

commit;
