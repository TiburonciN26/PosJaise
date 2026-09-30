-- =========================================================
-- POS Negocio 2 — Pestaña Web: Mi Perfil (vínculo cliente_web ↔ clientes)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 62_clientes_web.sql ya se haya corrido.
--
-- clientes_web es la identidad de LOGIN; "clientes" sigue siendo el
-- ÚNICO registro de NEGOCIO (nombre, teléfono, dni, cumpleaños, notas),
-- el mismo que ya usan Ventas/Citas/Mi Panel. cliente_web_id conecta
-- una cuenta de login con, como máximo, una fila de clientes — nunca
-- hay dos copias del mismo dato (ver implementacionesWed.md, sección 1).
--
-- Todo el acceso de un cliente a "clientes" pasa por funciones
-- security definer (mismo patrón que actualizar_mi_foto_perfil() en
-- 46_foto_perfil_usuario.sql) — nunca por INSERT/UPDATE/SELECT directo.
-- Así "clientes" se queda staff-only a nivel de RLS tal cual estaba
-- (dni/notas incluidos) y el cliente solo puede tocar, de su propia
-- fila, nombre/teléfono/cumpleaños/foto — igual que "productos_vista"
-- oculta "costo" sin duplicar la tabla de productos.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. clientes_web se queda mínima: "nombre_completo" nunca se llegó a
-- usar de verdad (AuthContext.cargarPerfilCliente no lo leía para nada
-- más que guardarlo) — el nombre real vive solo en "clientes", para no
-- tener dos copias que puedan divergir.
-- ---------------------------------------------------------
alter table public.clientes_web drop column if exists nombre_completo;

-- ---------------------------------------------------------
-- 2. clientes: columna de vínculo + foto de perfil.
-- unique en cliente_web_id: una cuenta de login no puede vincularse a
-- dos filas de clientes (NULL no cuenta como duplicado en Postgres,
-- así que las filas de clientes creadas por el personal, sin cliente
-- web todavía, no chocan entre sí).
-- ---------------------------------------------------------
alter table public.clientes
  add column if not exists cliente_web_id uuid unique references public.clientes_web (id) on delete set null,
  add column if not exists foto_url text;

create index if not exists idx_clientes_telefono on public.clientes (telefono);

-- ---------------------------------------------------------
-- 3. Chequeo de coincidencia sin exponer ningún dato del posible
-- match (ni nombre ni nada) — el frontend solo lo usa para decidir si
-- muestra el diálogo de confirmación "¿es tu registro?" antes de
-- guardar. Cualquier autenticado puede llamarla: no devuelve nada
-- sensible, es un booleano.
-- ---------------------------------------------------------
create or replace function public.existe_cliente_no_vinculado(p_telefono text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clientes
    where telefono = p_telefono and cliente_web_id is null
  );
$$;

grant execute on function public.existe_cliente_no_vinculado(text) to authenticated;

-- ---------------------------------------------------------
-- 4. Lectura del propio perfil, para pintar el formulario de Mi
-- Perfil. Devuelve 0 filas si todavía no se vinculó/creó ninguna
-- (cuenta recién confirmada, primera vez en Mi Perfil).
-- ---------------------------------------------------------
create or replace function public.mi_perfil_cliente()
returns table (
  id         uuid,
  nombre     text,
  telefono   text,
  cumpleanos date,
  foto_url   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url
  from public.clientes c
  where c.cliente_web_id = auth.uid();
$$;

grant execute on function public.mi_perfil_cliente() to authenticated;

-- ---------------------------------------------------------
-- 5. Vincular (con confirmación explícita del cliente, nunca a
-- ciegas) o crear. p_confirmar_vinculo solo importa cuando hay
-- EXACTAMENTE una fila sin vincular con ese teléfono: si el cliente no
-- confirma, o hay cero o más de una coincidencia, se crea una fila
-- nueva en vez de adivinar. Llamarla de nuevo ya estando vinculado es
-- seguro (idempotente): solo actualiza la fila propia.
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
    update public.clientes
    set nombre = p_nombre, telefono = p_telefono, cumpleanos = p_cumpleanos
    where id = v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, false
      from public.clientes c
      where c.id = v_cliente_id;
    return;
  end if;

  select count(*) into v_candidatos
  from public.clientes
  where telefono = p_telefono and cliente_web_id is null;

  if v_candidatos = 1 and p_confirmar_vinculo then
    update public.clientes
    set cliente_web_id = auth.uid(),
        nombre = p_nombre,
        cumpleanos = coalesce(p_cumpleanos, cumpleanos)
    where telefono = p_telefono and cliente_web_id is null
    returning id into v_cliente_id;

    return query
      select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, true
      from public.clientes c
      where c.id = v_cliente_id;
    return;
  end if;

  insert into public.clientes (nombre, telefono, cumpleanos, cliente_web_id)
  values (p_nombre, p_telefono, p_cumpleanos, auth.uid())
  returning id into v_cliente_id;

  return query
    select c.id, c.nombre, c.telefono, c.cumpleanos, c.foto_url, false
    from public.clientes c
    where c.id = v_cliente_id;
end;
$$;

grant execute on function public.vincular_o_crear_cliente_web(text, text, date, boolean) to authenticated;

-- ---------------------------------------------------------
-- 6. Foto de perfil del cliente — mismo patrón que
-- actualizar_mi_foto_perfil() (46_foto_perfil_usuario.sql), pero sobre
-- la fila de "clientes" vinculada al auth.uid() actual, en vez de
-- "usuarios". Bucket propio, misma regla de carpeta-por-uid.
-- ---------------------------------------------------------
create or replace function public.actualizar_mi_foto_cliente(p_foto_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  update public.clientes
  set foto_url = p_foto_url
  where cliente_web_id = auth.uid();
end;
$$;

grant execute on function public.actualizar_mi_foto_cliente(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('fotos-clientes', 'fotos-clientes', true)
on conflict (id) do nothing;

create policy fotos_clientes_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'fotos-clientes');

create policy fotos_clientes_insert_propia on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fotos-clientes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy fotos_clientes_update_propia on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fotos-clientes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'fotos-clientes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy fotos_clientes_delete_propia on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fotos-clientes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
