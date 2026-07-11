-- =========================================================
-- POS Negocio 2 — limpieza de ventas de prueba
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Asume que TODAS las ventas que hay hoy en la tabla son de
-- prueba (2, según confirmaste) — por eso borra todo en vez
-- de filtrar por código. Si más adelante tienes ventas reales
-- que sí quieres conservar, avisa antes de correr esto de nuevo.
-- =========================================================

begin;

-- 1) Devuelve al stock lo que se descontó por esas ventas
update public.productos p
set stock_actual = p.stock_actual + resumen.cantidad_total
from (
  select producto_id, sum(cantidad) as cantidad_total
  from public.venta_items
  where tipo = 'PRODUCTO'
  group by producto_id
) resumen
where p.id = resumen.producto_id;

-- 2) Borra las líneas y las ventas de prueba
delete from public.venta_items;
delete from public.ventas;

-- 3) Reinicia el correlativo: la próxima venta será VEN001
select setval('public.ventas_codigo_seq', 1, false);

commit;
