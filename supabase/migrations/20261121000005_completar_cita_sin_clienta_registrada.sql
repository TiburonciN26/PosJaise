-- =========================================================
-- Citas: completar una cita cuya clienta es solo un nombre de referencia (sin ficha en Clientes)
--
-- Al AGENDAR se puede escribir cualquier nombre como «referencia, sin guardar» (citas.cliente_nombre_referencia). Pero al
-- COMPLETAR, el modal exigía una clienta registrada y rechazaba la cita: una atención ya hecha se quedaba como cita incompleta
-- en el calendario hasta que la administradora creara la ficha.
--
-- Mismo criterio que «servicios sin comisión» (20261121000003): se puede completar igual y la atención queda como NOTA
-- PENDIENTE en Mi Panel (estado PENDIENTE_PORCENTAJE, la «nota» que ya existe: no cuenta en ningún total ni sale en Ventas)
-- hasta que alguien la asigne a una clienta registrada. Cuando además falta el %, la nota espera las dos cosas.
--
-- PIEZAS:
--   1. registro_servicios.cliente_nombre_referencia: el nombre que se escribió al agendar, para que la nota diga de QUIÉN es.
--   2. completar_cita(): si no hay clienta registrada (ni elegida en el modal ni en la cita) la atención se guarda como nota
--      pendiente con ese nombre. Exige el indicador explícito "permitir_pendiente" en cada ítem (igual que los servicios sin %),
--      así un cliente viejo o un clic distraído no crean notas sin querer. La firma NO cambia.
--   3. confirmar_atencion_pendiente(): una nota con clienta pendiente de registrar no se puede confirmar (pasaría a ACTIVO y a
--      «atenciones a cobrar» sin clienta).
--   4. asignar_cliente_atencion_pendiente(): la dueña de la nota o la administradora la asigna a una clienta registrada. Se
--      aplica a TODA la cita (todas sus notas sin clienta y la propia cita), para que se resuelva de una vez y el historial de la
--      clienta incluya esa cita. Es security definer porque la RLS de registro_servicios solo deja a la dueña tocar atenciones
--      de HOY y a la administradora no le deja tocar notas pendientes.
--      Crear la ficha sigue siendo solo de la administradora (clientes_insert_admin): esta función solo ASIGNA una existente.
-- =========================================================

begin;

alter table public.registro_servicios
  add column if not exists cliente_nombre_referencia text null;

create or replace function public.completar_cita(
  p_cita_id uuid,
  p_items jsonb,
  p_cliente_id uuid,
  p_fecha timestamp with time zone,
  p_nota text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cita          record;
  v_item          jsonb;
  v_cita_servicio_id uuid;
  v_servicio_id   uuid;
  v_precio        numeric;
  v_registro_id   uuid;
  v_ids           jsonb := '[]'::jsonb;
  v_es_admin      boolean;
  v_asistente_id  uuid;
  v_tiene_pct     boolean;
  v_permitir      boolean;
  v_estado        text;
  v_cliente_id    uuid;
  v_referencia    text;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null then
    raise exception 'La cita no existe';
  end if;

  if v_cita.asistente_id is null then
    raise exception 'Esta cita no tiene un profesional asignado — asígnala antes de completarla';
  end if;

  if v_cita.asistente_id not in (select id from public.asistentes where usuario_id = auth.uid()) then
    raise exception 'Solo la persona asignada puede completar esta cita';
  end if;

  if v_cita.estado in ('COMPLETADA', 'CANCELADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La cita no tiene servicios para completar';
  end if;

  -- Clienta: la elegida en el modal o, si no, la de la cita. Sin ninguna, solo queda el nombre de referencia.
  v_cliente_id := coalesce(p_cliente_id, v_cita.cliente_id);
  if v_cliente_id is null then
    v_referencia := nullif(btrim(coalesce(v_cita.cliente_nombre_referencia, '')), '');
    if v_referencia is null then
      raise exception 'La cita no tiene una clienta';
    end if;
  end if;

  -- Quién cobra la comisión: la cuenta que completa (auth.uid()), igual que el trigger de registro_servicios.
  select exists (select 1 from public.usuarios where id = auth.uid() and rol = 'ADMINISTRADOR') into v_es_admin;
  select id into v_asistente_id from public.asistentes where usuario_id = auth.uid() limit 1;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cita_servicio_id := (v_item->>'cita_servicio_id')::uuid;
    v_precio := (v_item->>'precio')::numeric;
    v_permitir := coalesce((v_item->>'permitir_pendiente')::boolean, false);

    if v_precio is null or v_precio < 0 then
      raise exception 'Precio inválido';
    end if;

    if v_cliente_id is null and not v_permitir then
      raise exception 'La clienta de esta cita no está registrada: regístrala o anota la atención como pendiente';
    end if;

    select servicio_id into v_servicio_id
    from public.cita_servicios
    where id = v_cita_servicio_id and cita_id = p_cita_id
    for update;

    if not found then
      raise exception 'Servicio de la cita no encontrado';
    end if;

    v_tiene_pct := v_es_admin or exists (
      select 1 from public.porcentajes p
      where p.servicio_id = v_servicio_id
        and p.asistente_id = v_asistente_id
        and p.porcentaje is not null
    );

    -- Nota pendiente cuando falta la clienta registrada, o el % (con permiso explícito). El trigger no rechaza una nota y no
    -- cuenta en ningún total hasta que se confirme.
    v_estado := case
      when v_cliente_id is null then 'PENDIENTE_PORCENTAJE'
      when not v_tiene_pct and v_permitir then 'PENDIENTE_PORCENTAJE'
      else 'ACTIVO'
    end;

    insert into public.registro_servicios
      (usuario_id, servicio_id, cliente_id, cliente_nombre_referencia, precio, fecha, nota, estado)
    values
      (auth.uid(), v_servicio_id, v_cliente_id, v_referencia, v_precio, coalesce(p_fecha, v_cita.fecha_hora), p_nota, v_estado)
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
$function$;

create or replace function public.confirmar_atencion_pendiente(p_registro_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_usuario    uuid;
  v_estado     text;
  v_cliente    uuid;
  v_referencia text;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida.' using errcode = '42501';
  end if;

  select usuario_id, estado, cliente_id, cliente_nombre_referencia
    into v_usuario, v_estado, v_cliente, v_referencia
  from public.registro_servicios
  where id = p_registro_id
  for update;

  if not found then
    raise exception 'La atención no existe.' using errcode = 'P0001';
  end if;
  if v_usuario is distinct from auth.uid() then
    raise exception 'Solo quien registró la atención puede confirmarla.' using errcode = 'P0001';
  end if;
  if v_estado <> 'PENDIENTE_PORCENTAJE' then
    raise exception 'Esta atención ya no está pendiente.' using errcode = 'P0001';
  end if;
  -- Una nota de una cita con clienta solo de referencia no pasa a «atenciones a cobrar» hasta tener una clienta registrada
  -- (las notas viejas sin clienta porque la ficha se borró no llevan nombre de referencia y no se bloquean).
  if v_cliente is null and v_referencia is not null then
    raise exception 'Falta asignar una clienta registrada a esta atención (%).', v_referencia using errcode = 'P0001';
  end if;

  -- El trigger calcula porcentaje_aplicado / pago_asistente con el % vigente, o lanza si aún no hay %.
  update public.registro_servicios set estado = 'ACTIVO' where id = p_registro_id;
end;
$function$;

create or replace function public.asignar_cliente_atencion_pendiente(p_registro_id uuid, p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_usuario uuid;
  v_estado  text;
  v_cliente uuid;
  v_cita_id uuid;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'La clienta elegida no existe.' using errcode = 'P0001';
  end if;

  select usuario_id, estado, cliente_id into v_usuario, v_estado, v_cliente
  from public.registro_servicios
  where id = p_registro_id
  for update;

  if not found then
    raise exception 'La atención no existe.' using errcode = 'P0001';
  end if;
  if v_usuario is distinct from auth.uid() and not public.es_admin() then
    raise exception 'Solo quien registró la atención o la administradora puede asignarle una clienta.' using errcode = 'P0001';
  end if;
  if v_estado <> 'PENDIENTE_PORCENTAJE' or v_cliente is not null then
    raise exception 'Esta atención no está esperando una clienta.' using errcode = 'P0001';
  end if;

  select cs.cita_id into v_cita_id
  from public.cita_servicios cs
  where cs.registro_servicio_id = p_registro_id
  limit 1;

  if v_cita_id is null then
    update public.registro_servicios
    set cliente_id = p_cliente_id, cliente_nombre_referencia = null
    where id = p_registro_id;
  else
    -- Toda la cita de una vez: sus otras notas sin clienta y la propia cita.
    update public.registro_servicios r
    set cliente_id = p_cliente_id, cliente_nombre_referencia = null
    where r.cliente_id is null
      and r.estado = 'PENDIENTE_PORCENTAJE'
      and r.id in (select cs.registro_servicio_id from public.cita_servicios cs where cs.cita_id = v_cita_id);

    update public.citas
    set cliente_id = p_cliente_id, cliente_nombre_referencia = null
    where id = v_cita_id and cliente_id is null;
  end if;
end;
$function$;

revoke execute on function public.asignar_cliente_atencion_pendiente(uuid, uuid) from public, anon;
grant execute on function public.asignar_cliente_atencion_pendiente(uuid, uuid) to authenticated;

commit;
