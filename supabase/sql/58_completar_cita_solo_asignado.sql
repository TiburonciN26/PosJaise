-- =========================================================
-- POS Negocio 2 — Solo la persona asignada completa su cita
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 56_rol_cajera_asistente.sql ya se haya corrido.
--
-- 56_ dejó ver/agendar/cancelar/reasignar abierto a cajera y asistente
-- por igual (correcto: cualquiera arma la agenda). Pero completar una
-- cita crea un registro_servicios a nombre de quien la completa — eso
-- SÍ tiene que quedar restringido a la persona asignada, para no violar
-- "nadie escribe en el cuaderno de otro" (ni siquiera un admin puede
-- completar una cita que está asignada a otra persona, y viceversa).
-- =========================================================

begin;

create or replace function public.completar_cita(
  p_cita_id     uuid,
  p_items       jsonb,
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

commit;
