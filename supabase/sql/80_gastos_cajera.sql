-- =========================================================
-- POS Negocio 2 — Gastos: cajera ve/agrega gastos variables (caja chica)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Hasta ahora Gastos era 100% admin (una sola política gastos_admin_todo).
-- Ahora la cajera puede:
--   - ver y agregar gastos VARIABLES (una especie de caja chica) — nunca
--     fijos, esos siguen siendo admin-only tal cual.
--   - de los variables, solo ve los que agregó EL ROL cajera (no los que
--     un admin haya cargado a mano como variable) — visibilidad por rol
--     de quien lo creó, no por fila individual, porque es un cuaderno
--     compartido entre cajeras (cualquiera puede corregir/cancelar lo que
--     cargó otra, ej. en un cambio de turno).
--   - puede editar y cancelar (no eliminar) esos gastos variables.
-- No ve ni puede crear plantillas de gastos fijos — gastos_recurrentes ya
-- es 100% admin desde 15_gastos_recurrentes.sql, no hace falta tocarlo.
--
-- De paso: se agrega quién y cuándo se creó cada gasto (creado_por,
-- creado_en) — antes no quedaba ningún rastro de eso — y un estado
-- ACTIVO/CANCELADO (mismo patrón que registro_servicios/citas/ventas):
-- cancelar ya no borra la fila, solo dispensa de contar en el total.
-- =========================================================

begin;

alter table public.gastos
  add column if not exists creado_por uuid references public.usuarios (id) on delete set null;

alter table public.gastos
  add column if not exists creado_en timestamptz not null default now();

alter table public.gastos
  add column if not exists estado text not null default 'ACTIVO';

alter table public.gastos
  drop constraint if exists gastos_estado_check;

alter table public.gastos
  add constraint gastos_estado_check check (estado in ('ACTIVO', 'CANCELADO'));

drop policy if exists gastos_admin_todo on public.gastos;

create policy gastos_select on public.gastos
  for select to authenticated
  using (
    public.es_admin()
    or (
      public.rol_actual() = 'CAJERA'
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol = 'CAJERA'
      )
    )
  );

create policy gastos_insert on public.gastos
  for insert to authenticated
  with check (
    public.es_admin()
    or (public.rol_actual() = 'CAJERA' and tipo = 'VARIABLE' and creado_por = auth.uid())
  );

create policy gastos_update on public.gastos
  for update to authenticated
  using (
    public.es_admin()
    or (
      public.rol_actual() = 'CAJERA'
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol = 'CAJERA'
      )
    )
  )
  with check (
    public.es_admin()
    or (
      public.rol_actual() = 'CAJERA'
      and tipo = 'VARIABLE'
      and exists (
        select 1 from public.usuarios u
        where u.id = gastos.creado_por and u.rol = 'CAJERA'
      )
    )
  );

create policy gastos_delete_admin on public.gastos
  for delete to authenticated
  using (public.es_admin());

commit;
