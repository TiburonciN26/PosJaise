-- =========================================================
-- POS Negocio 2 — Fase 7d: índices faltantes (A5 de la auditoría
-- técnica)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Corrección sobre mi propio hallazgo: al revisar 01_tablas.sql
-- (líneas 166-176) resulta que venta_items.venta_id y ventas.fecha
-- YA tenían índice desde el día 1 — mi auditoría original se
-- equivocó ahí, no hace falta tocarlos de nuevo.
--
-- Lo que sí falta:
-- - registro_servicios: sin índice en usuario_id ni fecha. Mi
--   Panel filtra por ambos (dueño + rango de fecha) y Estadísticas
--   filtra por fecha para todas las asistentes a la vez.
-- - gastos: sin índice en (mes, anio) — Gastos/Dashboard/
--   Estadísticas siempre filtran por los dos juntos.
-- - auditoria: solo tenía índice en "tabla", no en "fecha" — la
--   pantalla de Auditoría (recién construida) filtra por rango de
--   fecha en cada carga.
-- - movimientos_stock: sin índice en fecha — Auditoría también lo
--   consulta por rango de fecha para fusionarlo con el log.
--
-- porcentajes no necesita nada nuevo: su restricción
-- "unique (servicio_id, asistente_id)" ya crea un índice compuesto
-- que cubre exactamente el lookup del trigger de comisión.
-- =========================================================

begin;

create index if not exists idx_registro_servicios_usuario_id on public.registro_servicios (usuario_id);
create index if not exists idx_registro_servicios_fecha       on public.registro_servicios (fecha);
create index if not exists idx_gastos_mes_anio                on public.gastos (mes, anio);
create index if not exists idx_auditoria_fecha                on public.auditoria (fecha);
create index if not exists idx_movimientos_fecha              on public.movimientos_stock (fecha);

commit;
