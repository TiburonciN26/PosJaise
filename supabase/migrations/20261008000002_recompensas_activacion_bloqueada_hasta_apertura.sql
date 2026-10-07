-- =========================================================
-- Recompensas no se puede ACTIVAR hasta que la apertura se haya autorizado y ejecutado.
--
-- Por qué: recompensas_establecer_activo(true) deja a cualquier ADMINISTRADOR encender el programa desde la interfaz fijando
-- corte = now() SIN haber ejecutado la apertura histórica (conversión ×5). Eso dejaría el programa activo con saldos en cero
-- y un corte equivocado. La activación debe ser parte de la apertura (misma transacción), no un botón suelto.
--
-- Cómo: recompensas_config.apertura_ejecutada_en (nulo = apertura no ejecutada). Ningún rol de la aplicación puede escribirla
-- (no está en la lista de columnas con UPDATE para authenticated): solo la fija la función de apertura al ejecutarse. Mientras
-- sea nula, recompensas_establecer_activo(true) se rechaza con un mensaje claro; APAGAR (false) sigue permitido siempre.
-- No cambia datos existentes: la columna nace nula; activo y corte no se tocan.
-- =========================================================
begin;

alter table public.recompensas_config add column if not exists apertura_ejecutada_en timestamptz;
comment on column public.recompensas_config.apertura_ejecutada_en is
  'Fecha en que se ejecutó la apertura histórica. Nulo = no ejecutada: la activación está bloqueada. La fija solo la función de apertura.';

create or replace function public.recompensas_establecer_activo(p_activo boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede activar Recompensas.';
  end if;
  if p_activo and not exists (select 1 from public.recompensas_config where id = 1 and apertura_ejecutada_en is not null) then
    raise exception 'Recompensas no se puede activar todavía: primero debe autorizarse y ejecutarse la apertura.'
      using errcode = 'P0001';
  end if;
  update public.recompensas_config
  set activo = p_activo,
      corte = case when p_activo then coalesce(corte, now()) else corte end,
      actualizado_en = now()
  where id = 1;
end;
$$;
revoke execute on function public.recompensas_establecer_activo(boolean) from public, anon;
grant execute on function public.recompensas_establecer_activo(boolean) to authenticated;

commit;
