-- =========================================================
-- POS Negocio 2 — Fase 7b: descripción legible para tablas sin
-- nombre propio
--
-- registro_servicios y porcentajes no tienen columna "nombre": la
-- función anterior caía al UUID de la fila (v_registro_id), que se
-- veía como "código raro" en la pantalla de Auditoría. Acá se
-- resuelve el nombre real vía el servicio (y asistente) relacionado.
--
-- Solo reemplaza funciones (CREATE OR REPLACE): los triggers ya
-- creados en 25_auditoria_triggers.sql siguen apuntando al mismo
-- nombre de función, así que no hace falta recrearlos. Las
-- entradas de auditoría ya guardadas con el UUID no se corrigen
-- retroactivamente (serían necesarias más columnas que ya no
-- existen para saber qué servicio/asistente era en ese momento).
-- =========================================================

begin;

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

  return coalesce(
    p_fila->>'nombre', p_fila->>'nombres_completos', p_fila->>'nombre_completo',
    p_fila->>'codigo', p_fila->>'id'
  );
end;
$$;

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
    if v_key in ('id', 'creado_en', 'fecha', 'stock_actual') then
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

commit;
