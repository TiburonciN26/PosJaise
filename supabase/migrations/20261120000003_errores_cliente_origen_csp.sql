-- Auditoría global 2026-11-20, hallazgo 7.1 (CSP). La Content-Security-Policy se publica primero en modo «solo aviso»
-- (Report-Only, scripts/lib/csp.mjs): el navegador no bloquea nada, solo emite `securitypolicyviolation`. Para saber
-- qué rompería al activarla, src/lib/reportarError.js manda esos avisos a public.errores_cliente con origen 'csp'.
-- Esta migración solo suma 'csp' a los orígenes aceptados (CHECK de la tabla y lista de registrar_error_cliente). El resto
-- de la función queda IGUAL que en 20261120000002 (tachado, agrupación por huella, topes).
-- Va aparte y no editando la 20261120000002 porque esa ya está aplicada en Local: un archivo editado después de
-- aplicarse dejaría Local distinto de lo que recibiría producción.

begin;

alter table public.errores_cliente drop constraint if exists errores_cliente_origen_check;
alter table public.errores_cliente add constraint errores_cliente_origen_check
  check (origen in ('render', 'global', 'promesa', 'carga', 'csp', 'manual'));

create or replace function public.registrar_error_cliente(p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_origen text := coalesce(nullif(p_datos ->> 'origen', ''), 'manual');
  v_mensaje text := left(public.tachar_datos_personales(coalesce(nullif(btrim(p_datos ->> 'mensaje'), ''), '(sin mensaje)')), 500);
  v_pila text := left(public.tachar_datos_personales(p_datos ->> 'pila'), 4000);
  -- Solo la ruta: sin ?consulta ni #fragmento.
  v_ruta text := left(public.tachar_datos_personales(split_part(split_part(coalesce(p_datos ->> 'ruta', ''), '#', 1), '?', 1)), 300);
  v_version text := left(regexp_replace(coalesce(p_datos ->> 'version', ''), '[^\w.-]', '', 'g'), 40);
  v_navegador text := left(p_datos ->> 'navegador', 300);
  v_arbol text := case when p_datos ->> 'arbol' in ('pos', 'portal') then p_datos ->> 'arbol' end;
  v_huella text;
begin
  if v_origen not in ('render', 'global', 'promesa', 'carga', 'csp', 'manual') then
    v_origen := 'manual';
  end if;
  v_huella := md5(v_origen || '|' || v_mensaje || '|' || coalesce(v_ruta, '') || '|' || coalesce(v_version, ''));

  -- Mismo error dentro de la última hora: se cuenta, no se duplica.
  update public.errores_cliente
     set veces = veces + 1, fecha_ultima = now()
   where id = (select id from public.errores_cliente
                where huella = v_huella and fecha_ultima > now() - interval '1 hour'
                order by fecha_ultima desc limit 1);
  if found then
    return;
  end if;

  -- Topes contra abuso: se descarta en silencio (el navegador no debe enterarse ni reintentar).
  if (select count(*) from public.errores_cliente where fecha > now() - interval '10 minutes') >= 300 then
    return;
  end if;
  if v_uid is not null and (select count(*) from public.errores_cliente
                             where usuario_id = v_uid and fecha > now() - interval '10 minutes') >= 30 then
    return;
  end if;

  insert into public.errores_cliente (huella, origen, mensaje, pila, ruta, version, navegador, arbol, usuario_id, rol)
  values (v_huella, v_origen, v_mensaje, v_pila, nullif(v_ruta, ''), nullif(v_version, ''), v_navegador, v_arbol,
          v_uid, public.rol_actual());
end;
$$;

-- create or replace conserva los permisos, pero se repiten para que el archivo se lea solo.
revoke execute on function public.registrar_error_cliente(jsonb) from public;
grant execute on function public.registrar_error_cliente(jsonb) to anon, authenticated;

commit;
