-- =========================================================
-- POS Negocio 2 — Clientes: proteger las filas vinculadas a la Web
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 64_fix_ambiguedad_vincular_cliente.sql ya se haya corrido.
--
-- Problema reportado: el admin editó manualmente un cliente ("aaa")
-- poniéndole el mismo teléfono que un cliente ya registrado por la Web
-- ("Abet") — nada lo impedía, "telefono" nunca tuvo restricción de
-- unicidad. Eso rompe la identidad: dos filas de "clientes" con el
-- mismo teléfono ya no se sabe cuál es la real. Además, el admin podía
-- editar o borrar sin ningún límite la fila de CUALQUIER cliente,
-- incluidos los que se registraron solos por la Web — cuyo nombre/
-- teléfono/cumpleaños ahora son responsabilidad del propio cliente
-- (Mi Perfil, ver 63_mi_perfil_cliente.sql), no del personal.
--
-- Cómo diferenciar un cliente manual de uno de Web: la misma columna
-- que ya existe, cliente_web_id. NULL = lo cargó el personal a mano.
-- NOT NULL = se registró solo por la Web. No hace falta una columna
-- ni una tabla nueva para esto.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Corregir el dato ya duplicado antes de poder crear la restricción
-- de unicidad (si no, el índice de abajo falla). "aaa" es la fila
-- manual de prueba; se le limpia el teléfono copiado — su nombre ya
-- delata que no es un cliente real, a diferencia de "Abet" (Web).
-- ---------------------------------------------------------
update public.clientes
set telefono = null
where id = '7dccb7b6-08ab-4fd8-86e3-41c6f7a219df'
  and telefono = '931893668';

-- ---------------------------------------------------------
-- 2. Un teléfono no puede pertenecer a dos clientes a la vez. Parcial
-- (where telefono is not null): muchas filas sin teléfono coexisten
-- sin problema, NULL nunca cuenta como duplicado en Postgres de todas
-- formas, pero se filtra explícito por claridad.
-- ---------------------------------------------------------
create unique index if not exists idx_clientes_telefono_unico
  on public.clientes (telefono)
  where telefono is not null and telefono <> '';

-- ---------------------------------------------------------
-- 3. El admin ya no puede editar/borrar directo una fila con
-- cliente_web_id (registrada por la Web) — solo las que cargó a mano.
-- Sigue viéndolas todas (clientes_select no cambia: el personal
-- necesita elegirlas al vender/agendar). Si en el futuro hace falta
-- que el personal anote dni/notas de un cliente Web, eso va por una
-- función angosta aparte (mismo patrón que vincular_o_crear_cliente_web),
-- no reabriendo este UPDATE genérico.
-- ---------------------------------------------------------
drop policy if exists clientes_update_admin on public.clientes;
create policy clientes_update_admin on public.clientes
  for update to authenticated
  using (public.es_admin() and cliente_web_id is null)
  with check (public.es_admin() and cliente_web_id is null);

drop policy if exists clientes_delete_admin on public.clientes;
create policy clientes_delete_admin on public.clientes
  for delete to authenticated
  using (public.es_admin() and cliente_web_id is null);

-- ---------------------------------------------------------
-- 4. vincular_o_crear_cliente_web ahora puede chocar con el índice
-- único nuevo (un cliente cambia su teléfono a uno que ya es de otra
-- fila, o el teléfono que puso ya es de un cliente de OTRA cuenta Web
-- ya vinculada). Se valida antes, con un mensaje claro, en vez de
-- dejar que reviente con el error crudo de Postgres.
-- ---------------------------------------------------------
create or replace function public.vincular_o_crear_cliente_web(
  p_nombre            text,
  p_telefono          text,
  p_cumpleanos        date default null,
  p_confirmar_vinculo boolean default false
)
returns table (
  id                  uuid,
  nombre              text,
  telefono            text,
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
    set nombre = p_nombre, telefono = p_telefono, cumpleanos = p_cumpleanos
    where c.id = v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, false
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
        cumpleanos = coalesce(p_cumpleanos, c.cumpleanos)
    where c.telefono = p_telefono and c.cliente_web_id is null
    returning c.id into v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, true
      from public.clientes c
      where c.id = v_cliente_id;
    return;
  end if;

  if exists (select 1 from public.clientes c where c.telefono = p_telefono) then
    raise exception 'Ese teléfono ya está en uso por otro cliente.';
  end if;

  insert into public.clientes as c (nombre, telefono, cumpleanos, cliente_web_id)
  values (p_nombre, p_telefono, p_cumpleanos, auth.uid())
  returning c.id into v_cliente_id;

  return query
    select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, false
    from public.clientes c
    where c.id = v_cliente_id;
end;
$$;

grant execute on function public.vincular_o_crear_cliente_web(text, text, date, boolean) to authenticated;
revoke execute on function public.vincular_o_crear_cliente_web(text, text, date, boolean) from public;

commit;
