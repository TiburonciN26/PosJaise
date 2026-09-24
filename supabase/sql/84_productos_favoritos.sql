-- =========================================================
-- POS Negocio 2 — Pestaña Web: catálogo de productos + favoritos
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 83_equipo_web.sql ya se haya corrido.
--
-- Mismo patrón que 68_servicios_favoritos.sql para servicios:
-- productos_select (endurecida en 62_clientes_web.sql a
-- "rol_actual() is not null", staff-only a propósito) se reabre para
-- los productos ACTIVOS — es el catálogo público del negocio, no un
-- dato sensible. El costo sigue oculto para todos salvo admin (eso ya
-- lo resuelve 03_rls.sql a nivel de columna/vista, sin relación con
-- esta política de filas — no se toca).
--
-- Decisión confirmada por el usuario sobre el stock: un producto sin
-- stock (stock_actual = 0) SIGUE apareciendo en el catálogo (para que
-- la clienta lo vea/guarde en favoritos/pregunte por él), con una
-- etiqueta "Agotado" del lado del frontend — no se filtra acá.
--
-- favoritos_productos es una lista 100% personal del cliente, igual
-- que favoritos_servicios.
-- =========================================================

begin;

drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos
  for select to authenticated
  using (public.rol_actual() is not null or activo = true);

create table public.favoritos_productos (
  cliente_web_id uuid not null references public.clientes_web (id) on delete cascade,
  producto_id    uuid not null references public.productos (id) on delete cascade,
  creado_en      timestamptz not null default now(),
  primary key (cliente_web_id, producto_id)
);

alter table public.favoritos_productos enable row level security;

grant select, insert, delete on public.favoritos_productos to authenticated;

create policy favoritos_productos_select on public.favoritos_productos
  for select to authenticated
  using (cliente_web_id = auth.uid());

create policy favoritos_productos_insert on public.favoritos_productos
  for insert to authenticated
  with check (cliente_web_id = auth.uid());

create policy favoritos_productos_delete on public.favoritos_productos
  for delete to authenticated
  using (cliente_web_id = auth.uid());

commit;
