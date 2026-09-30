-- =========================================================
-- productos: falta el GRANT SELECT de precio_antes para authenticated
-- Ejecutar en Supabase → SQL Editor → New query
-- Fix reportado por el usuario: el carrito web no mostraba NINGÚN
-- producto (ni el nuevo, ni ninguno) — consola con 403 real en la
-- consulta que junta carrito_productos con productos(...).
--
-- Causa real: los GRANT de `productos` en este proyecto son POR
-- COLUMNA para SELECT (probablemente para esconder `costo` de
-- clientes/asistentes directos, dejándolo visible solo a través de
-- productos_vista) — confirmado con information_schema.column_
-- privileges: `costo` no tiene SELECT para `authenticated`, pero
-- `proveedor`/`precio`/etc. sí. INSERT/UPDATE/REFERENCES sí están a
-- nivel de TABLA completa (por eso `precio_antes`, agregada en
-- 104_precio_antes_productos.sql, ya tenía esos 3 automáticamente) —
-- pero SELECT nunca se otorgó explícito para la columna nueva, así
-- que quedó sin poder leerse, rompiendo cualquier consulta que la
-- pidiera (CarritoCliente.jsx la pide desde §8.13).
--
-- Ver memoria del proyecto "Grants no automáticos en Supabase" — esta
-- vez el hueco no fue una tabla nueva sin grant, fue una columna nueva
-- en una tabla cuyo grant de SELECT ya era por columna, no por tabla.
-- =========================================================

begin;

grant select (precio_antes) on public.productos to authenticated;

commit;
