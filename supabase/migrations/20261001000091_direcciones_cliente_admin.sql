-- =========================================================
-- POS Negocio 2 — Direcciones del cliente: visibilidad para el admin +
-- fix de vincular_o_crear_cliente_web()
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 90_direcciones_cliente.sql ya se haya corrido.
--
-- El usuario notó una inconsistencia real: en Clientes (POS) el admin
-- solo veía la única `clientes.direccion` de Mi Perfil, pero un cliente
-- Web ahora puede guardar VARIAS direcciones (§7.17) que el admin no
-- podía ver en absoluto (direcciones_cliente no tenía policy de
-- lectura para admin, solo para el propio dueño). Conclusión acordada:
-- la dirección deja de ser "un dato del perfil" para un cliente Web —
-- ahora vive en la pestaña Direcciones, y el admin debe poder VER
-- (no editar — sigue siendo dato del cliente) todas las que tenga.
--
-- 1) Nueva policy de solo lectura para admin sobre direcciones_cliente.
-- 2) `clientes.direccion`/Mi Perfil se queda tal cual para los clientes
--    creados a mano por el personal (sin cuenta Web, sin acceso a la
--    pestaña Direcciones) — para ellos sigue siendo el único lugar
--    donde registrar una dirección.
-- 3) Fix necesario: ModalEditarPerfilCliente.jsx deja de mandar
--    p_direccion (el campo se quitó de Mi Perfil). Sin este fix, cada
--    guardado de perfil habría hecho `direccion = null` y borrado
--    silenciosamente cualquier valor viejo — se cambia a
--    coalesce(p_direccion, c.direccion), igual que ya hace la rama de
--    "vincular a un candidato existente" un poco más abajo en la misma
--    función.
-- =========================================================

begin;

create policy direcciones_cliente_select_admin on public.direcciones_cliente
  for select to authenticated
  using (public.es_admin());

drop function if exists public.vincular_o_crear_cliente_web(text, text, text, date, boolean);
create function public.vincular_o_crear_cliente_web(
  p_nombre            text,
  p_telefono          text,
  p_direccion         text default null,
  p_cumpleanos        date default null,
  p_confirmar_vinculo boolean default false
)
returns table (
  id                  uuid,
  nombre              text,
  telefono            text,
  direccion           text,
  cumpleanos          date,
  foto_url            text,
  vinculado_existente boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid;
  v_candidatos int;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  if p_telefono is null or trim(p_telefono) = '' then
    raise exception 'El teléfono es obligatorio';
  end if;

  select c.id into v_cliente_id
  from public.clientes c
  where c.cliente_web_id = auth.uid();

  if v_cliente_id is not null then
    if exists (
      select 1 from public.clientes c
      where c.telefono = p_telefono and c.id <> v_cliente_id
    ) then
      raise exception 'Ese teléfono ya está en uso por otro cliente.';
    end if;

    update public.clientes as c
    set nombre = p_nombre,
        telefono = p_telefono,
        direccion = coalesce(p_direccion, c.direccion),
        cumpleanos = p_cumpleanos
    where c.id = v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.direccion, c.cumpleanos, c.foto_url, false
      from public.clientes c
      where c.id = v_cliente_id;
    return;
  end if;

  select count(*) into v_candidatos
  from public.clientes c
  where c.telefono = p_telefono and c.cliente_web_id is null;

  if v_candidatos = 1 and p_confirmar_vinculo then
    update public.clientes as c
    set cliente_web_id = auth.uid(),
        nombre = p_nombre,
        direccion = coalesce(p_direccion, c.direccion),
        cumpleanos = coalesce(p_cumpleanos, c.cumpleanos)
    where c.telefono = p_telefono and c.cliente_web_id is null
    returning c.id into v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.direccion, c.cumpleanos, c.foto_url, true
      from public.clientes c
      where c.id = v_cliente_id;
    return;
  end if;

  if exists (select 1 from public.clientes c where c.telefono = p_telefono) then
    raise exception 'Ese teléfono ya está en uso por otro cliente.';
  end if;

  insert into public.clientes as c (nombre, telefono, direccion, cumpleanos, cliente_web_id)
  values (p_nombre, p_telefono, p_direccion, p_cumpleanos, auth.uid())
  returning c.id into v_cliente_id;

  return query
    select c.id, c.nombre, c.telefono, c.direccion, c.cumpleanos, c.foto_url, false
    from public.clientes c
    where c.id = v_cliente_id;
end;
$$;

grant execute on function public.vincular_o_crear_cliente_web(text, text, text, date, boolean) to authenticated;
revoke execute on function public.vincular_o_crear_cliente_web(text, text, text, date, boolean) from public;

commit;
