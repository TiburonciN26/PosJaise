-- Mi Panel: las atenciones PENDIENTES de comisión («notas» sin % asignado) son de quien las anotó.
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): cuando una asistente / encargada / personal de apoyo registra una atención
-- de un servicio sin % asignado, queda como nota (estado PENDIENTE_PORCENTAJE). La administradora la VE y le asigna el %
-- en Porcentajes, pero NO debe poder confirmarla, editarla, cancelarla ni eliminarla: confirmar es cosa de la dueña del
-- panel («el administrador asignó tu porcentaje, puedes confirmarlo»).
--
-- QUÉ SE TOCA:
--   * registro_servicios_update: la rama del administrador ya no alcanza filas PENDIENTE_PORCENTAJE (ni puede dejar una
--     fila en ese estado). La rama de la dueña (su fila, de HOY) no cambia: puede cancelar su nota del día.
--   * registro_servicios_delete_admin: la administradora no elimina notas pendientes.
--   * confirmar_atencion_pendiente(p_registro_id): NUEVA, security definer. Solo la dueña de la fila, solo si sigue
--     PENDIENTE_PORCENTAJE, y de CUALQUIER día (la política de update solo le deja tocar filas de hoy, y el % puede
--     asignarse días después). Pasa la fila a ACTIVO; el trigger calcular_comision_registro_servicio aplica el % vigente y
--     lanza «Sin % asignado…» si todavía no lo hay, así que no se puede confirmar sin %.
--
-- QUÉ NO SE TOCA: el administrador sigue editando/cancelando/eliminando atenciones ACTIVAS y CANCELADAS como antes; las
-- funciones security definer (anular_venta, completar_cita, …) no pasan por la RLS.

begin;

drop policy registro_servicios_update on public.registro_servicios;
create policy registro_servicios_update on public.registro_servicios for update to authenticated
  using (
    (public.es_admin() and estado <> 'PENDIENTE_PORCENTAJE')
    or (usuario_id = auth.uid() and public.es_hoy(fecha))
  )
  with check (
    (public.es_admin() and estado <> 'PENDIENTE_PORCENTAJE')
    or (usuario_id = auth.uid() and public.es_hoy(fecha))
  );

drop policy registro_servicios_delete_admin on public.registro_servicios;
create policy registro_servicios_delete_admin on public.registro_servicios for delete to authenticated
  using (public.es_admin() and estado <> 'PENDIENTE_PORCENTAJE');

create or replace function public.confirmar_atencion_pendiente(p_registro_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid;
  v_estado  text;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida.' using errcode = '42501';
  end if;

  select usuario_id, estado into v_usuario, v_estado
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

  -- El trigger calcula porcentaje_aplicado / pago_asistente con el % vigente, o lanza si aún no hay %.
  update public.registro_servicios set estado = 'ACTIVO' where id = p_registro_id;
end;
$$;

revoke execute on function public.confirmar_atencion_pendiente(uuid) from public, anon;
grant execute on function public.confirmar_atencion_pendiente(uuid) to authenticated;

commit;
