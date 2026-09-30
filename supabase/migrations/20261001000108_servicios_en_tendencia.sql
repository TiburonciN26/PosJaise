-- =========================================================
-- Migración 2/10 del rediseño de Servicios/Detalle (docs/diseno-servicios/
-- README.md, "Backend que falta"): marca manual "en tendencia" para el
-- hero de Servicios.
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Reutiliza `servicios.descripcion` (migración 107) como el "texto corto
-- para el hero" que pedía el README — no hace falta una columna de texto
-- aparte. "Lo más pedido" (la otra etiqueta del hero) NO necesita
-- columna nueva: se calcula en el cliente contando `cita_servicios` de
-- los últimos 30 días agrupado por servicio_id.
--
-- Orden de prioridad del hero (ServiciosCliente.jsx): primero los
-- marcados en_tendencia=true, después los más reservados en 30 días,
-- y solo si faltan para llegar a 3, los primeros con foto sin más
-- criterio (fallback honesto — la tabla no tiene created_at, así que ya
-- no se puede fingir "más recientes").
--
-- Grant: igual que 107 — `servicios` otorga SELECT/INSERT/UPDATE a nivel
-- de TABLA completa para `authenticated`, así que el ALTER TABLE ADD
-- COLUMN alcanza solo.
-- =========================================================

begin;

alter table public.servicios add column if not exists en_tendencia boolean not null default false;

commit;
