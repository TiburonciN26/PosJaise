-- =========================================================
-- Migración 4/8 del rediseño de Productos/Detalle: presentaciones
-- (ej. "250 ml" / "500 ml" de un mismo producto), en tabla aparte —
-- decisión confirmada con el usuario sobre las dos opciones del README.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Solo el esquema por ahora: esta migración NO toca `carrito_productos`
-- ni `pedidos_web_items` (hoy referencian `producto_id` a secas, sin
-- variante) ni el flujo de "cantidad + Agregar al carrito" del Detalle —
-- eso es una integración aparte (decidir si el carrito pasa a guardar
-- variante_id, cómo se resuelve el stock por variante en
-- confirmar_pedido_productos(), etc.), fuera del alcance de esta tanda
-- de migraciones. Mientras tanto, un producto CON variantes sigue
-- comprándose por su fila base en productos (precio/stock_actual
-- propios), y `producto_variantes` queda lista para cuando se haga esa
-- integración.
--
-- Sin columna "costo": a diferencia de productos, no hay nada sensible
-- que ocultar acá, así que el SELECT va a nivel de tabla completa, no
-- por columna.
-- =========================================================

begin;

create table public.producto_variantes (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references public.productos(id) on delete cascade,
  etiqueta      text not null,
  precio        numeric(10, 2) not null check (precio > 0),
  precio_antes  numeric(10, 2) check (precio_antes is null or precio_antes > precio),
  stock_actual  integer not null default 0 check (stock_actual >= 0),
  rinde         text,
  orden         int not null default 0,
  created_at    timestamptz not null default now()
);

create index producto_variantes_producto_id_idx on public.producto_variantes (producto_id, orden);

alter table public.producto_variantes enable row level security;

grant select, insert, update, delete on public.producto_variantes to authenticated;

create policy producto_variantes_select on public.producto_variantes
  for select to authenticated
  using (
    public.rol_actual() is not null
    or exists (
      select 1 from public.productos p
      where p.id = producto_variantes.producto_id and p.activo = true
    )
  );

create policy producto_variantes_insert_admin on public.producto_variantes
  for insert to authenticated
  with check (public.es_admin());

create policy producto_variantes_update_admin on public.producto_variantes
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy producto_variantes_delete_admin on public.producto_variantes
  for delete to authenticated
  using (public.es_admin());

commit;
