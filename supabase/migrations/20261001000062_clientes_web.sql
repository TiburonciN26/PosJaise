-- =========================================================
-- POS Negocio 2 — Pestaña Web: registro y login de clientes
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Los clientes NO son personal (usuarios): se auto-registran con
-- correo/contraseña desde la propia pestaña Web, sin que un admin
-- los cree a mano. Por eso viven en una tabla aparte (clientes_web),
-- desacoplada de "usuarios" (personal, rol ADMINISTRADOR/CAJERA/
-- ASISTENTE, solo el admin puede insertar filas ahí).
--
-- Efecto colateral importante y deseado: rol_actual() (03_rls.sql)
-- solo mira la tabla "usuarios". Un cliente web no tiene fila ahí,
-- así que rol_actual() le devuelve null — con eso, cualquier
-- política que ya exigía "rol_actual() is not null" lo bloquea
-- automáticamente, a nivel de base de datos (no solo de UI).
--
-- Antes de esto, varias tablas (asistentes, productos, servicios,
-- movimientos_stock, clientes, estado_negocio) tenían su SELECT en
-- "using (true)" — cualquier cuenta autenticada las leía completas.
-- Hasta ahora eso era inofensivo: la única forma de tener una cuenta
-- autenticada era que el admin la creara a mano (personal de
-- confianza). Con el auto-registro de clientes eso deja de ser
-- cierto, así que esas políticas se endurecen acá al mismo patrón
-- que ya usan citas/cita_servicios: "rol_actual() is not null".
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. clientes_web
-- Cada quien ve/edita solo su propia fila. Sin política de admin
-- por ahora (no hay pantalla de gestión todavía) y sin DELETE
-- (que el cliente se dé de baja es una función aparte, más adelante).
-- ---------------------------------------------------------
create table public.clientes_web (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  nombre_completo text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

alter table public.clientes_web enable row level security;

grant select, insert, update on public.clientes_web to authenticated;

create policy clientes_web_select on public.clientes_web
  for select to authenticated
  using (id = auth.uid());

create policy clientes_web_insert on public.clientes_web
  for insert to authenticated
  with check (id = auth.uid());

create policy clientes_web_update on public.clientes_web
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------
-- 2. Endurecer los "using (true)" que quedaban abiertos a
-- cualquier autenticado (ver nota arriba).
-- ---------------------------------------------------------
drop policy if exists asistentes_select on public.asistentes;
create policy asistentes_select on public.asistentes
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists movimientos_select on public.movimientos_stock;
create policy movimientos_select on public.movimientos_stock
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (public.rol_actual() is not null);

drop policy if exists estado_negocio_select on public.estado_negocio;
create policy estado_negocio_select on public.estado_negocio
  for select to authenticated
  using (public.rol_actual() is not null);

commit;
