-- =========================================================
-- POS Negocio 2 — Fase 1: políticas RLS (seguridad por rol)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 01_tablas.sql y 02_rename_gastos_anio.sql ya
-- se hayan corrido.
-- =========================================================

begin;

-- =========================================================
-- Funciones auxiliares
-- SECURITY DEFINER: corren con permisos elevados para poder
-- leer "usuarios" sin generar un bucle de RLS sobre sí misma.
-- =========================================================

create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rol
  from public.usuarios
  where id = auth.uid()
    and activo = true;
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.rol_actual() = 'ADMINISTRADOR';
$$;

create or replace function public.es_hoy(ts timestamptz)
returns boolean
language sql
stable
as $$
  select ts::date = now()::date;
$$;

grant execute on function public.rol_actual() to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.es_hoy(timestamptz) to authenticated;

-- =========================================================
-- 1. usuarios
-- Cada quien ve su propia fila; el admin ve todas.
-- Solo el admin crea / edita / borra usuarios.
-- =========================================================
alter table public.usuarios enable row level security;

-- Sin este GRANT, "authenticated" no tiene ni el permiso base para
-- intentar leer/escribir la tabla, sin importar qué digan las
-- políticas de abajo (RLS solo filtra FILAS, no reemplaza el GRANT).
grant select, insert, update, delete on public.usuarios to authenticated;

create policy usuarios_select on public.usuarios
  for select to authenticated
  using (id = auth.uid() or public.es_admin());

create policy usuarios_insert_admin on public.usuarios
  for insert to authenticated
  with check (public.es_admin());

create policy usuarios_update_admin on public.usuarios
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy usuarios_delete_admin on public.usuarios
  for delete to authenticated
  using (public.es_admin());

-- =========================================================
-- 2. asistentes
-- Cualquiera logueado puede leer la lista (se necesita para
-- elegir "quién atendió"). Solo el admin la gestiona.
-- =========================================================
alter table public.asistentes enable row level security;

grant select, insert, update, delete on public.asistentes to authenticated;

create policy asistentes_select on public.asistentes
  for select to authenticated
  using (true);

create policy asistentes_insert_admin on public.asistentes
  for insert to authenticated
  with check (public.es_admin());

create policy asistentes_update_admin on public.asistentes
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy asistentes_delete_admin on public.asistentes
  for delete to authenticated
  using (public.es_admin());

-- =========================================================
-- 3. productos
-- Todos leen el catálogo (nombre, precio, stock...). Solo el
-- admin crea / edita / borra productos.
-- "Agregar stock" del asistente se resuelve con una función
-- RPC (Fase 4) que solo toca stock_actual, no esta política.
--
-- "costo" es la columna sensible (de ahí sale la ganancia).
-- RLS es por FILA, no por columna, y además admin y asistente
-- comparten el mismo rol de Postgres ("authenticated"), así que
-- una política RLS normal no puede diferenciarlos para ocultar
-- una sola columna. La solución real es:
--   1) Quitarle a "authenticated" el permiso de leer "costo"
--      directamente de la tabla (columna por columna).
--   2) Crear una vista "productos_vista" que sí puede leer
--      "costo" (corre con los permisos de su dueño, no los del
--      que consulta) y decide fila por fila, con es_admin(),
--      si te la muestra o te devuelve NULL.
-- Todo el mundo (app de asistente Y de admin) debe leer
-- productos desde "productos_vista", no desde la tabla cruda.
-- La tabla cruda solo se usa para escribir (INSERT/UPDATE/
-- DELETE), que ya está limitado a admin por las políticas de
-- abajo.
-- =========================================================
alter table public.productos enable row level security;

-- INSERT/UPDATE/DELETE completos (SELECT se maneja aparte, más
-- abajo, columna por columna, para poder ocultar "costo").
grant insert, update, delete on public.productos to authenticated;

create policy productos_select on public.productos
  for select to authenticated
  using (true);

create policy productos_insert_admin on public.productos
  for insert to authenticated
  with check (public.es_admin());

create policy productos_update_admin on public.productos
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy productos_delete_admin on public.productos
  for delete to authenticated
  using (public.es_admin());

-- Le quitamos a "authenticated" el SELECT general de la tabla
-- y se lo devolvemos columna por columna, sin incluir "costo".
-- Así, ni admin ni asistente pueden leer "costo" consultando la
-- tabla productos directamente (ni siquiera a mano por la API).
revoke select on public.productos from authenticated;

grant select (
  id, codigo_barras, nombre, categoria, precio,
  stock_actual, stock_minimo, proveedor, foto_url, activo
) on public.productos to authenticated;

-- Vista de lectura: esta sí puede ver "costo" (corre con los
-- permisos del dueño de la vista, no los de authenticated), y
-- lo enmascara con NULL salvo que quien consulta sea admin.
create or replace view public.productos_vista
with (security_invoker = false)
as
select
  id,
  codigo_barras,
  nombre,
  categoria,
  precio,
  case when public.es_admin() then costo end as costo,
  stock_actual,
  stock_minimo,
  proveedor,
  foto_url,
  activo
from public.productos;

grant select on public.productos_vista to authenticated;

-- =========================================================
-- 4. servicios
-- Todos consultan el catálogo de precios. Solo el admin
-- lo gestiona.
-- =========================================================
alter table public.servicios enable row level security;

grant select, insert, update, delete on public.servicios to authenticated;

create policy servicios_select on public.servicios
  for select to authenticated
  using (true);

create policy servicios_insert_admin on public.servicios
  for insert to authenticated
  with check (public.es_admin());

create policy servicios_update_admin on public.servicios
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy servicios_delete_admin on public.servicios
  for delete to authenticated
  using (public.es_admin());

-- =========================================================
-- 5. porcentajes
-- Exclusivo del admin: ni lectura para el asistente.
-- =========================================================
alter table public.porcentajes enable row level security;

grant select, insert, update, delete on public.porcentajes to authenticated;

create policy porcentajes_admin_todo on public.porcentajes
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- =========================================================
-- 6. ventas
-- Admin ve todas. Asistente ve solo las de HOY.
-- Cualquiera logueado crea una venta, pero solo puede quedar
-- como vendedor_id él mismo.
-- Anular/editar una venta por SQL directo: solo admin
-- (la anulación del asistente, limitada a hoy, va por RPC
-- en Fase 4, porque debe devolver stock de forma segura).
-- =========================================================
alter table public.ventas enable row level security;

-- No hay DELETE: una venta nunca se borra, solo se anula.
grant select, insert, update on public.ventas to authenticated;

create policy ventas_select on public.ventas
  for select to authenticated
  using (
    public.es_admin()
    or (public.rol_actual() = 'ASISTENTE' and public.es_hoy(fecha))
  );

create policy ventas_insert on public.ventas
  for insert to authenticated
  with check (
    public.rol_actual() is not null
    and vendedor_id = auth.uid()
  );

create policy ventas_update_admin on public.ventas
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- =========================================================
-- 7. venta_items
-- Hereda la visibilidad de su venta. Solo se insertan líneas
-- de una venta propia. No se editan ni se borran (historia).
-- =========================================================
alter table public.venta_items enable row level security;

-- Solo se leen e insertan; nunca se editan ni se borran (historia).
grant select, insert on public.venta_items to authenticated;

create policy venta_items_select on public.venta_items
  for select to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          public.es_admin()
          or (public.rol_actual() = 'ASISTENTE' and public.es_hoy(v.fecha))
        )
    )
  );

create policy venta_items_insert on public.venta_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and v.vendedor_id = auth.uid()
    )
  );

-- =========================================================
-- 8. movimientos_stock
-- Todos leen el historial de cargas de stock. Solo se inserta
-- a nombre propio. Nadie edita ni borra (log de solo-agregar).
-- =========================================================
alter table public.movimientos_stock enable row level security;

-- Log de solo-agregar: se lee y se inserta, nunca se edita/borra.
grant select, insert on public.movimientos_stock to authenticated;

create policy movimientos_select on public.movimientos_stock
  for select to authenticated
  using (true);

create policy movimientos_insert on public.movimientos_stock
  for insert to authenticated
  with check (usuario_id = auth.uid());

-- =========================================================
-- 9. gastos
-- 100% exclusivo del admin.
-- =========================================================
alter table public.gastos enable row level security;

grant select, insert, update, delete on public.gastos to authenticated;

create policy gastos_admin_todo on public.gastos
  for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- =========================================================
-- 10. auditoria
-- Solo el admin puede leerla. Las escrituras las hará el
-- sistema (trigger/RPC) en Fase 6, no el cliente directo.
-- =========================================================
alter table public.auditoria enable row level security;

-- Solo lectura para el cliente; las escrituras llegan por
-- trigger/RPC (Fase 6), que corre con permisos propios.
grant select on public.auditoria to authenticated;

create policy auditoria_select_admin on public.auditoria
  for select to authenticated
  using (public.es_admin());

commit;
