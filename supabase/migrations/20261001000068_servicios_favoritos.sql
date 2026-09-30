-- =========================================================
-- POS Negocio 2 — Pestaña Web: catálogo de servicios + favoritos
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 67_clientes_direccion.sql ya se haya corrido.
--
-- servicios_select (endurecida en 62_clientes_web.sql a
-- "rol_actual() is not null", staff-only a propósito) necesita abrirse
-- un poco: el catálogo de precios ACTIVOS es justamente lo que un
-- cliente necesita ver para elegir qué agendar — es información
-- pública del negocio, no un dato sensible. Los servicios inactivos
-- (descontinuados) siguen siendo solo del personal.
--
-- favoritos_servicios es una lista 100% personal del cliente — a
-- diferencia de "clientes", no hay razón de negocio para que el
-- personal la lea o administre.
-- =========================================================

begin;

drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios
  for select to authenticated
  using (public.rol_actual() is not null or activo = true);

create table public.favoritos_servicios (
  cliente_web_id uuid not null references public.clientes_web (id) on delete cascade,
  servicio_id    uuid not null references public.servicios (id) on delete cascade,
  creado_en      timestamptz not null default now(),
  primary key (cliente_web_id, servicio_id)
);

alter table public.favoritos_servicios enable row level security;

grant select, insert, delete on public.favoritos_servicios to authenticated;

create policy favoritos_servicios_select on public.favoritos_servicios
  for select to authenticated
  using (cliente_web_id = auth.uid());

create policy favoritos_servicios_insert on public.favoritos_servicios
  for insert to authenticated
  with check (cliente_web_id = auth.uid());

create policy favoritos_servicios_delete on public.favoritos_servicios
  for delete to authenticated
  using (cliente_web_id = auth.uid());

commit;
