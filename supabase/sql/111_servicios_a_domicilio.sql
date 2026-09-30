-- =========================================================
-- Migración 5/10 del rediseño de Servicios/Detalle: "a domicilio" por
-- servicio (equivalente al "envío" de un producto).
-- Ejecutar en Supabase → SQL Editor → New query
--
-- costo_domicilio null o 0 = gratis; > 0 = costo adicional fijo que se
-- suma al precio del servicio cuando se hace a domicilio. No se
-- reutiliza `zonas_delivery` (85_carrito_pedidos_web.sql, envío de
-- PRODUCTOS): son conceptos distintos — ahí es a dónde se envía un
-- pedido, acá es si la ESTILISTA se traslada para ese servicio puntual.
-- =========================================================

begin;

alter table public.servicios add column if not exists a_domicilio boolean not null default false;
alter table public.servicios add column if not exists costo_domicilio numeric(10, 2) check (costo_domicilio is null or costo_domicilio >= 0);

commit;
