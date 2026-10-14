-- =========================================================
-- Chanchito: ahorro del negocio (solo admin)
--
-- Por qué: el admin necesita apartar dinero como ahorro y ver cuánto
-- lleva acumulado. En vez de guardar un "saldo" editable (que se puede
-- pisar por error y no deja rastro), se guardan MOVIMIENTOS: cada
-- depósito o retiro es una fila, y el saldo es la suma (depósitos
-- menos retiros). Así siempre hay historial y el saldo no se desfasa.
--
-- Los movimientos son inmutables a propósito: solo se otorga SELECT e
-- INSERT. Un error se corrige con un movimiento contrario, no editando
-- ni borrando el anterior.
--
-- RLS y GRANT son dos compuertas independientes (ver CLAUDE.md): aquí
-- se declaran las dos. Solo es_admin() puede leer o escribir.
-- =========================================================

begin;

create table public.chanchito_movimientos (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('DEPOSITO', 'RETIRO')),
  monto      numeric(10, 2) not null check (monto > 0),
  nota       text,
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  creado_en  timestamptz not null default now()
);

create index chanchito_movimientos_creado_en_idx
  on public.chanchito_movimientos (creado_en desc);

alter table public.chanchito_movimientos enable row level security;

-- revoke explícito: el Supabase local concede todos los privilegios por defecto a
-- authenticated; así la tabla queda igual (solo SELECT/INSERT) en local y producción.
revoke all on public.chanchito_movimientos from authenticated;
grant select, insert on public.chanchito_movimientos to authenticated;

create policy chanchito_movimientos_admin_leer on public.chanchito_movimientos
  for select to authenticated
  using ((select public.es_admin()));

create policy chanchito_movimientos_admin_insertar on public.chanchito_movimientos
  for insert to authenticated
  with check ((select public.es_admin()));

commit;
