-- =========================================================
-- POS Negocio 2 — Clientes: campo dirección (para delivery a futuro)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 66_clientes_web_email_visible_admin.sql ya se haya corrido.
--
-- "dni" se saca de la vista/formulario en esta pasada (queda la columna,
-- solo deja de pedirse/mostrarse — dato ocasional que casi nadie completa
-- y no debe contarse en la barra de "datos completos"). "direccion" es
-- nueva y sí cuenta ahí — se necesita a futuro para servicios/ventas a
-- delivery, aunque por ahora es solo un campo sin lógica encima.
--
-- Cambia el RETURNS TABLE de mi_perfil_cliente() y la firma de
-- vincular_o_crear_cliente_web() (agrega p_direccion) — CREATE OR
-- REPLACE no permite tocar ni columnas de retorno ni la lista de
-- parámetros, así que se DROPean antes de recrearlas.
-- =========================================================

begin;

alter table public.clientes add column if not exists direccion text;

drop function if exists public.mi_perfil_cliente();
create function public.mi_perfil_cliente()
returns table (
  id         uuid,
  nombre     text,
  telefono   text,
  direccion  text,
  cumpleanos date,
  foto_url   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.nombre, c.telefono, c.direccion, c.cumpleanos, c.foto_url
  from public.clientes c
  where c.cliente_web_id = auth.uid();
$$;

grant execute on function public.mi_perfil_cliente() to authenticated;
revoke execute on function public.mi_perfil_cliente() from public;

drop function if exists public.vincular_o_crear_cliente_web(text, text, date, boolean);
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
        direccion = p_direccion,
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
