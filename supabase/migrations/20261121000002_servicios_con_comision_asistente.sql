-- =========================================================
-- Citas: avisar desde el inicio qué servicios NO tienen comisión para la asistente elegida
--
-- Al agendar, cualquier servicio se puede agregar a cualquier cita, pero al COMPLETARLA el servidor exige que la asistente
-- tenga un % asignado para cada servicio (registro_servicios ACTIVO sin comisión resuelta no se guarda). Antes el problema
-- aparecía recién al completar la cita; la administradora tenía que enterarse y arreglarlo a último momento.
--
-- servicios_con_comision(p_asistente_id) devuelve los ids de los servicios que SÍ tienen comisión para esa asistente. Con eso
-- Nueva cita marca con un check verde los servicios con % y avisa en el carrito de los que no, y el detalle de la cita
-- muestra «Sin comisión» junto a esos servicios.
--
-- POR QUÉ UNA RPC y no leer `porcentajes` desde el navegador: la RLS de porcentajes (20261001000022) solo deja a cada
-- asistente leer SUS filas (la admin lee todas). Quien agenda una cita para OTRA asistente vería 0 filas y todo saldría «sin
-- comisión». Esta función es security definer y solo devuelve QUÉ servicios tienen %, nunca el valor del porcentaje
-- (ese dato sigue siendo privado de cada asistente y de la admin).
--
-- Criterio (el mismo que ModalRegistroAtencion al completar la cita):
--   · ficha vinculada a una cuenta ADMINISTRADOR → siempre se queda con el 100 %: todos los servicios cuentan como con comisión.
--   · cualquier otra ficha (con o sin cuenta) → solo los servicios con una fila en `porcentajes` con porcentaje no nulo.
--   · p_asistente_id nulo (cita sin asistente todavía) → null: no hay a quién validar, el cliente no muestra aviso.
-- Pueden llamarla los roles que agendan citas (todos menos PERSONAL_APOYO, que no puede crearlas).
-- =========================================================

begin;

create or replace function public.servicios_con_comision(p_asistente_id uuid)
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

  if p_asistente_id is null then
    return null;
  end if;

  if exists (
    select 1
    from public.asistentes a
    join public.usuarios u on u.id = a.usuario_id
    where a.id = p_asistente_id and u.rol = 'ADMINISTRADOR'
  ) then
    select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ids from public.servicios s;
  else
    select coalesce(array_agg(p.servicio_id), '{}'::uuid[]) into v_ids
    from public.porcentajes p
    where p.asistente_id = p_asistente_id and p.porcentaje is not null;
  end if;

  return v_ids;
end;
$$;

revoke execute on function public.servicios_con_comision(uuid) from public, anon;
grant execute on function public.servicios_con_comision(uuid) to authenticated;

commit;
