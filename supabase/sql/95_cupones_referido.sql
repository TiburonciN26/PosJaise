-- =========================================================
-- POS Negocio 2 — Referidos v2: cupones de un solo uso (reemplaza el
-- "crédito neto" de 94_referidos.sql)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 94_referidos.sql ya se haya corrido.
--
-- Rediseño pedido por el usuario tras revisar el flujo de 94_ (ningún
-- dato real llegó a depender de la versión vieja, solo pruebas ya
-- revertidas — se puede reemplazar limpio, sin migrar nada):
--
-- 1. Ya NO se acumula un monto neto (`clientes.credito_referido`) —
--    cada recompensa es un CUPÓN individual de un solo uso, con su
--    propio código, que se marca CANJEADO al usarse en una venta real
--    (trazable: cada cupón queda linkeado a la venta exacta donde se
--    gastó). Así el sistema SÍ sabe cuándo se usó, sin depender de que
--    la cajera se acuerde de "restar" nada a mano.
-- 2. El cupón de quien invita YA NO se crea cuando el referido completa
--    cualquier visita — se crea recién cuando el REFERIDO CANJEA SU
--    PROPIO cupón de bienvenida en una venta real. Esto además resuelve
--    la duda del usuario sobre abuso (crear cuentas falsas con el mismo
--    código): para que quien invita gane algo, alguna cuenta tiene que
--    pasar de verdad por caja y pagar una venta real — no alcanza con
--    solo registrarse ni con que "exista" una atención.
-- 3. Canje solo desde Ventas.jsx (POS, en persona) — un nuevo estado del
--    botón de descuento ("Cupón", con su propio ícono) le pide el código
--    a la clienta en vez de aplicar un monto automático al seleccionarla
--    — a propósito, para que tenga que abrir la Web y familiarizarse con
--    ella. Pedidos Web (delivery) no valida cupones en esta fase — esos
--    pedidos igual se cobran en persona o por WhatsApp más adelante.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Se retira el mecanismo viejo (trigger automático + saldo neto)
-- ---------------------------------------------------------
drop trigger if exists trg_referido_registro_servicios on public.registro_servicios;
drop trigger if exists trg_referido_pedido_web on public.pedidos_web;
drop function if exists public.trg_recompensar_referido_registro();
drop function if exists public.trg_recompensar_referido_pedido();
drop function if exists public.recompensar_referido_si_corresponde(uuid);

alter table public.clientes
  drop column if exists credito_referido,
  drop column if exists recompensa_referido_aplicada;

-- ---------------------------------------------------------
-- 2. Tabla de cupones — un cupón por recompensa, nunca un saldo.
-- `origen` distingue el cupón de bienvenida (al ingresar un código) del
-- cupón de recompensa (al canjearse el de bienvenida de un referido) —
-- dos "pesos"/colores distintos en la UI, con espacio para sumar más
-- orígenes el día que haga falta (ej. promociones especiales).
-- ---------------------------------------------------------
create table public.cupones (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id),
  codigo      text not null unique,
  origen      text not null check (origen in ('REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA')),
  valor       numeric(10, 2) not null,
  estado      text not null default 'DISPONIBLE' check (estado in ('DISPONIBLE', 'CANJEADO', 'ANULADO')),
  referido_id uuid references public.clientes (id),
  venta_id    uuid references public.ventas (id),
  creado_en   timestamptz not null default now(),
  canjeado_en timestamptz
);

create index cupones_cliente_id_idx on public.cupones (cliente_id, creado_en desc);

alter table public.cupones enable row level security;

-- Sin insert/update para el cliente: los cupones solo los crea
-- aplicar_codigo_referido() y confirmar_venta() (ambas security
-- definer). El personal necesita LEER por código (la clienta lo
-- muestra en caja), no solo sus propios cupones — de ahí la policy
-- staff aparte de la del propio dueño.
grant select on public.cupones to authenticated;

create policy cupones_select_propio on public.cupones
  for select to authenticated
  using (cliente_id = public.mi_cliente_id());

create policy cupones_select_staff on public.cupones
  for select to authenticated
  using (public.rol_actual() is not null);

-- Trazabilidad: qué cupón se usó en una venta (además de que ya quedó
-- registrado el descuento en ventas.descuento_monto).
alter table public.ventas add column cupon_id uuid references public.cupones (id);

create or replace function public.generar_codigo_cupon()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo   text;
  v_intentos int := 0;
begin
  loop
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.cupones where codigo = v_codigo);
    v_intentos := v_intentos + 1;
    if v_intentos > 20 then
      raise exception 'No se pudo generar un código de cupón único.';
    end if;
  end loop;
  return v_codigo;
end;
$$;

-- ---------------------------------------------------------
-- 3. aplicar_codigo_referido(): mismas validaciones que antes
-- (código propio, doble registro, ya tiene una visita) + ahora crea de
-- una vez el cupón de bienvenida del referido (disponible desde ya,
-- para usar en su primera visita).
-- ---------------------------------------------------------
create or replace function public.aplicar_codigo_referido(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id       uuid;
  v_referente_id     uuid;
  v_ya_visito        boolean;
  v_credito_referido numeric;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de ingresar un código de referido.';
  end if;

  select id into v_referente_id
  from public.clientes
  where codigo_referido = upper(btrim(p_codigo));

  if v_referente_id is null then
    raise exception 'Código de referido inválido.';
  end if;

  if v_referente_id = v_cliente_id then
    raise exception 'No puedes usar tu propio código.';
  end if;

  if exists (select 1 from public.clientes where id = v_cliente_id and referido_por is not null) then
    raise exception 'Ya registraste un código de referido antes.';
  end if;

  select exists (
    select 1 from public.registro_servicios where cliente_id = v_cliente_id and estado = 'ACTIVO'
  ) into v_ya_visito;

  if v_ya_visito then
    raise exception 'Solo puedes ingresar un código de referido antes de tu primera visita.';
  end if;

  update public.clientes set referido_por = v_referente_id where id = v_cliente_id;

  select credito_referido into v_credito_referido from public.config_referidos where id = 1;

  insert into public.cupones (cliente_id, codigo, origen, valor)
  values (v_cliente_id, public.generar_codigo_cupon(), 'REFERIDO_BIENVENIDA', v_credito_referido);

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    v_cliente_id,
    'REFERIDO',
    '¡Tienes un cupón de bienvenida!',
    'Ganaste un cupón de S/' || v_credito_referido ||
      '. Muéstralo en tu próxima visita para que te lo apliquen.',
    '/mi-perfil/referidos'
  );
end;
$$;

-- ---------------------------------------------------------
-- 4. Estado propio + lista de cupones
-- ---------------------------------------------------------
create or replace function public.mi_estado_referidos()
returns table (
  codigo             text,
  credito_disponible numeric,
  ya_referido        boolean,
  total_referidos    int,
  credito_referidor  numeric,
  credito_referido   numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id uuid;
  v_codigo     text;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de ver tus referidos.';
  end if;

  v_codigo := public.mi_codigo_referido();

  return query
    select
      v_codigo,
      coalesce(
        (select sum(valor) from public.cupones where cliente_id = v_cliente_id and estado = 'DISPONIBLE'),
        0
      ),
      c.referido_por is not null,
      (select count(*)::int from public.clientes r where r.referido_por = c.id),
      cfg.credito_referidor,
      cfg.credito_referido
    from public.clientes c, public.config_referidos cfg
    where c.id = v_cliente_id and cfg.id = 1;
end;
$$;

create or replace function public.mis_cupones()
returns table (
  id          uuid,
  codigo      text,
  origen      text,
  valor       numeric,
  estado      text,
  creado_en   timestamptz,
  canjeado_en timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, codigo, origen, valor, estado, creado_en, canjeado_en
  from public.cupones
  where cliente_id = public.mi_cliente_id()
  order by (estado = 'DISPONIBLE') desc, creado_en desc;
$$;

grant execute on function public.mis_cupones() to authenticated;
revoke execute on function public.mis_cupones() from public;

-- ---------------------------------------------------------
-- 5. confirmar_venta(): nuevo parámetro p_codigo_cupon. Al usarse,
-- reemplaza por completo el descuento manual (mutuamente excluyente con
-- % y monto fijo) — el valor sale del cupón, nunca de lo que mande el
-- navegador. Si el cliente de la venta no estaba seleccionado, se toma
-- del dueño del cupón; si SÍ estaba seleccionado y es otro cliente, se
-- rechaza (evita aplicar el cupón de alguien a la cuenta de otra
-- persona). Al confirmar con éxito, si el cupón canjeado era de
-- BIENVENIDA, se genera ahí mismo el cupón de RECOMPENSA de quien
-- invitó — recién en este momento, nunca antes.
-- ---------------------------------------------------------
-- IMPORTANTE: create or replace NO alcanza acá — el nuevo parámetro
-- cambia la firma, así que sin este drop quedarían DOS versiones de
-- confirmar_venta coexistiendo (7 y 8 argumentos) y PostgREST no podría
-- resolver cuál usar según los parámetros nombrados que mande el
-- frontend. Se descubrió aplicando esto en vivo — corregido ahí mismo.
drop function if exists public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric);

create or replace function public.confirmar_venta(
  p_metodo_pago text,
  p_monto_recibido numeric,
  p_items jsonb,
  p_cliente_id uuid default null,
  p_descuento_pct numeric default 0,
  p_descuento_monto numeric default 0,
  p_monto_pos_tarjeta numeric default null,
  p_codigo_cupon text default null
)
returns table (venta_id uuid, codigo text, total numeric, items jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venta_id uuid;
  v_codigo text;
  v_total numeric := 0;
  v_item jsonb;
  v_cantidad int;
  v_precio numeric;
  v_nombre text;
  v_stock_actual int;
  v_items_resueltos jsonb := '[]'::jsonb;
  v_registro_servicio_id uuid;
  v_registro_servicio_estado text;
  v_registro_servicio_venta_id uuid;
  v_servicio_id uuid;
  v_registro_cliente_id uuid;
  v_registro_usuario_id uuid;
  v_asistente_id uuid;
  v_cupon_id uuid;
  v_cupon_cliente_id uuid;
  v_cupon_origen text;
  v_cupon_referente_id uuid;
  v_credito_referidor numeric;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no puede estar vacío';
  end if;

  if p_descuento_pct is null then
    p_descuento_pct := 0;
  end if;
  if p_descuento_monto is null then
    p_descuento_monto := 0;
  end if;
  if p_descuento_pct < 0 or p_descuento_pct > 100 then
    raise exception 'El descuento debe estar entre 0%% y 100%%';
  end if;
  if p_descuento_monto < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;

  p_codigo_cupon := nullif(btrim(coalesce(p_codigo_cupon, '')), '');

  if p_codigo_cupon is not null and (p_descuento_pct > 0 or p_descuento_monto > 0) then
    raise exception 'No puedes combinar un cupón con otro descuento';
  end if;
  if p_codigo_cupon is null and p_descuento_pct > 0 and p_descuento_monto > 0 then
    raise exception 'El descuento debe ser por porcentaje o por monto fijo, no ambos';
  end if;

  if p_monto_pos_tarjeta is not null and p_monto_pos_tarjeta < 0 then
    raise exception 'El monto a digitar en POS no puede ser negativo';
  end if;

  -- Reserva el cupón ANTES de tocar items/stock: lo marca CANJEADO ya
  -- mismo (bloqueo atómico vía WHERE estado = 'DISPONIBLE') para que dos
  -- ventas concurrentes nunca puedan gastar el mismo cupón dos veces.
  -- venta_id se completa recién más abajo, cuando ya existe la venta —
  -- el estado ya cambiado alcanza para bloquear la concurrencia.
  if p_codigo_cupon is not null then
    update public.cupones
    set estado = 'CANJEADO', canjeado_en = now()
    where codigo = upper(p_codigo_cupon) and estado = 'DISPONIBLE'
    returning id, cliente_id, origen into v_cupon_id, v_cupon_cliente_id, v_cupon_origen;

    if v_cupon_id is null then
      raise exception 'Cupón inválido o ya usado';
    end if;

    if p_cliente_id is not null and p_cliente_id <> v_cupon_cliente_id then
      raise exception 'Este cupón pertenece a otro cliente';
    end if;

    p_cliente_id := v_cupon_cliente_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_registro_cliente_id := null;
    v_registro_usuario_id := null;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un item del ticket';
    end if;

    if (v_item->>'tipo') = 'PRODUCTO' then
      select nombre, precio, stock_actual
        into v_nombre, v_precio, v_stock_actual
      from public.productos
      where id = (v_item->>'producto_id')::uuid
      for update;

      if v_nombre is null then
        raise exception 'El producto "%" ya no existe', v_item->>'nombre';
      end if;

      if v_stock_actual < v_cantidad then
        raise exception 'Stock insuficiente para "%" (quedan %, pediste %)',
          v_nombre, v_stock_actual, v_cantidad;
      end if;

      v_servicio_id := null;
      v_registro_servicio_id := null;

    elsif (v_item->>'tipo') = 'SERVICIO' then
      if v_cantidad <> 1 then
        raise exception 'Cada atención se vende de a una';
      end if;

      v_registro_servicio_id := (v_item->>'registro_servicio_id')::uuid;
      if v_registro_servicio_id is null then
        raise exception 'Falta la atención a vender para un servicio del ticket';
      end if;

      select rs.estado, rs.venta_id, rs.precio, rs.servicio_id, rs.cliente_id, rs.usuario_id, s.nombre
        into v_registro_servicio_estado, v_registro_servicio_venta_id, v_precio, v_servicio_id,
             v_registro_cliente_id, v_registro_usuario_id, v_nombre
      from public.registro_servicios rs
      join public.servicios s on s.id = rs.servicio_id
      where rs.id = v_registro_servicio_id
      for update of rs;

      if v_nombre is null then
        raise exception 'Esa atención ya no existe';
      end if;

      if v_registro_servicio_estado <> 'ACTIVO' or v_registro_servicio_venta_id is not null then
        raise exception 'Esa atención ya no está disponible para vender';
      end if;

    else
      raise exception 'Tipo de item desconocido: %', v_item->>'tipo';
    end if;

    v_total := v_total + v_cantidad * v_precio;

    v_items_resueltos := v_items_resueltos || jsonb_build_object(
      'tipo', v_item->>'tipo',
      'producto_id', v_item->>'producto_id',
      'servicio_id', v_servicio_id,
      'registro_servicio_id', v_registro_servicio_id,
      'cliente_id', v_registro_cliente_id,
      'usuario_id', v_registro_usuario_id,
      'nombre', v_nombre,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio,
      'subtotal', v_cantidad * v_precio
    );
  end loop;

  -- Descuento general sobre el total ya sumado (después de resolver todos
  -- los items, antes de validar el efectivo recibido — así "Recibido"
  -- se compara contra lo que de verdad hay que cobrar). Por %, por monto
  -- fijo, o por cupón — nunca combinados (ya validado arriba).
  if p_codigo_cupon is not null then
    select valor into p_descuento_monto from public.cupones where id = v_cupon_id;
    if p_descuento_monto > v_total then
      raise exception 'El cupón (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    v_total := round(v_total - p_descuento_monto, 2);
  elsif p_descuento_pct > 0 then
    v_total := round(v_total * (1 - p_descuento_pct / 100), 2);
  elsif p_descuento_monto > 0 then
    if p_descuento_monto > v_total then
      raise exception 'El descuento (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
    end if;
    v_total := round(v_total - p_descuento_monto, 2);
  end if;

  if p_metodo_pago = 'Efectivo' then
    if p_monto_recibido is null or p_monto_recibido < v_total then
      raise exception 'El monto recibido (%) no alcanza para el total (%)',
        coalesce(p_monto_recibido, 0), v_total;
    end if;
  else
    p_monto_recibido := null;
  end if;

  if p_metodo_pago <> 'Tarjeta' then
    p_monto_pos_tarjeta := null;
  end if;

  v_codigo := 'VEN' || lpad(nextval('public.ventas_codigo_seq')::text, 3, '0');

  insert into public.ventas
    (codigo, total, metodo_pago, monto_recibido, vendedor_id, cliente_id, descuento_pct, descuento_monto, monto_pos_tarjeta, cupon_id)
  values
    (v_codigo, v_total, p_metodo_pago, p_monto_recibido, auth.uid(), p_cliente_id,
     case when p_codigo_cupon is null then p_descuento_pct else 0 end,
     coalesce(p_descuento_monto, 0), p_monto_pos_tarjeta, v_cupon_id)
  returning id into v_venta_id;

  if v_cupon_id is not null then
    update public.cupones set venta_id = v_venta_id where id = v_cupon_id;

    -- El cupón canjeado era de bienvenida: recién ahora nace el cupón de
    -- recompensa de quien invitó — nunca antes de este momento.
    if v_cupon_origen = 'REFERIDO_BIENVENIDA' then
      select referido_por into v_cupon_referente_id from public.clientes where id = v_cupon_cliente_id;

      if v_cupon_referente_id is not null then
        select credito_referidor into v_credito_referidor from public.config_referidos where id = 1;

        insert into public.cupones (cliente_id, codigo, origen, valor, referido_id)
        values (
          v_cupon_referente_id, public.generar_codigo_cupon(), 'REFERIDO_RECOMPENSA',
          v_credito_referidor, v_cupon_cliente_id
        );

        insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
        values (
          v_cupon_referente_id,
          'REFERIDO',
          '¡Ganaste un cupón por referir!',
          'Un cliente que invitaste ya canjeó su cupón de bienvenida. Ganaste un cupón de S/' ||
            v_credito_referidor || ' — muéstralo en tu próxima visita.',
          '/mi-perfil/referidos'
        );
      end if;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_items_resueltos)
  loop
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio := (v_item->>'precio_unitario')::numeric;

    if (v_item->>'tipo') = 'PRODUCTO' then
      update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = (v_item->>'producto_id')::uuid;

      insert into public.venta_items
        (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'PRODUCTO', (v_item->>'producto_id')::uuid, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);
    else
      v_asistente_id := null;
      if (v_item->>'usuario_id') is not null then
        select id into v_asistente_id
        from public.asistentes
        where usuario_id = (v_item->>'usuario_id')::uuid
        limit 1;
      end if;

      insert into public.venta_items
        (venta_id, tipo, servicio_id, cliente_id, asistente_id, nombre, cantidad, precio_unitario, subtotal)
      values
        (v_venta_id, 'SERVICIO', (v_item->>'servicio_id')::uuid,
         (v_item->>'cliente_id')::uuid, v_asistente_id, v_item->>'nombre',
         v_cantidad, v_precio, v_cantidad * v_precio);

      update public.registro_servicios
      set venta_id = v_venta_id
      where id = (v_item->>'registro_servicio_id')::uuid;
    end if;
  end loop;

  return query select v_venta_id, v_codigo, v_total, v_items_resueltos;
end;
$$;

grant execute on function public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.confirmar_venta(text, numeric, jsonb, uuid, numeric, numeric, numeric, text) from public;

commit;
