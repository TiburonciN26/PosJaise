-- =========================================================
-- POS Negocio 2 — Fase 3: datos de prueba
-- Ejecutar en Supabase → SQL Editor → New query
-- Negocio tipo bodega/minimarket + salón de belleza.
--
-- Nota: "productos" sí tiene UNIQUE en codigo_barras, así que
-- este bloque es seguro de re-correr (no duplica). "servicios"
-- no tiene una columna única para deduplicar — si corres este
-- script dos veces, los 3 servicios quedarán duplicados.
-- =========================================================

begin;

insert into public.productos
  (codigo_barras, nombre, categoria, precio, costo, stock_actual, stock_minimo, proveedor)
values
  ('7750243004011', 'Coca Cola 500ml', 'Bebidas', 3.50, 2.00, 24, 6, 'Distribuidora Lima Norte'),
  ('7750243004028', 'Agua San Luis 625ml', 'Bebidas', 2.00, 1.10, 40, 10, 'Distribuidora Lima Norte'),
  ('7750243004035', 'Papas Lays Clásicas 45g', 'Snacks', 4.50, 2.80, 30, 8, 'Snacks Perú SAC'),
  ('7750243004059', 'Shampoo Anticaspa 375ml', 'Cuidado Personal', 18.90, 13.50, 8, 3, 'Distribuidora Belleza Total'),
  ('7750243004066', 'Desodorante Rexona Men 150ml', 'Cuidado Personal', 12.50, 8.20, 6, 4, 'Distribuidora Belleza Total'),
  ('7750243004080', 'Cepillo Dental Colgate', 'Cuidado Personal', 6.50, 3.90, 12, 5, 'Distribuidora Belleza Total')
on conflict (codigo_barras) do nothing;

insert into public.servicios
  (nombre, precio, categoria, duracion_min)
values
  ('Corte de cabello', 25.00, 'Cabello', 30),
  ('Manicure clásico', 20.00, 'Uñas', 40),
  ('Tinte y color', 60.00, 'Cabello', 90);

commit;
