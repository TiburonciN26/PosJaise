-- Gastos POS: los gastos fijos de las plantillas (gastos_recurrentes activas) se crean SOLOS cada mes.
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): hasta ahora la administradora tenía que entrar a Gastos y pulsar «Crear
-- gastos fijos del mes» en cada mes. Si se olvidaba, Dashboard, Estadísticas y el punto de equilibrio calculaban el mes
-- sin sus gastos fijos.
--
-- CÓMO FUNCIONA:
--   * generar_gastos_fijos_mes(): crea en «gastos» una fila FIJO por cada plantilla activa para el mes en curso (hora de
--     Lima). La corre pg_cron todos los días a las 00:05 de Lima (05:05 UTC), no solo el día 1: si una corrida se pierde,
--     la del día siguiente la cubre.
--   * gastos_fijos_generados: marca qué meses ya se generaron solos. Cada mes se genera UNA sola vez, así que si la admin
--     borra o cancela un gasto fijo de ese mes, el sistema no lo vuelve a crear al día siguiente.
--   * No duplica: si la admin ya creó a mano un gasto fijo con el mismo nombre ese mes, el índice único
--     gastos_fijo_mes_anio_unique (nombre, mes, anio where tipo = 'FIJO') lo salta (on conflict do nothing).
--   * El botón «Crear gastos fijos del mes» sigue sirviendo para una plantilla nueva a mitad de mes o para un mes pasado.
--   * creado_por queda null (no hay sesión) y el registro de Auditoría se marca «Automático (gastos fijos)», igual que el
--     cierre automático del POS (20261112000005).
--
-- PRODUCCIÓN: pg_cron ya está activo (20261112000005); el create extension es por si acaso. Al aplicar se genera de una
-- vez el mes en curso.

begin;

create extension if not exists pg_cron with schema pg_catalog;

create table public.gastos_fijos_generados (
  anio        smallint not null,
  mes         smallint not null check (mes between 1 and 12),
  generado_en timestamptz not null default now(),
  primary key (anio, mes)
);

comment on table public.gastos_fijos_generados is
  'Meses en que generar_gastos_fijos_mes() ya creó los gastos fijos de las plantillas (se generan una sola vez por mes).';

-- Solo la usa la función (security definer): nadie la lee ni la escribe desde la app.
alter table public.gastos_fijos_generados enable row level security;
revoke all on table public.gastos_fijos_generados from public, anon, authenticated;

-- Devuelve cuántos gastos fijos creó (0 si el mes ya estaba generado o no hay plantillas activas).
create or replace function public.generar_gastos_fijos_mes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_mes   smallint := extract(month from v_hoy)::smallint;
  v_anio  smallint := extract(year from v_hoy)::smallint;
  v_total integer;
begin
  insert into public.gastos_fijos_generados (anio, mes) values (v_anio, v_mes)
  on conflict (anio, mes) do nothing;
  if not found then
    return 0;
  end if;

  insert into public.gastos (nombre, tipo, monto, mes, anio, creado_por)
  select r.nombre, 'FIJO', r.monto, v_mes, v_anio, null
  from public.gastos_recurrentes r
  where r.activo
  on conflict (nombre, mes, anio) where tipo = 'FIJO' do nothing;
  get diagnostics v_total = row_count;

  -- El trigger de auditoría no tiene usuario (corre sin sesión): marcar esos registros como automáticos.
  -- now() es el mismo en toda la transacción, igual que el default de auditoria.fecha.
  if v_total > 0 then
    update public.auditoria
       set usuario_email = 'Automático (gastos fijos)'
     where tabla = 'gastos' and fecha = now() and usuario_email is null;
  end if;

  return v_total;
end;
$$;

revoke execute on function public.generar_gastos_fijos_mes() from public, anon, authenticated;

-- Nombre fijo: volver a correr esta línea actualiza el job en vez de duplicarlo. 05:05 UTC = 00:05 en Lima.
select cron.schedule('generar-gastos-fijos-mes', '5 5 * * *', 'select public.generar_gastos_fijos_mes()');

-- Mes en curso: generarlo ya, sin esperar a la primera corrida.
select public.generar_gastos_fijos_mes();

commit;
