-- =========================================================
-- Citas: la cápsula «Sin comisión» debe seguir mientras la comisión NO esté resuelta, también en citas ya completadas
--
-- citas_sin_comision() (20261121000003) solo miraba citas PENDIENTE/CONFIRMADA. Al completar una cita con un servicio sin %
-- (nota pendiente, 20261121000003) la cita pasa a COMPLETADA y la cápsula desaparecía aunque la comisión siguiera sin asignarse.
--
-- Ahora una cita COMPLETADA también cuenta, pero SOLO por los servicios cuya atención sigue como nota pendiente
-- (registro_servicios.estado = 'PENDIENTE_PORCENTAJE') y que siguen sin % para su asistente. Se apaga sola cuando:
--   · la administradora asigna el % en Comisiones (el servicio pasa a tener %), o
--   · la dueña de la nota la confirma (la atención pasa a ACTIVO).
-- Una cita completada con todo resuelto nunca se marca (no se vuelve a juzgar un % borrado años después).
-- Mismo criterio de «tiene %» que antes (ficha de ADMINISTRADOR = siempre; si no, fila en `porcentajes` con porcentaje no nulo).
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
    and cs.servicio_id is not null
    and (
      c.estado in ('PENDIENTE', 'CONFIRMADA')
      or (
        c.estado = 'COMPLETADA'
        and exists (
          select 1 from public.registro_servicios r
          where r.id = cs.registro_servicio_id and r.estado = 'PENDIENTE_PORCENTAJE'
        )
      )
    )
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

commit;
