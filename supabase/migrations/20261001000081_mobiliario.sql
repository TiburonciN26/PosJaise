-- =========================================================
-- POS Negocio 2 — Mobiliario: catálogo de muebles/equipo + historial de
-- compras por proveedor (para comparar precios en el tiempo)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Dos tablas, no una: "mobiliario" es la FICHA del mueble/modelo (nombre,
-- categoría, especificaciones físicas, dónde está y en qué estado hoy).
-- "mobiliario_compras" es cada vez que se compró ESE mueble — con su
-- propio proveedor, precio, fecha, comprobante y garantía. Si el mismo
-- mueble se vuelve a comprar (otro proveedor, otro precio, para otra
-- sede), queda como una fila más debajo de la misma ficha, sin perder el
-- historial — así se puede comparar precio/proveedor de un mismo artículo
-- a través del tiempo, que es justo lo que se pidió.
--
-- 100% admin, mismo nivel que Asistentes — no hace falta rol nuevo.
-- =========================================================

begin;

create table public.mobiliario (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  categoria    text,
  marca        text,
  modelo       text,
  material     text,
  color        text,
  alto_cm      numeric(6, 1),
  ancho_cm     numeric(6, 1),
  profundidad_cm numeric(6, 1),
  peso_kg      numeric(6, 2),
  foto_url     text,
  ubicacion    text,
  condicion    text not null default 'BUENO'
    check (condicion in ('BUENO', 'REGULAR', 'NECESITA_REPARACION', 'DE_BAJA')),
  notas        text,
  activo       boolean not null default true,
  creado_por   uuid references public.usuarios (id) on delete set null,
  creado_en    timestamptz not null default now()
);

create table public.mobiliario_compras (
  id                  uuid primary key default gen_random_uuid(),
  mobiliario_id       uuid not null references public.mobiliario (id) on delete cascade,
  cantidad            integer not null default 1 check (cantidad > 0),
  precio_unitario     numeric(10, 2) not null check (precio_unitario >= 0),
  precio_total        numeric(10, 2) not null check (precio_total >= 0),
  fecha               date not null,
  numero_comprobante  text,
  metodo_pago         text check (metodo_pago in ('Efectivo', 'Tarjeta', 'Transferencia', 'Yape')),
  condicion_compra    text not null default 'NUEVO' check (condicion_compra in ('NUEVO', 'USADO')),
  garantia_meses      integer check (garantia_meses is null or garantia_meses >= 0),
  garantia_detalle    text,
  proveedor_nombre    text not null,
  proveedor_telefono  text,
  proveedor_direccion text,
  proveedor_web       text,
  proveedor_contacto  text,
  link_producto       text,
  notas               text,
  creado_por          uuid references public.usuarios (id) on delete set null,
  creado_en           timestamptz not null default now()
);

create index idx_mobiliario_compras_mobiliario_id on public.mobiliario_compras (mobiliario_id);

alter table public.mobiliario enable row level security;
alter table public.mobiliario_compras enable row level security;

-- Grants explícitos: "authenticated" no recibe select/insert/update/delete
-- por defecto en este proyecto — hace falta otorgarlo aparte de la RLS.
grant select, insert, update, delete on public.mobiliario to authenticated;
grant select, insert, update, delete on public.mobiliario_compras to authenticated;

create policy mobiliario_admin_todo on public.mobiliario
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy mobiliario_compras_admin_todo on public.mobiliario_compras
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

commit;
