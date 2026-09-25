-- =========================================================
-- POS Negocio 2 — Fidelización: canje real vía cupón de %
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 95_cupones_referido.sql (tabla cupones, generar_codigo_
-- cupon(), confirmar_venta con p_codigo_cupon) y 78_fidelizacion_web.sql
-- (mi_fidelizacion) ya se hayan corrido.
--
-- Alcance: la clienta que completa 5 sellos ahora puede GENERAR un
-- cupón real de descuento (antes solo veía un cartel pidiéndole que lo
-- mencione de palabra en caja, sin forma de canjearlo de verdad) — se
-- canjea en Ventas con el mismo modo "Cupón" que ya usan los cupones
-- de Referidos, sin tocar el flujo del POS ni su UI.
--
-- Dos huecos que había que cerrar para que esto sea seguro (no solo
-- "que funcione", que no se pueda abusar):
-- 1. cupones.valor siempre se trataba como monto fijo en soles —
--    confirmar_venta() lo restaba directo del total. Un cupón de %
--    necesita que el sistema sepa que valor=20 significa "20%", no
--    "S/20" — se agrega tipo_descuento, mismo patrón que ya usa
--    promociones.tipo_descuento (79_promociones.sql).
-- 2. recompensas_disponibles de mi_fidelizacion() se calculaba SOLO
--    de las visitas (visitas_totales/5), sin ningún registro de
--    cuántas ya se reclamaron — sin esto, el botón "Generar cupón" se
--    podría tocar infinitas veces con las mismas 5 visitas y generar
--    cupones sin límite. Se agrega un contador en clientes.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. cupones: tipo de descuento (mismo patrón que promociones.
--    tipo_descuento) + nuevo origen FIDELIZACION. Default MONTO_FIJO
--    para no tocar el significado de los cupones de Referidos ya
--    existentes (todos monto fijo hasta hoy).
-- ---------------------------------------------------------
alter table public.cupones
  add column tipo_descuento text not null default 'MONTO_FIJO'
    check (tipo_descuento in ('MONTO_FIJO', 'PORCENTAJE'));

alter table public.cupones drop constraint if exists cupones_origen_check;
alter table public.cupones
  add constraint cupones_origen_check
  check (origen in ('REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION'));

-- mis_cupones() no devolvía tipo_descuento — sin esto, el frontend no
-- puede saber si un cupón es PORCENTAJE o MONTO_FIJO (hace falta para
-- mostrar "20% dcto." en vez de "S/20.00", y para el nivel Bronce/
-- Plata/Oro correcto en TarjetaCupon.jsx). drop necesario: Postgres no
-- deja cambiar el tipo de retorno de una función con create or
-- replace, solo el body — se descubrió aplicando esto en vivo,
-- corregido ahí mismo (mismo tipo de hueco que ya había dejado
-- documentado 95_cupones_referido.sql sobre confirmar_venta).
drop function if exists public.mis_cupones();

create or replace function public.mis_cupones()
returns table (
  id             uuid,
  codigo         text,
  origen         text,
  valor          numeric,
  tipo_descuento text,
  estado         text,
  creado_en      timestamptz,
  canjeado_en    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, codigo, origen, valor, tipo_descuento, estado, creado_en, canjeado_en
  from public.cupones
  where cliente_id = public.mi_cliente_id()
  order by (estado = 'DISPONIBLE') desc, creado_en desc;
$$;

grant execute on function public.mis_cupones() to authenticated;
revoke execute on function public.mis_cupones() from public;

-- ---------------------------------------------------------
-- 2. Config editable (mismo patrón que config_puntos/config_referidos,
--    singleton id=1): % de descuento del cupón de Fidelización,
--    ajustable desde el POS sin desplegar de nuevo. Default 20 — la
--    regla de negocio original ("5 sellos = 20% de descuento",
--    78_fidelizacion_web.sql), no un número inventado acá.
-- ---------------------------------------------------------
create table public.config_fidelizacion (
  id                    int primary key default 1,
  porcentaje_recompensa numeric(5, 2) not null default 20,
  actualizado_en        timestamptz not null default now(),
  constraint config_fidelizacion_singleton check (id = 1)
);

insert into public.config_fidelizacion (id) values (1);

alter table public.config_fidelizacion enable row level security;
grant select on public.config_fidelizacion to authenticated;
grant update on public.config_fidelizacion to authenticated;

-- Lectura abierta a cualquier autenticado: generar_cupon_fidelizacion()
-- (más abajo) la necesita para saber qué % ponerle al cupón nuevo.
create policy config_fidelizacion_select on public.config_fidelizacion
  for select to authenticated
  using (true);

create policy config_fidelizacion_update_admin on public.config_fidelizacion
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---------------------------------------------------------
-- 3. clientes: cuántas recompensas de Fidelización ya se reclamaron
--    (generaron su cupón). Sin esto, recompensas_disponibles no tiene
--    forma de "bajar" al generar un cupón.
-- ---------------------------------------------------------
alter table public.clientes
  add column fidelizacion_recompensas_reclamadas int not null default 0;

-- ---------------------------------------------------------
-- 4. mi_fidelizacion(): mismo cálculo de sellos/visitas de siempre —
--    recompensas_disponibles ahora resta lo ya reclamado (nunca
--    negativo, greatest(...,0) por si algún día se ajusta el umbral
--    hacia arriba y deja reclamadas > disponibles "en teoría").
-- ---------------------------------------------------------
create or replace function public.mi_fidelizacion()
returns table (
  visitas_totales         int,
  visitas_por_recompensa  int,
  sellos_actuales         int,
  recompensas_disponibles int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(distinct rs.fecha)::int as visitas_totales,
    5 as visitas_por_recompensa,
    (count(distinct rs.fecha) % 5)::int as sellos_actuales,
    greatest(
      (count(distinct rs.fecha) / 5) - coalesce(
        (select c.fidelizacion_recompensas_reclamadas from public.clientes c where c.id = public.mi_cliente_id()),
        0
      ),
      0
    )::int as recompensas_disponibles
  from public.registro_servicios rs
  where rs.cliente_id = public.mi_cliente_id()
    and rs.estado = 'ACTIVO';
$$;

-- ---------------------------------------------------------
-- 5. generar_cupon_fidelizacion(): valida en el SERVIDOR (nunca confía
--    en lo que mande el navegador) que hay al menos 1 recompensa
--    disponible, la reclama (+1 al contador, con `for update` para que
--    dos taps rápidos no reclamen la misma recompensa dos veces) y
--    recién ahí crea el cupón de %.
-- ---------------------------------------------------------
create or replace function public.generar_cupon_fidelizacion()
returns table (codigo text, valor numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id      uuid;
  v_visitas_totales int;
  v_reclamadas      int;
  v_disponibles     int;
  v_porcentaje      numeric;
  v_codigo          text;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de generar un cupón.';
  end if;

  select count(distinct fecha)::int into v_visitas_totales
  from public.registro_servicios
  where cliente_id = v_cliente_id and estado = 'ACTIVO';

  select fidelizacion_recompensas_reclamadas into v_reclamadas
  from public.clientes
  where id = v_cliente_id
  for update;

  v_disponibles := (v_visitas_totales / 5) - coalesce(v_reclamadas, 0);

  if v_disponibles <= 0 then
    raise exception 'Todavía no completaste una tarjeta de 5 visitas.';
  end if;

  select porcentaje_recompensa into v_porcentaje from public.config_fidelizacion where id = 1;

  update public.clientes
  set fidelizacion_recompensas_reclamadas = fidelizacion_recompensas_reclamadas + 1
  where id = v_cliente_id;

  v_codigo := public.generar_codigo_cupon();

  insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento)
  values (v_cliente_id, v_codigo, 'FIDELIZACION', v_porcentaje, 'PORCENTAJE');

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    v_cliente_id,
    'FIDELIZACION',
    '¡Generaste un cupón!',
    'Tu cupón de ' || v_porcentaje || '% de descuento ya está listo. Muéstralo en tu próxima visita.',
    '/fidelizacion'
  );

  return query select v_codigo, v_porcentaje;
end;
$$;

grant execute on function public.generar_cupon_fidelizacion() to authenticated;
revoke execute on function public.generar_cupon_fidelizacion() from public;

-- ---------------------------------------------------------
-- 6. mi_historial_fidelizacion(): la fecha de cada visita (mismo
--    criterio de "visita" que mi_fidelizacion() — fecha distinta en
--    registro_servicios activos). Sirve como historial de sellos Y de
--    visitas a la vez, porque van ligados 1 a 1 (pedido del usuario).
-- ---------------------------------------------------------
create or replace function public.mi_historial_fidelizacion()
returns table (fecha date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct rs.fecha
  from public.registro_servicios rs
  where rs.cliente_id = public.mi_cliente_id()
    and rs.estado = 'ACTIVO'
  order by rs.fecha desc;
$$;

grant execute on function public.mi_historial_fidelizacion() to authenticated;
revoke execute on function public.mi_historial_fidelizacion() from public;

-- ---------------------------------------------------------
-- 7. confirmar_venta(): el canje de un cupón ahora respeta su
--    tipo_descuento — porcentaje aplica % sobre el total (mismo cálculo
--    que ya existía para el descuento manual por %), monto fijo resta
--    soles (comportamiento de siempre, cupones de Referidos incluidos).
--    Misma firma que 95_cupones_referido.sql (mismos parámetros) —
--    create or replace alcanza, no hace falta un drop esta vez.
--    ventas.descuento_pct/descuento_monto también reflejan el tipo
--    real del cupón canjeado, para que los reportes de ventas sigan
--    siendo correctos (antes un cupón SIEMPRE quedaba anotado en
--    descuento_monto).
-- ---------------------------------------------------------
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
  v_cupon_tipo_descuento text;
  v_cupon_valor numeric;
  v_cupon_pct_aplicado numeric := 0;
  v_credito_referidor numeric;
  v_cupon_referente_id uuid;
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
  -- fijo, o por cupón — nunca combinados (ya validado arriba). Un cupón
  -- de % se resuelve como el descuento manual por %; uno de monto fijo,
  -- como el descuento manual por monto (mismo tope: no puede superar el
  -- total).
  if p_codigo_cupon is not null then
    select valor, tipo_descuento into v_cupon_valor, v_cupon_tipo_descuento
    from public.cupones where id = v_cupon_id;

    if v_cupon_tipo_descuento = 'PORCENTAJE' then
      v_cupon_pct_aplicado := v_cupon_valor;
      v_total := round(v_total * (1 - v_cupon_valor / 100), 2);
    else
      p_descuento_monto := v_cupon_valor;
      if p_descuento_monto > v_total then
        raise exception 'El cupón (%) no puede ser mayor al total (%)', p_descuento_monto, v_total;
      end if;
      v_total := round(v_total - p_descuento_monto, 2);
    end if;
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
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then v_cupon_pct_aplicado
       when p_codigo_cupon is null then p_descuento_pct
       else 0
     end,
     case
       when p_codigo_cupon is not null and v_cupon_tipo_descuento = 'PORCENTAJE' then 0
       else coalesce(p_descuento_monto, 0)
     end,
     p_monto_pos_tarjeta, v_cupon_id)
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
