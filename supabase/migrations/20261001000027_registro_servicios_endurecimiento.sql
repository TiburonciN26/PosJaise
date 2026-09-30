-- =========================================================
-- POS Negocio 2 — Fase 7c: endurecer registro_servicios (C2 + C4
-- de la auditoría técnica)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- C2 — la comisión se calculaba y escribía desde el navegador:
-- ModalRegistroAtencion.jsx mandaba porcentaje_aplicado y
-- pago_asistente ya calculados, y nada en el servidor los
-- verificaba — con su propio token, una asistente podía escribirse
-- cualquier valor (ej. pago_asistente: 500) vía la API de Supabase
-- directamente, sin pasar por la UI. Se agrega un trigger BEFORE
-- INSERT/UPDATE que recalcula ambos campos server-side a partir de
-- la tabla porcentajes, ignorando lo que mande el cliente para esas
-- dos columnas — mismo criterio que ya usa ModalRegistroAtencion.jsx
-- (100% si el dueño no tiene ficha de asistente).
--
-- C4 — nota: al revisar el estado actual, DELETE ya quedó
-- exclusivo del admin desde 23_registro_servicios_estado.sql (la
-- asistente ya solo puede "cancelar", no borrar) — ese hallazgo de
-- la auditoría ya estaba resuelto. Lo que seguía abierto era UPDATE:
-- una asistente podía editar (precio, fecha, servicio...) cualquier
-- registro propio sin límite de tiempo, incluyendo comisiones de
-- meses ya cerrados. Se restringe UPDATE al mismo día para
-- no-admins, mismo criterio que ya usa anular_venta() con
-- es_hoy().
-- =========================================================

begin;

-- ---------------------------------------------------------
-- C2: cálculo de comisión en el servidor
-- ---------------------------------------------------------
create or replace function public.calcular_comision_registro_servicio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asistente_id uuid;
  v_porcentaje numeric(5, 2);
begin
  select id into v_asistente_id
  from public.asistentes
  where usuario_id = NEW.usuario_id;

  if v_asistente_id is null then
    -- Dueño sin ficha de asistente (el admin registrando lo suyo): se
    -- queda con el 100%, igual que en ModalRegistroAtencion.jsx.
    NEW.porcentaje_aplicado := 100;
    NEW.pago_asistente := NEW.precio;
    return NEW;
  end if;

  select porcentaje into v_porcentaje
  from public.porcentajes
  where servicio_id = NEW.servicio_id
    and asistente_id = v_asistente_id;

  NEW.porcentaje_aplicado := v_porcentaje;
  NEW.pago_asistente := case
    when v_porcentaje is not null then round((NEW.precio * v_porcentaje) / 100, 2)
    else null
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_calcular_comision_registro_servicio on public.registro_servicios;
create trigger trg_calcular_comision_registro_servicio
  before insert or update on public.registro_servicios
  for each row execute function public.calcular_comision_registro_servicio();

-- ---------------------------------------------------------
-- C4: UPDATE de no-admins solo el mismo día (DELETE ya era
-- admin-only desde 23_registro_servicios_estado.sql)
-- ---------------------------------------------------------
drop policy if exists registro_servicios_update on public.registro_servicios;

create policy registro_servicios_update on public.registro_servicios
  for update to authenticated
  using (public.es_admin() or (usuario_id = auth.uid() and public.es_hoy(fecha)))
  with check (public.es_admin() or (usuario_id = auth.uid() and public.es_hoy(fecha)));

commit;
