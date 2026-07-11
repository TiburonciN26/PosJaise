-- =========================================================
-- POS Negocio 2 — Fase 6: Mi Panel (registro personal de atenciones)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- registro_servicios es el control PERSONAL de quien atiende un
-- servicio (hoy solo el admin, a futuro también asistentes con
-- login propio). Está completamente aislado de ventas/venta_items:
-- ningún cálculo de ingreso oficial lee de esta tabla, así que no
-- hay riesgo de doble conteo. Sirve solo para que cada usuario
-- lleve su propia cuenta y la compare manualmente contra caja.
--
-- servicio_id/cliente_id van "on delete set null" (igual que
-- venta_items) para no romper el historial si algún día se borra
-- un servicio o cliente.
--
-- RLS: el administrador ve y edita TODOS los registros (de
-- cualquier usuario); cada usuario no-admin ve y edita SOLO los
-- suyos (usuario_id = auth.uid()).
-- =========================================================

begin;

create table public.registro_servicios (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios (id) on delete cascade,
  servicio_id  uuid references public.servicios (id) on delete set null,
  cliente_id   uuid references public.clientes (id) on delete set null,
  precio       numeric(10, 2) not null default 0,
  fecha        timestamptz not null default now(),
  nota         text
);

alter table public.registro_servicios enable row level security;

grant select, insert, update, delete on public.registro_servicios to authenticated;

create policy registro_servicios_acceso on public.registro_servicios
  for all to authenticated
  using (public.es_admin() or usuario_id = auth.uid())
  with check (public.es_admin() or usuario_id = auth.uid());

commit;
