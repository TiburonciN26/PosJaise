-- =========================================================
-- POS Negocio 2 — QA-004: guardar cita (crear/editar) en un solo paso atómico
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 125_reprogramar_cita_web_completa.sql ya se haya corrido
-- (mismo patrón delete+insert de cita_servicios, acá para el lado POS).
--
-- Bug reproducido (QA-004): ModalCita.jsx guardaba una edición en tres
-- llamadas HTTP separadas — UPDATE citas, luego DELETE cita_servicios,
-- luego INSERT cita_servicios. Si la página se recargaba o la red se
-- cortaba entre el DELETE y el INSERT (ej. justo después de "Guardar
-- cambios"), la cita quedaba persistida sin ningún servicio adentro:
-- el DELETE ya se había confirmado en el servidor, el INSERT nunca
-- llegó. Mismo patrón de bug que ya se corrigió una vez en
-- 59_cita_servicios_rls_abierta.sql (ahí por RLS, acá por falta de
-- atomicidad entre llamadas).
--
-- Fix: una función server-side que hace UPDATE/INSERT de citas +
-- DELETE/INSERT de cita_servicios dentro de la misma transacción de
-- Postgres. Si el cliente se desconecta a mitad de camino, la función
-- entera se revierte — no hay forma de persistir el DELETE sin su
-- INSERT correspondiente. No cambia reglas de negocio: mismos campos,
-- mismos roles (rol_actual() is not null, igual que las políticas RLS
-- vigentes de citas/cita_servicios), precio/duración por línea siguen
-- siendo editables en POS (a diferencia de reprogramar_mi_cita_web, que
-- re-calcula del catálogo — acá eso no se toca).
-- =========================================================

begin;

create or replace function public.guardar_cita_pos(
  p_cita_id                   uuid,
  p_cliente_id                uuid,
  p_cliente_nombre_referencia text,
  p_asistente_id              uuid,
  p_fecha_hora                timestamptz,
  p_nota                      text,
  p_adelanto                  numeric,
  p_servicios                 jsonb -- [{ "servicio_id": uuid, "duracion_min": int, "precio": numeric }, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita_id  uuid;
  v_item     jsonb;
  v_duracion int;
  v_precio   numeric;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if p_servicios is null or jsonb_array_length(p_servicios) = 0 then
    raise exception 'Agrega al menos un servicio.';
  end if;

  for v_item in select * from jsonb_array_elements(p_servicios)
  loop
    v_duracion := (v_item->>'duracion_min')::int;
    v_precio := (v_item->>'precio')::numeric;
    if (v_item->>'servicio_id') is null then
      raise exception 'Hay un servicio inválido en la cita.';
    end if;
    if v_duracion is null or v_duracion <= 0 then
      raise exception 'Hay una duración inválida en los servicios.';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'Hay un precio inválido en los servicios.';
    end if;
  end loop;

  if p_adelanto is not null and p_adelanto < 0 then
    raise exception 'El adelanto no es válido.';
  end if;

  if p_cita_id is not null then
    update public.citas
    set cliente_id                = p_cliente_id,
        cliente_nombre_referencia = p_cliente_nombre_referencia,
        asistente_id              = p_asistente_id,
        fecha_hora                = p_fecha_hora,
        nota                      = p_nota,
        adelanto                  = p_adelanto
    where id = p_cita_id;

    if not found then
      raise exception 'La cita no existe';
    end if;

    v_cita_id := p_cita_id;

    delete from public.cita_servicios where cita_id = v_cita_id;
  else
    insert into public.citas (
      cliente_id, cliente_nombre_referencia, asistente_id,
      fecha_hora, nota, adelanto, creado_por
    )
    values (
      p_cliente_id, p_cliente_nombre_referencia, p_asistente_id,
      p_fecha_hora, p_nota, p_adelanto, auth.uid()
    )
    returning id into v_cita_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_servicios)
  loop
    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (
      v_cita_id,
      (v_item->>'servicio_id')::uuid,
      (v_item->>'duracion_min')::int,
      (v_item->>'precio')::numeric
    );
  end loop;

  return v_cita_id;
end;
$$;

grant execute on function public.guardar_cita_pos(
  uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb
) to authenticated;
revoke execute on function public.guardar_cita_pos(
  uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb
) from public;

commit;
