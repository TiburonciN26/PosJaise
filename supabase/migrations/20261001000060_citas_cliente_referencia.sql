-- =========================================================
-- POS Negocio 2 — Cliente de referencia (sin guardar) en Citas
-- Ejecutar en Supabase → SQL Editor → New query
--
-- El campo Cliente era obligatorio pero solo aceptaba clientes ya
-- registrados — no dejaba anotar un nombre cualquiera de referencia
-- (ej. alguien que todavía no está en Clientes). Se agrega una columna
-- de texto aparte para ese caso: cliente_id sigue siendo el vínculo
-- real cuando existe: cliente_nombre_referencia solo se usa cuando NO
-- hay cliente_id (mutuamente excluyentes en la práctica, igual que
-- confirmar_venta con descuento_pct/descuento_monto).
-- =========================================================

begin;

alter table public.citas
  add column if not exists cliente_nombre_referencia text null;

commit;
