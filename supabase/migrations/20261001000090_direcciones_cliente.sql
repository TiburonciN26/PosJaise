-- =========================================================
-- POS Negocio 2 — Pestaña Web: Direcciones del cliente (delivery)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- A pedido del usuario: el cliente puede guardar VARIAS direcciones (no
-- solo la única `clientes.direccion` de Mi Perfil) y elegir cuál usar en
-- cada compra por delivery, con CRUD completo por tarjeta de dirección.
-- Mismo patrón que favoritos_servicios/carrito_productos: tabla propia
-- del cliente, llave por `cliente_web_id = auth.uid()` directo (no hace
-- falta mi_cliente_id() acá — es un dato de LOGIN, como favoritos, no un
-- dato de negocio que el personal necesite ver: `pedidos_web` ya guarda
-- la dirección elegida como texto congelado al confirmar el pedido, así
-- que el personal ve la dirección del pedido sin necesitar acceso a esta
-- libreta). CRUD directo desde el frontend (sin RPC dedicada) porque no
-- hay ninguna validación de negocio que hacer server-side más allá de
-- RLS — la única regla extra (una sola dirección "predeterminada" a la
-- vez) se resuelve con un trigger, no con una función de escritura.
-- =========================================================

begin;

create table public.direcciones_cliente (
  id              uuid primary key default gen_random_uuid(),
  cliente_web_id  uuid not null references public.clientes_web (id) on delete cascade,
  etiqueta        text not null,
  direccion       text not null,
  referencia      text,
  predeterminada  boolean not null default false,
  creado_en       timestamptz not null default now()
);

create index direcciones_cliente_cliente_web_id_idx
  on public.direcciones_cliente (cliente_web_id);

alter table public.direcciones_cliente enable row level security;
grant select, insert, update, delete on public.direcciones_cliente to authenticated;

create policy direcciones_cliente_select on public.direcciones_cliente
  for select to authenticated
  using (cliente_web_id = auth.uid());

create policy direcciones_cliente_insert on public.direcciones_cliente
  for insert to authenticated
  with check (cliente_web_id = auth.uid());

create policy direcciones_cliente_update on public.direcciones_cliente
  for update to authenticated
  using (cliente_web_id = auth.uid())
  with check (cliente_web_id = auth.uid());

create policy direcciones_cliente_delete on public.direcciones_cliente
  for delete to authenticated
  using (cliente_web_id = auth.uid());

-- Solo una dirección predeterminada a la vez por cliente: al marcar una
-- como predeterminada, el trigger apaga esa marca en las demás filas del
-- mismo cliente_web_id. `security definer` porque el UPDATE que dispara
-- corre como el propio cliente (RLS de arriba ya lo limita a sus filas,
-- así que no hay riesgo de tocar filas ajenas).
create or replace function public.unicidad_direccion_predeterminada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.direcciones_cliente
  set predeterminada = false
  where cliente_web_id = new.cliente_web_id
    and id <> new.id
    and predeterminada = true;
  return new;
end;
$$;

create trigger direcciones_cliente_predeterminada
  after insert or update of predeterminada on public.direcciones_cliente
  for each row
  when (new.predeterminada)
  execute function public.unicidad_direccion_predeterminada();

commit;
