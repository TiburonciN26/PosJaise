-- Gestión de personal desde el POS (pestaña «Personal», solo ADMINISTRADOR).
--
-- POR QUÉ: dar de alta a una cajera/asistente/encargada exigía crear el usuario en Supabase Auth a mano,
-- insertar su fila en `usuarios`, crear su ficha en Asistentes y vincularla. Ahora la administradora lo hace
-- desde la app (Edge Function `gestionar-personal`, que usa el service_role solo para `auth.admin.*`).
-- Esta migración pone las garantías que NO deben depender de la UI ni de la función:
--
--   1. Una cuenta solo puede tener UNA ficha en `asistentes` (hoy solo lo evita la UI; con dos fichas el
--      trigger de comisión tomaba una cualquiera y el modal de atenciones leía «sin ficha»).
--   2. Nunca puede quedar el sistema sin un ADMINISTRADOR activo (bloquear, degradar o borrar al último).
--   3. `personal_listar()`: la lista de cuentas con estado de acceso (bloqueada, último ingreso) que vive en
--      `auth.users` y no es legible desde el cliente.
--
-- Las escrituras a `usuarios`/`asistentes` las hace la función con el JWT de la administradora (RLS ya permite
-- INSERT/UPDATE a es_admin()), así los triggers de auditoría registran QUIÉN hizo cada cambio.

begin;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Una ficha por cuenta
-- ---------------------------------------------------------------------------------------------------------
-- Si esto falla en producción es porque YA hay dos fichas para una misma cuenta: se resuelve a mano
-- (desvincular o borrar la sobrante) antes de volver a correrla. Consulta previa:
--   select usuario_id, count(*) from public.asistentes where usuario_id is not null group by 1 having count(*) > 1;
create unique index if not exists asistentes_usuario_id_unico
  on public.asistentes (usuario_id)
  where usuario_id is not null;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Siempre al menos un administrador activo
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.proteger_ultimo_administrador()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Solo importa si la fila saliente es un administrador ACTIVO y deja de serlo (o se borra).
  if old.rol = 'ADMINISTRADOR' and old.activo then
    if tg_op = 'DELETE' or new.rol <> 'ADMINISTRADOR' or not new.activo then
      -- Bloquea las filas de los demás administradores activos mientras se decide, para que dos cambios
      -- simultáneos no dejen el sistema sin ninguno.
      perform 1
        from public.usuarios u
       where u.rol = 'ADMINISTRADOR' and u.activo and u.id <> old.id
         for update;
      if not found then
        raise exception 'Debe quedar al menos un administrador activo.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_ultimo_administrador() from public, anon, authenticated;

drop trigger if exists proteger_ultimo_administrador on public.usuarios;
create trigger proteger_ultimo_administrador
  before update or delete on public.usuarios
  for each row execute function public.proteger_ultimo_administrador();

-- ---------------------------------------------------------------------------------------------------------
-- 3. Lista de personal con estado de acceso
-- ---------------------------------------------------------------------------------------------------------
-- security definer porque lee auth.users (último ingreso, bloqueo). Solo la administradora.
create or replace function public.personal_listar()
returns table (
  id uuid,
  email text,
  nombre_completo text,
  rol text,
  activo boolean,
  foto_url text,
  creado_en timestamptz,
  ultimo_acceso timestamptz,
  bloqueada_hasta timestamptz,
  ficha_id uuid,
  ficha_activa boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver el personal.' using errcode = '42501';
  end if;

  return query
    select u.id,
           u.email,
           u.nombre_completo,
           u.rol,
           u.activo,
           u.foto_url,
           u.creado_en,
           au.last_sign_in_at,
           au.banned_until,
           a.id,
           a.activo
      from public.usuarios u
      left join auth.users au on au.id = u.id
      left join public.asistentes a on a.usuario_id = u.id
     order by u.activo desc, u.nombre_completo;
end;
$$;

revoke execute on function public.personal_listar() from public, anon;
grant execute on function public.personal_listar() to authenticated;

commit;
