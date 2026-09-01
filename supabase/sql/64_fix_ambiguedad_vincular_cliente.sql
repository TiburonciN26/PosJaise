-- =========================================================
-- POS Negocio 2 — Fix: vincular_o_crear_cliente_web fallaba SIEMPRE
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 63_mi_perfil_cliente.sql ya se haya corrido.
--
-- Bug real detectado en producción (MCP + logs de Postgres): toda
-- llamada a vincular_o_crear_cliente_web() tiraba
-- "column reference ... is ambiguous" y el guardado de Mi Perfil no
-- hacía nada, silenciosamente. Causa: RETURNS TABLE(id, nombre,
-- telefono, cumpleanos, foto_url, vinculado_existente) hace que
-- PL/pgSQL cree variables internas con esos mismos nombres — y el
-- cuerpo de la función tenía referencias SIN alias a columnas de
-- "clientes" con esos nombres exactos (where telefono = ...,
-- coalesce(p_cumpleanos, cumpleanos), returning id) que Postgres no
-- podía resolver: ¿la variable de retorno o la columna de la tabla?
-- Se corrige alias-calificando toda la tabla como "c" y cada columna
-- leída como "c.columna" — las únicas posiciones que quedan sin alias
-- son los targets de SET/columnas de INSERT, donde el estándar SQL
-- exige el nombre desnudo (ahí no hay ambigüedad posible).
--
-- Verificado con una llamada real simulada (auth.uid() suplantado vía
-- request.jwt.claim.sub, en una transacción con rollback): crea
-- cliente nuevo, vincula uno existente por teléfono con confirmación,
-- y re-guarda ya estando vinculado — los tres casos devuelven fila sin
-- error.
-- =========================================================

begin;

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

-- ---------------------------------------------------------
-- De paso: Postgres le da EXECUTE a PUBLIC por defecto en toda función
-- nueva, salvo que se revoque a mano — se nos pasó en 63_ para las 4
-- funciones de Mi Perfil. Sin esto, cualquiera con la anon key (o sea,
-- cualquier visitante sin haber iniciado sesión — la key es pública,
-- va en el bundle del frontend) podía llamar existe_cliente_no_vinculado
-- y probar números de teléfono contra la tabla clientes sin loguearse.
-- Las otras tres no filtraban datos (dependen de auth.uid(), que un
-- anónimo no tiene), pero se cierran igual por consistencia. Nota:
-- este mismo problema ya existe en funciones más viejas del proyecto
-- (rol_actual, es_admin, usuarios_para_citas, actualizar_mi_foto_perfil)
-- — quedan fuera de este fix, es una limpieza aparte si se quiere hacer.
-- ---------------------------------------------------------
revoke execute on function public.existe_cliente_no_vinculado(text) from public;
revoke execute on function public.mi_perfil_cliente() from public;
revoke execute on function public.vincular_o_crear_cliente_web(text, text, date, boolean) from public;
revoke execute on function public.actualizar_mi_foto_cliente(text) from public;

commit;
