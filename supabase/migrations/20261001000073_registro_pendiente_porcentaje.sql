-- =========================================================
-- POS Negocio 2 — Mi Panel: registrar sin comisión como nota pendiente
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 56_rol_cajera_asistente.sql ya se haya corrido.
--
-- Hasta ahora, registrar una atención de un servicio sin % de comisión
-- asignado guardaba igual la fila como ACTIVO con pago_asistente en null
-- — silenciosamente contaba en "cantidad" del resumen aunque su plata
-- fuera 0, y no había ninguna forma de "resolverla" después.
--
-- Ahora: una atención ACTIVA siempre tiene que tener comisión resuelta
-- (el trigger lo exige). Si no la tiene, el front ofrece guardarla como
-- nota (estado nuevo PENDIENTE_PORCENTAJE) — no afecta ningún total
-- hasta que el admin le asigne un % en Porcentajes y la asistente la
-- "confirme" (un UPDATE a estado=ACTIVO, que dispara el mismo trigger y
-- recalcula la comisión con el % ya existente).
--
-- De paso se corrige un bug latente: el trigger decidía "dueño sin ficha
-- = admin, dale 100%" mirando si asistentes.usuario_id existe — pero
-- desde esta sesión un admin SÍ puede tener ficha (para que le asignen
-- citas), y Porcentajes.jsx lo excluye de la pantalla de % a propósito
-- (nunca podría configurarse uno). Sin este fix, un admin con ficha que
-- registrara una atención en Mi Panel se quedaría con comisión null en
-- vez de 100%. Ahora se decide por el ROL de la cuenta (usuarios.rol),
-- igual que ya hace esAdminDueno en ModalRegistroAtencion.jsx.
-- =========================================================

begin;

alter table public.registro_servicios
  drop constraint if exists registro_servicios_estado_check;

alter table public.registro_servicios
  add constraint registro_servicios_estado_check
    check (estado in ('ACTIVO', 'CANCELADO', 'PENDIENTE_PORCENTAJE'));

create or replace function public.calcular_comision_registro_servicio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_es_admin_dueno boolean;
  v_asistente_id   uuid;
  v_porcentaje     numeric(5, 2);
begin
  if TG_OP = 'INSERT' and not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  select (u.rol = 'ADMINISTRADOR') into v_es_admin_dueno
  from public.usuarios u
  where u.id = NEW.usuario_id;

  if v_es_admin_dueno then
    NEW.porcentaje_aplicado := 100;
    NEW.pago_asistente := NEW.precio;
    return NEW;
  end if;

  select id into v_asistente_id
  from public.asistentes
  where usuario_id = NEW.usuario_id;

  if v_asistente_id is not null then
    select porcentaje into v_porcentaje
    from public.porcentajes
    where servicio_id = NEW.servicio_id
      and asistente_id = v_asistente_id;
  end if;

  NEW.porcentaje_aplicado := v_porcentaje;
  NEW.pago_asistente := case
    when v_porcentaje is not null then round((NEW.precio * v_porcentaje) / 100, 2)
    else null
  end;

  -- Solo bloquea al INSERTAR o al pasar a ACTIVO desde otro estado (ej.
  -- confirmar una nota pendiente) — editar en el momento un registro que
  -- YA estaba activo (precio, nota, fecha) no se rompe si por algún dato
  -- viejo su comisión seguía sin resolver.
  if NEW.estado = 'ACTIVO' and NEW.porcentaje_aplicado is null
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'ACTIVO') then
    raise exception 'Sin %% asignado — no se puede completar. Comunícate con el administrador.';
  end if;

  return NEW;
end;
$$;

-- resumen_mi_panel: excluir también PENDIENTE_PORCENTAJE de cantidad/totales
-- (antes solo excluía CANCELADO).
create or replace function public.resumen_mi_panel(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_usuario_id uuid default null
)
returns table (
  cantidad bigint,
  total_precio numeric,
  total_pago_asistente numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) as cantidad,
    coalesce(sum(precio), 0) as total_precio,
    coalesce(sum(coalesce(pago_asistente, 0)), 0) as total_pago_asistente
  from public.registro_servicios
  where fecha >= p_desde and fecha < p_hasta
    and estado = 'ACTIVO'
    and (p_usuario_id is null or usuario_id = p_usuario_id)
$$;

grant execute on function public.resumen_mi_panel(timestamptz, timestamptz, uuid) to authenticated;

-- resumen_asistentes_periodo: mismo criterio (resumen_estadisticas y
-- resumen_dashboard, versión viva en 56_rol_cajera_asistente.sql, ya
-- filtran estado = 'ACTIVO' — no hace falta tocarlos).
create or replace function public.resumen_asistentes_periodo(p_desde timestamptz, p_hasta timestamptz)
returns table (
  usuario_id uuid,
  nombre text,
  servicios bigint,
  monto numeric,
  comision numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.usuario_id,
    u.nombre_completo as nombre,
    count(*) as servicios,
    coalesce(sum(r.precio), 0) as monto,
    coalesce(sum(r.pago_asistente), 0) as comision
  from public.registro_servicios r
  join public.usuarios u on u.id = r.usuario_id
  where r.fecha >= p_desde and r.fecha < p_hasta
    and r.estado = 'ACTIVO'
    and u.rol <> 'ADMINISTRADOR'
  group by r.usuario_id, u.nombre_completo
$$;

grant execute on function public.resumen_asistentes_periodo(timestamptz, timestamptz) to authenticated;

commit;
