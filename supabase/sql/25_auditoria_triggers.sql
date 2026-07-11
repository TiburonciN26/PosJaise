-- =========================================================
-- POS Negocio 2 — Fase 7: auditoría automática (triggers)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- La tabla public.auditoria existe desde 01_tablas.sql pero nunca
-- se escribía — este script la llena desde el servidor (triggers
-- SECURITY DEFINER), no desde el frontend, para que ningún cliente
-- pueda saltarse el registro ni falsificar una entrada.
--
-- Se audita: usuarios, asistentes, productos (menos stock_actual,
-- que ya tiene su propio historial en movimientos_stock y se toca
-- en cada venta), servicios, porcentajes, gastos, gastos
-- recurrentes, clientes, registro_servicios (incluida la comisión)
-- y el cambio de estado de ventas (anulaciones).
--
-- NO se audita: la creación de ventas/venta_items (ya tienen su
-- propio historial en la pestaña Historial) ni las cargas de stock
-- (ya quedan en movimientos_stock).
-- =========================================================

begin;

alter table public.auditoria add column if not exists descripcion text;

-- =========================================================
-- Función genérica: se engancha a cualquier tabla vía trigger y
-- registra un INSERT como "creado", un DELETE como "eliminado", y
-- un UPDATE como una fila de auditoria por cada columna que
-- realmente cambió (comparando el jsonb de OLD vs NEW).
-- =========================================================
create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_registro_id text;
  v_descripcion text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  select email into v_email from public.usuarios where id = auth.uid();

  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_registro_id := v_new->>'id';
    v_descripcion := coalesce(
      v_new->>'nombre', v_new->>'nombres_completos', v_new->>'nombre_completo',
      v_new->>'codigo', v_registro_id
    );
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (v_email, TG_TABLE_NAME, v_registro_id, v_descripcion, null, null, 'creado');
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_registro_id := v_old->>'id';
    v_descripcion := coalesce(
      v_old->>'nombre', v_old->>'nombres_completos', v_old->>'nombre_completo',
      v_old->>'codigo', v_registro_id
    );
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (v_email, TG_TABLE_NAME, v_registro_id, v_descripcion, null, 'eliminado', null);
    return OLD;
  end if;

  -- UPDATE
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  v_registro_id := v_new->>'id';
  v_descripcion := coalesce(
    v_new->>'nombre', v_new->>'nombres_completos', v_new->>'nombre_completo',
    v_new->>'codigo', v_registro_id
  );

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key in ('id', 'creado_en', 'fecha', 'stock_actual') then
      continue;
    end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
      values (v_email, TG_TABLE_NAME, v_registro_id, v_descripcion, v_key, v_old ->> v_key, v_new ->> v_key);
    end if;
  end loop;

  return NEW;
end;
$$;

-- =========================================================
-- Trigger dedicado para ventas: solo audita el cambio de estado
-- (anulaciones) — la creación de la venta ya vive en Historial y
-- no queremos duplicar cada línea de cada ticket acá.
-- =========================================================
create or replace function public.registrar_auditoria_venta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if NEW.estado is distinct from OLD.estado then
    select email into v_email from public.usuarios where id = auth.uid();
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (v_email, 'ventas', NEW.id::text, NEW.codigo, 'estado', OLD.estado, NEW.estado);
  end if;
  return NEW;
end;
$$;

-- =========================================================
-- Enganchar los triggers a cada tabla
-- =========================================================
drop trigger if exists auditoria_usuarios on public.usuarios;
create trigger auditoria_usuarios
  after insert or update or delete on public.usuarios
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_asistentes on public.asistentes;
create trigger auditoria_asistentes
  after insert or update or delete on public.asistentes
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_productos on public.productos;
create trigger auditoria_productos
  after insert or update or delete on public.productos
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_servicios on public.servicios;
create trigger auditoria_servicios
  after insert or update or delete on public.servicios
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_porcentajes on public.porcentajes;
create trigger auditoria_porcentajes
  after insert or update or delete on public.porcentajes
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_gastos on public.gastos;
create trigger auditoria_gastos
  after insert or update or delete on public.gastos
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_gastos_recurrentes on public.gastos_recurrentes;
create trigger auditoria_gastos_recurrentes
  after insert or update or delete on public.gastos_recurrentes
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_clientes on public.clientes;
create trigger auditoria_clientes
  after insert or update or delete on public.clientes
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_registro_servicios on public.registro_servicios;
create trigger auditoria_registro_servicios
  after insert or update or delete on public.registro_servicios
  for each row execute function public.registrar_auditoria();

drop trigger if exists auditoria_ventas_estado on public.ventas;
create trigger auditoria_ventas_estado
  after update on public.ventas
  for each row execute function public.registrar_auditoria_venta();

commit;
