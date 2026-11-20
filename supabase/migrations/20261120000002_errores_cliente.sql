-- Auditoría global 2026-11-20 (docs/auditorias/auditoria-global-2026-11-20.md), hallazgo 20.1: los errores de la app en
-- producción no llegaban a ningún lado. ErrorBoundary hacía console.error en el navegador de quien sufría el error, y cuando
-- la clienta o la cajera decían «no me deja pagar» no había nada que revisar.
--
-- POR QUÉ UNA TABLA PROPIA Y NO SENTRY: no exige cuenta ni DSN, no saca datos del negocio a un tercero y es gratis. Si el
-- volumen o la necesidad crecen se puede migrar a Sentry sin tocar más que src/lib/reportarError.js.
--
-- DISEÑO
--  · public.errores_cliente: un error por «huella» (origen + mensaje + ruta + versión). Si el MISMO error se repite dentro
--    de 1 hora, se suma a `veces` y se actualiza `fecha_ultima` en vez de crear otra fila, así un bucle de errores no
--    llena la tabla.
--  · Solo se escribe por public.registrar_error_cliente() (security definer). La tabla no tiene políticas de INSERT/UPDATE,
--    así que nadie la escribe directo. La ejecutan anon y authenticated: el portal público también falla y esos errores
--    importan (son las clientas).
--  · Contra abuso (la anon key es pública): tope global de 300 errores NUEVOS cada 10 minutos y 30 por usuario con sesión.
--    Pasado el tope, la llamada no hace nada y no falla. Los campos se recortan.
--  · Datos personales: se tachan en el servidor correos, secuencias de 8 o más dígitos (DNI, teléfono, tarjeta) y tokens
--    JWT de mensaje, pila y ruta. La ruta se guarda sin ?consulta ni #fragmento (ahí viajan tokens de recuperación de clave).
--    El cliente ya manda solo `location.pathname`; esto es la segunda barrera.
--  · Lectura y borrado: solo el administrador (RLS con es_admin()). Retención: pg_cron borra a diario lo que lleva
--    más de 30 días sin repetirse.

begin;

create table if not exists public.errores_cliente (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),          -- primera vez que se vio esta huella
  fecha_ultima timestamptz not null default now(),   -- última repetición
  veces integer not null default 1,
  huella text not null,
  origen text not null check (origen in ('render', 'global', 'promesa', 'carga', 'manual')),
  mensaje text not null,
  pila text,
  ruta text,
  version text,
  navegador text,
  arbol text check (arbol in ('pos', 'portal')),
  usuario_id uuid,                                    -- auth.uid() de quien lo sufrió (null = visitante sin sesión)
  rol text                                            -- rol del personal en ese momento (null = clienta o visitante)
);

comment on table public.errores_cliente is
  'Errores de la app reportados por el navegador (src/lib/reportarError.js). Se escribe solo por registrar_error_cliente(). Ver migración 20261120000002.';

create index if not exists errores_cliente_huella_idx on public.errores_cliente (huella, fecha_ultima desc);
create index if not exists errores_cliente_fecha_idx on public.errores_cliente (fecha desc);
create index if not exists errores_cliente_usuario_idx on public.errores_cliente (usuario_id, fecha desc) where usuario_id is not null;

alter table public.errores_cliente enable row level security;

drop policy if exists errores_cliente_select_admin on public.errores_cliente;
create policy errores_cliente_select_admin on public.errores_cliente for select to authenticated
  using (public.es_admin());

drop policy if exists errores_cliente_delete_admin on public.errores_cliente;
create policy errores_cliente_delete_admin on public.errores_cliente for delete to authenticated
  using (public.es_admin());

-- En este proyecto authenticated no recibe permisos automáticos: sin GRANT, la RLS ni se evalúa (403).
revoke all on public.errores_cliente from anon, authenticated;
grant select, delete on public.errores_cliente to authenticated;

-- Tacha datos personales y tokens de un texto libre.
create or replace function public.tachar_datos_personales(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(p_texto,
               '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<correo>', 'g'),
             'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '<token>', 'g'),
           '\d{8,}', '<número>', 'g')
$$;
revoke execute on function public.tachar_datos_personales(text) from public, anon, authenticated;

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
  if v_origen not in ('render', 'global', 'promesa', 'carga', 'manual') then
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

revoke execute on function public.registrar_error_cliente(jsonb) from public;
grant execute on function public.registrar_error_cliente(jsonb) to anon, authenticated;

-- Retención: 30 días desde la última vez que se vio. pg_cron ya está activo (20261112000005).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purgar-errores-cliente', '15 5 * * *',
  $$delete from public.errores_cliente where fecha_ultima < now() - interval '30 days'$$);

commit;
