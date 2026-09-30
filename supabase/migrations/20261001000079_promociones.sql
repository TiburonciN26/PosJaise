-- =========================================================
-- POS Negocio 2 — Pestaña Web: Promociones
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 78_fidelizacion_web.sql ya se haya corrido.
--
-- Primera sección administrativa real de la pestaña "Web" del POS (que
-- hasta ahora era el placeholder "Web... Próximamente"). Admin-only:
-- las crea/edita/desactiva el administrador, el cliente solo lee las
-- que están activas y vigentes.
--
-- vigente_desde/vigente_hasta son opcionales — null en cualquiera de
-- las dos significa "sin límite" en ese extremo (siempre vigente desde
-- el principio / sin fecha de fin). La comparación de "hoy" usa
-- at time zone 'America/Lima', mismo criterio que el resto del
-- proyecto (ver es_hoy() en 12_fix_zona_horaria_es_hoy.sql) — comparar
-- contra current_date a secas depende de la zona horaria de sesión.
-- =========================================================

begin;

create table public.promociones (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  descripcion     text,
  tipo_descuento  text not null check (tipo_descuento in ('PORCENTAJE', 'MONTO_FIJO')),
  valor           numeric(10, 2) not null check (valor > 0),
  vigente_desde   date,
  vigente_hasta   date,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

alter table public.promociones enable row level security;

grant select, insert, update, delete on public.promociones to authenticated;

create policy promociones_admin_todo on public.promociones
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy promociones_select_web on public.promociones
  for select to authenticated
  using (
    activo = true
    and (vigente_desde is null or vigente_desde <= (now() at time zone 'America/Lima')::date)
    and (vigente_hasta is null or vigente_hasta >= (now() at time zone 'America/Lima')::date)
  );

commit;
