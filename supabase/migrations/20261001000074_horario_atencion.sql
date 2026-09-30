-- =========================================================
-- POS Negocio 2 — Pestaña Web: horario de atención (para Citas Web)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 69_servicios_foto.sql ya se haya corrido.
--
-- No existía ninguna noción de "el negocio abre de tal a tal hora" en
-- toda la base — solo estado_negocio.abierto (sí/no del día, lo prende/
-- apaga el admin a mano). Hace falta un horario real para poder calcular
-- qué horarios ofrecerle a un cliente al agendar una cita desde la Web.
--
-- MVP: un solo horario, igual todos los días que atiende (no hay horario
-- distinto por día de semana más allá de cuáles días atiende). Horario
-- real dado por el negocio: lunes a sábado, 10:00-13:00 y 15:00-20:30
-- (domingo cerrado). dias_atencion usa el número ISO de día de semana
-- (1=lunes … 7=domingo, el que devuelve extract(isodow from fecha)).
--
-- No se abre estado_negocio a "authenticated" en general (sigue
-- staff-only desde 62_clientes_web.sql) — un cliente lee el horario vía
-- la función horario_atencion(), no la tabla directo.
-- =========================================================

begin;

alter table public.estado_negocio
  add column if not exists dias_atencion int[] not null default '{1,2,3,4,5,6}',
  add column if not exists bloque1_inicio time,
  add column if not exists bloque1_fin time,
  add column if not exists bloque2_inicio time,
  add column if not exists bloque2_fin time;

update public.estado_negocio
set dias_atencion = '{1,2,3,4,5,6}',
    bloque1_inicio = '10:00',
    bloque1_fin = '13:00',
    bloque2_inicio = '15:00',
    bloque2_fin = '20:30'
where id = 1;

create or replace function public.horario_atencion()
returns table (
  dias_atencion  int[],
  bloque1_inicio time,
  bloque1_fin    time,
  bloque2_inicio time,
  bloque2_fin    time
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select dias_atencion, bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin
  from public.estado_negocio
  where id = 1;
$$;

grant execute on function public.horario_atencion() to authenticated;
revoke execute on function public.horario_atencion() from public;

commit;
