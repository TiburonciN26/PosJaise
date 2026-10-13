-- Fase 7 · tres índices con beneficio MEDIDO para las listas de las Fases 4 y 5.
--
-- Por qué solo estos: se midieron con EXPLAIN (ANALYZE, BUFFERS) bajo los roles reales (ver .codex/ENTREGA-FASE7-SQL.md) 12 candidatos,
-- de uno en uno, ya con la migración 20261012000001 aplicada (que por sí sola elimina el grueso del costo). Solo estos tres cambian el
-- plan y reducen el tiempo de forma apreciable; los demás (pedidos por estado, pedidos por clienta, reseñas, promociones y catálogos
-- parciales) no se usan o ganan pocos milisegundos y NO se incluyen: no se añaden índices a ciegas.
--   · idx_f7_pedidos_web_creado        — Pedidos Web ordena por (creado_en desc, id desc): evita leer y ordenar toda la tabla.
--   · idx_f7_pedidos_web_items_pedido  — FK pedido_id sin índice: el detalle de un pedido y la política RLS de los ítems leían
--                                        toda la tabla; también acelera el ON DELETE CASCADE.
--   · idx_f7_cupones_origen_estado_creado — Referidos/Fidelización filtran por origen y estado y ordenan por fecha; también
--                                        resuelve los conteos por estado.
-- Costo: escritura y espacio en disco (ver la entrega: tamaño y sobrecosto de INSERT medidos). No cambian permisos, RLS ni datos.
-- Reversión: drop index (ver .codex/evidencia-fase7/rollback-fase7.sql). CREATE INDEX bloquea escrituras mientras se construye; con el
-- volumen actual es instantáneo. Si en producción las tablas fueran grandes, crear con CONCURRENTLY fuera de una transacción.
begin;

create index if not exists idx_f7_pedidos_web_creado
  on public.pedidos_web (creado_en desc, id desc);
create index if not exists idx_f7_pedidos_web_items_pedido
  on public.pedidos_web_items (pedido_id);
create index if not exists idx_f7_cupones_origen_estado_creado
  on public.cupones (origen, estado, creado_en desc, id desc);

commit;
