-- =========================================================
-- POS Negocio 2 — Estado del negocio (abierto/cerrado)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Fuente de verdad única en Supabase: fila singleton (id fijo en 1)
-- que dice si el negocio está operando. El admin la cambia desde el
-- menú del logo (Header.jsx); todos los dispositivos conectados se
-- enteran en tiempo real vía Realtime (postgres_changes).
--
-- RLS: cualquier usuario autenticado puede LEER el estado (hace
-- falta para mostrar el aviso a un asistente y para el chequeo de
-- login), pero solo el admin puede ACTUALIZARLO — sin INSERT/DELETE
-- para "authenticated" (la fila se siembra una sola vez, acá mismo,
-- con privilegios de servicio del SQL Editor).
-- =========================================================

begin;

create table public.estado_negocio (
  id              smallint primary key default 1,
  abierto         boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references public.usuarios (id) on delete set null,
  constraint estado_negocio_singleton check (id = 1)
);

insert into public.estado_negocio (id, abierto) values (1, true);

alter table public.estado_negocio enable row level security;

grant select, update on public.estado_negocio to authenticated;

create policy estado_negocio_select on public.estado_negocio
  for select to authenticated
  using (true);

create policy estado_negocio_update_admin on public.estado_negocio
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- El cliente solo manda { abierto: true/false } — quién y cuándo los
-- pone el propio servidor, así no dependen de lo que el navegador
-- diga (ni se pueden falsificar mandando otro usuario_id).
create or replace function public.marcar_actualizacion_estado_negocio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  NEW.actualizado_en := now();
  NEW.actualizado_por := auth.uid();
  return NEW;
end;
$$;

create trigger trg_actualizado_estado_negocio
  before update on public.estado_negocio
  for each row execute function public.marcar_actualizacion_estado_negocio();

-- Función de lectura para usar dentro de otras RPCs/policies (mismo
-- patrón que rol_actual()/es_admin() en 03_rls.sql). Fail-open si la
-- fila no existiera por algún motivo: un glitch de datos no debería
-- tumbar las ventas de todo el negocio.
create or replace function public.negocio_abierto()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select abierto from public.estado_negocio where id = 1), true);
$$;

-- Descripción legible en Auditoría ("Negocio" en vez del id numérico
-- 1) — mismo patrón que registro_servicios/porcentajes en
-- 26_auditoria_descripcion_relaciones.sql (se reemplaza la función
-- completa: CREATE OR REPLACE no permite agregar una rama nueva sin
-- repetir las que ya existían).
create or replace function public.descripcion_de_fila(p_tabla text, p_fila jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado text;
begin
  if p_tabla = 'registro_servicios' then
    select s.nombre into v_resultado
    from public.servicios s
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Atención');
  end if;

  if p_tabla = 'porcentajes' then
    select s.nombre || ' — ' || a.nombres_completos into v_resultado
    from public.servicios s
    join public.asistentes a on a.id = (p_fila->>'asistente_id')::uuid
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Porcentaje');
  end if;

  if p_tabla = 'estado_negocio' then
    return 'Negocio';
  end if;

  return coalesce(
    p_fila->>'nombre', p_fila->>'nombres_completos', p_fila->>'nombre_completo',
    p_fila->>'codigo', p_fila->>'id'
  );
end;
$$;

-- Se agregan actualizado_en/actualizado_por a las columnas que el
-- trigger genérico ignora al comparar (mismo motivo que stock_actual:
-- sin esto, cada toggle generaría 3 filas de auditoría — "abierto",
-- "actualizado_en" y "actualizado_por" — en vez de una sola limpia.
-- Ninguna otra tabla usa estos nombres de columna, así que el cambio
-- es seguro para el resto (se reemplaza la función completa, mismo
-- motivo que arriba).
create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_registro_id text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  select email into v_email from public.usuarios where id = auth.uid();

  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_registro_id := v_new->>'id';
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (v_email, TG_TABLE_NAME, v_registro_id, public.descripcion_de_fila(TG_TABLE_NAME, v_new), null, null, 'creado');
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_registro_id := v_old->>'id';
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (v_email, TG_TABLE_NAME, v_registro_id, public.descripcion_de_fila(TG_TABLE_NAME, v_old), null, 'eliminado', null);
    return OLD;
  end if;

  -- UPDATE
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  v_registro_id := v_new->>'id';

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key in ('id', 'creado_en', 'fecha', 'stock_actual', 'actualizado_en', 'actualizado_por') then
      continue;
    end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
      values (
        v_email, TG_TABLE_NAME, v_registro_id, public.descripcion_de_fila(TG_TABLE_NAME, v_new),
        v_key, v_old ->> v_key, v_new ->> v_key
      );
    end if;
  end loop;

  return NEW;
end;
$$;

-- Auditoría: reutiliza el trigger genérico ya usado por productos/
-- servicios/etc. (25_auditoria_triggers.sql) — cada apertura/cierre
-- queda registrada con quién y cuándo.
drop trigger if exists auditoria_estado_negocio on public.estado_negocio;
create trigger auditoria_estado_negocio
  after update on public.estado_negocio
  for each row execute function public.registrar_auditoria();

-- Realtime: sin esto, un cambio de estado en un dispositivo no se ve
-- en los demás hasta recargar la página.
alter publication supabase_realtime add table public.estado_negocio;

commit;
