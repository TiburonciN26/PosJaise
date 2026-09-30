-- =========================================================
-- POS Negocio 2 — Pestaña Web: carrito + pedidos de productos
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 84_productos_favoritos.sql ya se haya corrido.
--
-- Carrito de SERVICIOS (carrito_servicios): solo una lista de intención
-- de reserva, sin cantidad (no tiene sentido "2 del mismo corte" en una
-- lista de intención). No se "compran" ni tienen delivery — se
-- resuelven agendando: el botón "Reservar cita" del carrito llama a la
-- RPC agendar_cita_web() YA EXISTENTE con los servicio_id marcados (no
-- hace falta una RPC nueva para esto); al agendar con éxito el frontend
-- borra esos servicios del carrito con un delete directo (permitido por
-- la policy de abajo).
--
-- Carrito de PRODUCTOS (carrito_productos): con cantidad. Se confirma
-- con confirmar_pedido_productos(), que crea un pedido real
-- (pedidos_web + pedidos_web_items) para que el personal lo gestione
-- desde el nuevo panel "Pedidos Web" del POS (admin). Sin pago online:
-- el pedido queda PENDIENTE hasta que el negocio coordina cobro/entrega
-- por su cuenta — mismo espíritu que agendar_cita_web(), único punto de
-- escritura, revalida todo en el servidor.
--
-- Delivery: costo FIJO por zona (decisión del negocio: S/10 Nuevo
-- Chimbote, S/15 Chimbote) — tabla zonas_delivery en vez de un valor
-- hardcodeado en el código, para que el admin pueda ajustar precios o
-- sumar zonas después sin un despliegue nuevo. Solo aplica a productos
-- (los servicios no se pueden entregar a domicilio).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Carrito de servicios
-- ---------------------------------------------------------
create table public.carrito_servicios (
  cliente_web_id uuid not null references public.clientes_web (id) on delete cascade,
  servicio_id    uuid not null references public.servicios (id) on delete cascade,
  creado_en      timestamptz not null default now(),
  primary key (cliente_web_id, servicio_id)
);

alter table public.carrito_servicios enable row level security;
grant select, insert, delete on public.carrito_servicios to authenticated;

create policy carrito_servicios_select on public.carrito_servicios
  for select to authenticated
  using (cliente_web_id = auth.uid());

create policy carrito_servicios_insert on public.carrito_servicios
  for insert to authenticated
  with check (cliente_web_id = auth.uid());

create policy carrito_servicios_delete on public.carrito_servicios
  for delete to authenticated
  using (cliente_web_id = auth.uid());

-- ---------------------------------------------------------
-- 2. Carrito de productos (con cantidad, se puede actualizar)
-- ---------------------------------------------------------
create table public.carrito_productos (
  cliente_web_id uuid not null references public.clientes_web (id) on delete cascade,
  producto_id    uuid not null references public.productos (id) on delete cascade,
  cantidad       integer not null default 1 check (cantidad > 0),
  creado_en      timestamptz not null default now(),
  primary key (cliente_web_id, producto_id)
);

alter table public.carrito_productos enable row level security;
grant select, insert, update, delete on public.carrito_productos to authenticated;

create policy carrito_productos_select on public.carrito_productos
  for select to authenticated
  using (cliente_web_id = auth.uid());

create policy carrito_productos_insert on public.carrito_productos
  for insert to authenticated
  with check (cliente_web_id = auth.uid());

create policy carrito_productos_update on public.carrito_productos
  for update to authenticated
  using (cliente_web_id = auth.uid())
  with check (cliente_web_id = auth.uid());

create policy carrito_productos_delete on public.carrito_productos
  for delete to authenticated
  using (cliente_web_id = auth.uid());

-- ---------------------------------------------------------
-- 3. Zonas de delivery
-- ---------------------------------------------------------
create table public.zonas_delivery (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  costo  numeric(10, 2) not null,
  activo boolean not null default true
);

alter table public.zonas_delivery enable row level security;
grant select on public.zonas_delivery to authenticated;
grant insert, update, delete on public.zonas_delivery to authenticated;

create policy zonas_delivery_select on public.zonas_delivery
  for select to authenticated
  using (activo = true or public.es_admin());

create policy zonas_delivery_insert_admin on public.zonas_delivery
  for insert to authenticated
  with check (public.es_admin());

create policy zonas_delivery_update_admin on public.zonas_delivery
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy zonas_delivery_delete_admin on public.zonas_delivery
  for delete to authenticated
  using (public.es_admin());

insert into public.zonas_delivery (nombre, costo) values
  ('Nuevo Chimbote', 10.00),
  ('Chimbote', 15.00);

-- ---------------------------------------------------------
-- 4. Pedidos de productos (cabecera + detalle). cliente_id referencia
-- "clientes" (no clientes_web) — mismo criterio que citas/
-- registro_servicios, para que el personal vea un cliente unificado
-- (POS + Web) en el panel "Pedidos Web", no una identidad de login
-- suelta. nombre_producto/precio_unitario quedan "congelados" en el
-- detalle (no referencian el precio actual de "productos"): un cambio
-- de precio o el borrado de un producto después no debe alterar un
-- pedido ya confirmado.
-- ---------------------------------------------------------
create table public.pedidos_web (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes (id),
  tipo_entrega      text not null check (tipo_entrega in ('RECOJO_TIENDA', 'DELIVERY')),
  zona_delivery_id  uuid references public.zonas_delivery (id),
  direccion_entrega text,
  costo_delivery    numeric(10, 2) not null default 0,
  subtotal          numeric(10, 2) not null,
  total             numeric(10, 2) not null,
  estado            text not null default 'PENDIENTE'
                       check (estado in ('PENDIENTE', 'LISTO', 'ENTREGADO', 'CANCELADO')),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

create table public.pedidos_web_items (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos_web (id) on delete cascade,
  producto_id     uuid references public.productos (id) on delete set null,
  nombre_producto text not null,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(10, 2) not null,
  subtotal        numeric(10, 2) not null
);

alter table public.pedidos_web enable row level security;
alter table public.pedidos_web_items enable row level security;

grant select, update on public.pedidos_web to authenticated;
grant select on public.pedidos_web_items to authenticated;

create policy pedidos_web_select on public.pedidos_web
  for select to authenticated
  using (cliente_id = public.mi_cliente_id() or public.es_admin());

create policy pedidos_web_update_admin on public.pedidos_web
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

create policy pedidos_web_items_select on public.pedidos_web_items
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos_web p
      where p.id = pedido_id
        and (p.cliente_id = public.mi_cliente_id() or public.es_admin())
    )
  );

-- ---------------------------------------------------------
-- 5. confirmar_pedido_productos(): único punto de escritura de un
-- pedido — revalida todo en el servidor (nunca confía en lo que ya
-- calculó el navegador), mismo criterio que agendar_cita_web(). No
-- valida stock a propósito: un producto agotado puede seguir
-- pidiéndose (el negocio decide si lo repone o contacta a la clienta),
-- decisión ya tomada en 84_productos_favoritos.sql para el catálogo.
-- ---------------------------------------------------------
create or replace function public.confirmar_pedido_productos(
  p_producto_ids     uuid[],
  p_tipo_entrega     text,
  p_zona_delivery_id uuid default null,
  p_direccion        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id     uuid;
  v_costo_delivery numeric(10, 2) := 0;
  v_subtotal       numeric(10, 2) := 0;
  v_pedido_id      uuid;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de confirmar un pedido.';
  end if;

  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    raise exception 'Selecciona al menos un producto.';
  end if;

  if p_tipo_entrega not in ('RECOJO_TIENDA', 'DELIVERY') then
    raise exception 'Tipo de entrega inválido.';
  end if;

  if p_tipo_entrega = 'DELIVERY' then
    if p_direccion is null or btrim(p_direccion) = '' then
      raise exception 'Ingresa una dirección de entrega.';
    end if;

    select z.costo into v_costo_delivery
    from public.zonas_delivery z
    where z.id = p_zona_delivery_id and z.activo = true;

    if v_costo_delivery is null then
      raise exception 'Zona de delivery inválida.';
    end if;
  end if;

  insert into public.pedidos_web (
    cliente_id, tipo_entrega, zona_delivery_id, direccion_entrega, costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    v_costo_delivery, 0, 0
  )
  returning id into v_pedido_id;

  insert into public.pedidos_web_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
  select v_pedido_id, p.id, p.nombre, cp.cantidad, p.precio, cp.cantidad * p.precio
  from public.carrito_productos cp
  join public.productos p on p.id = cp.producto_id
  where cp.cliente_web_id = auth.uid()
    and cp.producto_id = any (p_producto_ids);

  select coalesce(sum(subtotal), 0) into v_subtotal
  from public.pedidos_web_items
  where pedido_id = v_pedido_id;

  if v_subtotal = 0 then
    raise exception 'No se encontraron productos válidos en tu carrito.';
  end if;

  update public.pedidos_web
  set subtotal = v_subtotal, total = v_subtotal + v_costo_delivery
  where id = v_pedido_id;

  delete from public.carrito_productos
  where cliente_web_id = auth.uid()
    and producto_id = any (p_producto_ids);

  return v_pedido_id;
end;
$$;

grant execute on function public.confirmar_pedido_productos(uuid[], text, uuid, text) to authenticated;
revoke execute on function public.confirmar_pedido_productos(uuid[], text, uuid, text) from public;

commit;
