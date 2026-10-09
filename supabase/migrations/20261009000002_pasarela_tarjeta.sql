-- Pasarela de pago con tarjeta (Culqi) — paso 1: solo esquema.
--
-- Hoy `pedidos_web` y `citas` (adelanto web) aceptan únicamente pagos
-- manuales ('YAPE' | 'PLIN' | 'TRANSFERENCIA') que el admin verifica a
-- mano contra un comprobante. Para cobrar con tarjeta de débito/crédito
-- a través de la pasarela hace falta:
--
--   1. Admitir 'TARJETA' como método de pago web (en mayúsculas, igual
--      que los otros tres; al verificar se traduce a 'Tarjeta' en
--      `ventas`, que ya existe en su check).
--   2. Guardar el id del cargo de la pasarela y su estado. Los escribe
--      SOLO el servidor (Edge Functions con service_role): el navegador
--      nunca decide que un pago quedó "PAGADO". Por eso no se agregan
--      policies ni grants nuevos para `authenticated`: en `pedidos_web`
--      el UPDATE ya es solo del admin (pedidos_web_update_admin) y en
--      `citas` solo del personal.
--   3. Registrar los eventos que envía la pasarela (webhook) con el id
--      del evento como UNIQUE, para que un reenvío del mismo evento sea
--      idempotente (no marcar/pagar dos veces).
--
-- Las llaves de Culqi NO viven en la base ni en el repo: la privada es
-- un secret de las Edge Functions y la pública va en VITE_CULQI_PUBLIC_KEY.
--
-- Las tablas se crearon por SQL y en este proyecto `service_role` no
-- recibe grants automáticos (ver 20261001000030), así que se otorgan
-- explícitos aquí.

begin;

-- ---------------------------------------------------------
-- 1. 'TARJETA' como método de pago web
-- El check de cada columna se creó inline, así que Postgres lo nombró
-- <tabla>_<columna>_check; se recrea con el valor nuevo.
-- ---------------------------------------------------------
alter table public.pedidos_web
  drop constraint if exists pedidos_web_metodo_pago_check;
alter table public.pedidos_web
  add constraint pedidos_web_metodo_pago_check
  check (metodo_pago in ('YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA'));

alter table public.citas
  drop constraint if exists citas_metodo_pago_check;
alter table public.citas
  add constraint citas_metodo_pago_check
  check (metodo_pago in ('YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA'));

-- ---------------------------------------------------------
-- 2. Cargo de la pasarela en pedidos_web y citas
-- Ambas tablas dan SELECT/UPDATE a nivel de tabla completa a
-- `authenticated`, así que ADD COLUMN no necesita GRANT de columna.
-- NULL = el pedido/cita no se pagó con pasarela.
-- ---------------------------------------------------------
alter table public.pedidos_web
  add column if not exists pasarela_charge_id text,
  add column if not exists pasarela_estado text
    check (pasarela_estado in ('PENDIENTE', 'PAGADO', 'RECHAZADO', 'REEMBOLSADO'));

alter table public.citas
  add column if not exists pasarela_charge_id text,
  add column if not exists pasarela_estado text
    check (pasarela_estado in ('PENDIENTE', 'PAGADO', 'RECHAZADO', 'REEMBOLSADO'));

-- Un mismo cargo no puede asociarse a dos pedidos/citas distintos.
create unique index if not exists pedidos_web_pasarela_charge_id_uidx
  on public.pedidos_web (pasarela_charge_id)
  where pasarela_charge_id is not null;
create unique index if not exists citas_pasarela_charge_id_uidx
  on public.citas (pasarela_charge_id)
  where pasarela_charge_id is not null;

-- ---------------------------------------------------------
-- 3. Eventos del webhook (idempotencia + rastro de auditoría)
-- ---------------------------------------------------------
create table if not exists public.pasarela_eventos (
  id          uuid primary key default gen_random_uuid(),
  proveedor   text not null default 'culqi',
  evento_id   text not null,
  tipo        text not null,
  charge_id   text,
  payload     jsonb not null,
  recibido_en timestamptz not null default now(),
  unique (proveedor, evento_id)
);

create index if not exists pasarela_eventos_charge_id_idx
  on public.pasarela_eventos (charge_id);

-- RLS activada y SIN policies: ningún rol de la app (authenticated/anon)
-- lee ni escribe aquí. Solo el servidor, vía service_role.
alter table public.pasarela_eventos enable row level security;

-- ---------------------------------------------------------
-- 4. Grants para el servidor (Edge Functions)
-- ---------------------------------------------------------
-- Defensa en profundidad: algunos entornos (p. ej. el local) dan
-- privilegios por defecto a anon/authenticated sobre tablas nuevas; aquí
-- no deben tener ninguno, además de no tener policies.
revoke all on public.pasarela_eventos from anon, authenticated;
grant select, insert on public.pasarela_eventos to service_role;
grant select, update on public.pedidos_web to service_role;
grant select, update on public.citas to service_role;

commit;
