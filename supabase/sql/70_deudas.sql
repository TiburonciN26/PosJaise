-- =========================================================
-- POS Negocio 2 — Deudas de clientes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Cuaderno de deudas vinculado a Clientes: quién debe, desde cuándo, por
-- qué servicio/motivo y cuánto. NO participa en ninguna métrica del
-- negocio (Dashboard/Estadísticas/resumen_*) — es solo un registro manual
-- para que el personal sepa a quién cobrarle, nada más. Solo admin, mismo
-- alcance que la pestaña Clientes de la que cuelga en el menú.
-- =========================================================

begin;

create table public.deudas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  concepto    text not null,
  monto       numeric(10,2) not null,
  fecha       date not null,
  estado      text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'COBRADA')),
  nota        text,
  creado_por  uuid references public.usuarios (id) on delete set null,
  cobrado_en  timestamptz,
  creado_en   timestamptz not null default now()
);

create index idx_deudas_cliente_id on public.deudas (cliente_id);

alter table public.deudas enable row level security;

-- Grants explícitos: en este proyecto "authenticated" no recibe
-- select/insert/update/delete por defecto en una tabla nueva, hace falta
-- otorgarlo aparte de las políticas RLS (mismo patrón que cita_servicios).
grant select, insert, update, delete on public.deudas to authenticated;

create policy deudas_select on public.deudas
  for select to authenticated
  using (public.es_admin());

create policy deudas_insert on public.deudas
  for insert to authenticated
  with check (public.es_admin());

create policy deudas_update on public.deudas
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy deudas_delete on public.deudas
  for delete to authenticated
  using (public.es_admin());

commit;
