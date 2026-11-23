-- =========================================================
-- Citas: (1) marcar en las tarjetas las citas con servicios sin comisión y (2) poder completar una cita aunque algún
--        servicio no tenga % — quedando ese servicio como nota pendiente en Mi Panel, igual que un registro manual.
--
-- (1) citas_sin_comision(p_cita_ids)
--   Devuelve los ids (de los pedidos) de las citas ACTIVAS (pendiente/confirmada) con asistente que tienen al menos un
--   servicio sin % de comisión para esa asistente. Es la versión «por lote» de servicios_con_comision() (20261121000002):
--   las tarjetas del calendario la usan para mostrar la cápsula «Sin comisión» sin una consulta por cita.
--   Mismo criterio que servicios_con_comision: una ficha de ADMINISTRADOR siempre tiene comisión (100 %) y «tener %» es
--   una fila en `porcentajes` con porcentaje no nulo. Security definer por la misma razón: la RLS de porcentajes deja a cada
--   asistente ver solo sus filas, y aquí hace falta saber QUÉ servicios tienen % (nunca el valor) de otras asistentes.
--
-- (2) completar_cita(): item.permitir_pendiente
--   Antes, completar una cita con un servicio sin % fallaba en el trigger («Sin % asignado — no se puede completar»), así
--   que si la administradora no había asignado la comisión la cita quedaba PENDIENTE/CONFIRMADA en el calendario aunque ya
--   se hubiera atendido. Ahora cada ítem puede traer "permitir_pendiente": true: si ESE servicio no tiene % para quien
--   completa, su registro se guarda como PENDIENTE_PORCENTAJE (una nota que no cuenta en ningún total hasta que la admin
--   asigne el % y la asistente la confirme desde Mi Panel) y la cita pasa a COMPLETADA igual. Los servicios que sí tienen
--   % se registran ACTIVO como siempre; un ítem sin el indicador sigue fallando como antes, así que ningún cliente viejo
--   cambia de comportamiento por accidente.
--   La firma NO cambia (el indicador viaja dentro de p_items) para no tocar los permisos de la función.
--   El criterio de «tiene %» repite el del trigger calcular_comision_registro_servicio (rol de la cuenta ADMINISTRADOR, o
--   porcentaje de la ficha vinculada a auth.uid()).
-- =========================================================

begin;

create or replace function public.citas_sin_comision(p_cita_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if public.rol_actual() is null or public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA', 'ASISTENTE') then
    raise exception 'No tienes permiso para consultar esto' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct c.id), '{}'::uuid[]) into v_ids
  from public.citas c
  join public.cita_servicios cs on cs.cita_id = c.id
  where c.id = any (coalesce(p_cita_ids, '{}'::uuid[]))
    and c.asistente_id is not null
    and c.estado in ('PENDIENTE', 'CONFIRMADA')
    and cs.servicio_id is not null
    and not exists (
      select 1
      from public.asistentes a
      join public.usuarios u on u.id = a.usuario_id
      where a.id = c.asistente_id and u.rol = 'ADMINISTRADOR'
    )
    and not exists (
      select 1
      from public.porcentajes p
      where p.asistente_id = c.asistente_id
        and p.servicio_id = cs.servicio_id
        and p.porcentaje is not null
    );

  return v_ids;
end;
$$;

revoke execute on function public.citas_sin_comision(uuid[]) from public, anon;
grant execute on function public.citas_sin_comision(uuid[]) to authenticated;

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
  v_estado        text;
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

  -- Quién cobra la comisión: la cuenta que completa (auth.uid()), igual que el trigger de registro_servicios.
  select exists (select 1 from public.usuarios where id = auth.uid() and rol = 'ADMINISTRADOR') into v_es_admin;
  select id into v_asistente_id from public.asistentes where usuario_id = auth.uid() limit 1;

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

    v_tiene_pct := v_es_admin or exists (
      select 1 from public.porcentajes p
      where p.servicio_id = v_servicio_id
        and p.asistente_id = v_asistente_id
        and p.porcentaje is not null
    );

    -- Sin % y con permiso explícito: queda como nota pendiente (el trigger no la rechaza y no cuenta en ningún total).
    v_estado := case
      when not v_tiene_pct and coalesce((v_item->>'permitir_pendiente')::boolean, false) then 'PENDIENTE_PORCENTAJE'
      else 'ACTIVO'
    end;

    insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio, fecha, nota, estado)
    values (auth.uid(), v_servicio_id, p_cliente_id, v_precio, coalesce(p_fecha, v_cita.fecha_hora), p_nota, v_estado)
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

commit;
