-- =========================================================
-- POS Negocio 2 — Fase 1: renombrar columna con tilde
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

alter table public.gastos
  rename column "año" to anio;
