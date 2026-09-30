-- =========================================================
-- POS Negocio 2 — Fase 1, script SQL: creación de tablas
-- Ejecutar completo en Supabase → SQL Editor → New query
-- (todavía sin políticas RLS, eso va en un script aparte)
-- =========================================================

begin;

-- Necesaria para generar uuids con gen_random_uuid()
create extension if not exists pgcrypto;

-- =========================================================
-- PASO 1: usuarios
-- id = mismo id que auth.users (1 fila por cada cuenta de login)
-- =========================================================
create table public.usuarios (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null unique,
  nombre_completo text not null,
  rol             text not null check (rol in ('ADMINISTRADOR', 'ASISTENTE')),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

-- =========================================================
-- PASO 2: asistentes
-- Persona que atiende servicios. usuario_id es opcional porque
-- una asistente puede existir sin tener cuenta de login todavía.
-- =========================================================
create table public.asistentes (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid references public.usuarios (id) on delete set null,
  nombres_completos   text not null,
  telefono            text,
  activo              boolean not null default true
);

-- =========================================================
-- PASO 3: productos
-- =========================================================
create table public.productos (
  id             uuid primary key default gen_random_uuid(),
  codigo_barras  text unique,
  nombre         text not null,
  categoria      text,
  precio         numeric(10, 2) not null default 0,
  costo          numeric(10, 2) not null default 0,
  stock_actual   integer not null default 0 check (stock_actual >= 0),
  stock_minimo   integer not null default 0,
  proveedor      text,
  foto_url       text,
  activo         boolean not null default true
);

-- =========================================================
-- PASO 4: servicios (catálogo, el precio del ticket se puede
-- editar aparte en venta_items sin tocar esta tabla)
-- =========================================================
create table public.servicios (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  precio         numeric(10, 2) not null default 0,
  categoria      text,
  duracion_min   integer,
  activo         boolean not null default true
);

-- =========================================================
-- PASO 5: porcentajes
-- % de comisión que gana cada asistente por cada servicio.
-- Hoy solo existe el admin con 100%, pero el modelo ya soporta
-- múltiples asistentes con distintos porcentajes.
-- =========================================================
create table public.porcentajes (
  id            uuid primary key default gen_random_uuid(),
  servicio_id   uuid not null references public.servicios (id) on delete cascade,
  asistente_id  uuid not null references public.asistentes (id) on delete cascade,
  porcentaje    numeric(5, 2) not null default 100 check (porcentaje >= 0 and porcentaje <= 100),
  unique (servicio_id, asistente_id)
);

-- =========================================================
-- PASO 6: ventas
-- El ticket. codigo es el correlativo tipo VEN001, VEN074...
-- =========================================================
create table public.ventas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  fecha           timestamptz not null default now(),
  estado          text not null default 'ACTIVA' check (estado in ('ACTIVA', 'ANULADA')),
  total           numeric(10, 2) not null default 0,
  metodo_pago     text not null check (metodo_pago in ('Efectivo', 'Tarjeta', 'Transferencia', 'Yape')),
  monto_recibido  numeric(10, 2),
  vendedor_id     uuid not null references public.usuarios (id) on delete restrict
);

-- =========================================================
-- PASO 7: venta_items
-- Líneas del ticket: pueden ser PRODUCTO o SERVICIO mezclados.
-- =========================================================
create table public.venta_items (
  id                   uuid primary key default gen_random_uuid(),
  venta_id             uuid not null references public.ventas (id) on delete cascade,
  tipo                 text not null check (tipo in ('PRODUCTO', 'SERVICIO')),
  producto_id          uuid references public.productos (id) on delete set null,
  servicio_id          uuid references public.servicios (id) on delete set null,
  asistente_id         uuid references public.asistentes (id) on delete set null,
  nombre               text not null,
  cantidad             integer not null default 1,
  precio_unitario      numeric(10, 2) not null default 0,
  subtotal             numeric(10, 2) not null default 0,
  porcentaje_aplicado  numeric(5, 2),
  pago_asistente       numeric(10, 2),
  check (
    (tipo = 'PRODUCTO' and producto_id is not null and servicio_id is null)
    or
    (tipo = 'SERVICIO' and servicio_id is not null and producto_id is null)
  )
);

-- =========================================================
-- PASO 8: movimientos_stock
-- Historial de cada vez que se agrega stock a un producto.
-- =========================================================
create table public.movimientos_stock (
  id                 uuid primary key default gen_random_uuid(),
  producto_id        uuid not null references public.productos (id) on delete cascade,
  cantidad_agregada  integer not null,
  stock_anterior     integer not null,
  stock_nuevo        integer not null,
  nota               text,
  fecha              timestamptz not null default now(),
  usuario_id         uuid references public.usuarios (id) on delete set null
);

-- =========================================================
-- PASO 9: gastos
-- =========================================================
create table public.gastos (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo   text,
  monto  numeric(10, 2) not null default 0,
  mes    integer not null check (mes between 1 and 12),
  anio   integer not null
);

-- =========================================================
-- PASO 10: auditoria
-- Log genérico de cambios (no lleva FKs, guarda todo como texto).
-- =========================================================
create table public.auditoria (
  id             uuid primary key default gen_random_uuid(),
  fecha          timestamptz not null default now(),
  usuario_email  text,
  tabla          text not null,
  registro_id    text,
  campo          text,
  valor_anterior text,
  valor_nuevo    text
);

-- =========================================================
-- Índices para las columnas que más se van a filtrar/joinear
-- =========================================================
create index idx_asistentes_usuario_id      on public.asistentes (usuario_id);
create index idx_porcentajes_servicio_id    on public.porcentajes (servicio_id);
create index idx_porcentajes_asistente_id   on public.porcentajes (asistente_id);
create index idx_ventas_fecha               on public.ventas (fecha);
create index idx_ventas_vendedor_id         on public.ventas (vendedor_id);
create index idx_venta_items_venta_id       on public.venta_items (venta_id);
create index idx_venta_items_producto_id    on public.venta_items (producto_id);
create index idx_venta_items_servicio_id    on public.venta_items (servicio_id);
create index idx_venta_items_asistente_id   on public.venta_items (asistente_id);
create index idx_movimientos_producto_id    on public.movimientos_stock (producto_id);
create index idx_auditoria_tabla            on public.auditoria (tabla);

commit;
