-- Pasarela de pago con tarjeta (Culqi) — paso 3: confirmar el pago y crear la venta.
--
-- Cuando Culqi confirma un cobro, el pedido debe pasar solo a "pago
-- verificado + venta creada + LISTO", sin que la admin revise un comprobante
-- (no hay comprobante: lo cobró la pasarela).
--
-- Problema: `confirmar_venta` exige una usuaria con sesión (rol ADMINISTRADOR
-- o CAJERA) y guarda `auth.uid()` como vendedora. Quien confirma aquí es el
-- servidor (Edge Function con service_role), que no tiene `auth.uid()`.
-- Solución acotada: esta función security definer, ejecutable SOLO por
-- service_role, toma a la admin activa más antigua y fija esa identidad
-- únicamente dentro de la transacción (set_config con is_local = true), así
-- la venta queda a nombre de la dueña/admin y se reutiliza TODA la lógica de
-- `confirmar_venta` (precios en servidor, cupón, stock, puntos) sin copiarla.
-- La identidad no se filtra: expira con la transacción y la función no es
-- ejecutable por anon ni authenticated.
--
-- Además:
--   * `verificar_pago_pedido_web` (la verificación manual de la admin) ahora
--     traduce 'TARJETA' → 'Tarjeta'; antes caía en 'Transferencia'. Sirve de
--     salida manual si la confirmación automática falla por un CONFLICTO.
--   * `cancelar_mi_pedido_web` ya no deja que la clienta cancele un pedido con
--     un cobro de tarjeta en curso o cobrado (el dinero ya salió de su
--     tarjeta; la devolución se gestiona con el negocio / en Culqi).

begin;

-- ---------------------------------------------------------
-- 1. confirmar_pago_pasarela_pedido — solo servidor
-- ---------------------------------------------------------
create or replace function public.confirmar_pago_pasarela_pedido(
  p_pedido_id uuid,
  p_charge_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_pedido   record;
  v_admin    uuid;
  v_items    jsonb;
  v_venta_id uuid;
  v_total    numeric;
  v_msg      text;
  v_hint     text;
begin
  if coalesce(btrim(p_charge_id), '') = '' then
    raise exception 'Falta el id del cargo.';
  end if;

  select * into v_pedido
  from public.pedidos_web
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'Ese pedido no existe.';
  end if;

  if v_pedido.metodo_pago is distinct from 'TARJETA' then
    raise exception 'Ese pedido no es de pago con tarjeta.';
  end if;

  if v_pedido.pasarela_charge_id is not null and v_pedido.pasarela_charge_id <> p_charge_id then
    raise exception 'El cargo no corresponde a este pedido.';
  end if;

  -- Idempotente: Culqi puede reenviar el aviso y crear-cargo también llama
  -- aquí; la segunda vez no crea otra venta.
  if v_pedido.pago_verificado then
    return v_pedido.venta_id;
  end if;

  -- El cobro ya salió de la tarjeta: si el pedido se canceló mientras tanto
  -- no se crea la venta; queda a la vista para devolver el dinero.
  if v_pedido.estado = 'CANCELADO' then
    raise exception 'CONFLICTO: el pedido está cancelado pero el cargo % ya se cobró. Hay que devolver el dinero desde el panel de Culqi.', p_charge_id
      using hint = 'PAGO_SOBRE_PEDIDO_CANCELADO';
  end if;

  select id into v_admin
  from public.usuarios
  where rol = 'ADMINISTRADOR' and activo
  order by creado_en, id
  limit 1;

  if v_admin is null then
    raise exception 'No hay una administradora activa para registrar la venta.';
  end if;

  -- Identidad solo para esta transacción (auth.uid() lee estos ajustes).
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'PRODUCTO',
           'producto_id', producto_id,
           'cantidad', cantidad
         )), '[]'::jsonb)
    into v_items
  from public.pedidos_web_items
  where pedido_id = p_pedido_id
    and producto_id is not null;

  begin
    select cv.venta_id, cv.total into v_venta_id, v_total
    from public.confirmar_venta(
      p_metodo_pago    => 'Tarjeta',
      p_monto_recibido => null,
      p_items          => v_items,
      p_cliente_id     => v_pedido.cliente_id,
      p_codigo_cupon   => v_pedido.cupon_codigo,
      p_costo_delivery => v_pedido.costo_delivery
    ) as cv;
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint in ('COSTO_DESCONOCIDO', 'PROTECCION_GLOBAL') then
      raise exception 'CONFLICTO: el cupón de este pedido ya no cumple la protección económica con los precios o costos actuales (%). El cargo % ya se cobró: la admin debe resolverlo y verificar el pago a mano.', v_msg, p_charge_id
        using hint = 'CONFLICTO_PEDIDO';
    end if;
    raise;
  end;

  -- Mismo control que la verificación manual: si cambiaron precios o
  -- condiciones desde que se creó el pedido, no se registra otro importe en
  -- silencio. La excepción revierte la venta recién creada.
  if round(v_total, 2) <> round(v_pedido.total, 2) then
    raise exception 'CONFLICTO: el total vigente (S/ %) ya no coincide con el cobrado (S/ %) en el cargo %. La admin debe resolverlo y verificar el pago a mano.', round(v_total, 2), round(v_pedido.total, 2), p_charge_id
      using hint = 'CONFLICTO_PEDIDO';
  end if;

  -- pago_verificado_por queda NULL a propósito: lo verificó la pasarela, no
  -- una persona.
  update public.pedidos_web
  set pago_verificado = true,
      pago_verificado_en = now(),
      venta_id = v_venta_id,
      estado = 'LISTO',
      pasarela_charge_id = p_charge_id,
      pasarela_estado = 'PAGADO'
  where id = p_pedido_id;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  return v_venta_id;
end;
$function$;

revoke execute on function public.confirmar_pago_pasarela_pedido(uuid, text) from public, anon, authenticated;
grant execute on function public.confirmar_pago_pasarela_pedido(uuid, text) to service_role;

-- ---------------------------------------------------------
-- 2. verificar_pago_pedido_web — traduce 'TARJETA' → 'Tarjeta'
-- (cuerpo idéntico a 20261005000002; solo cambia el CASE del método).
-- ---------------------------------------------------------
create or replace function public.verificar_pago_pedido_web(p_pedido_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pedido   record;
  v_items    jsonb;
  v_venta_id uuid;
  v_total    numeric;
  v_msg      text;
  v_hint     text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede verificar pagos.';
  end if;

  select * into v_pedido
  from public.pedidos_web
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'Ese pedido no existe.';
  end if;

  if v_pedido.pago_verificado then
    raise exception 'Ese pago ya estaba verificado.';
  end if;

  if v_pedido.estado = 'CANCELADO' then
    raise exception 'Ese pedido está cancelado.';
  end if;

  -- Un pedido con tarjeta solo se verifica a mano si la pasarela YA lo cobró
  -- (p. ej. la confirmación automática chocó con un CONFLICTO). Si no, la
  -- admin registraría una venta de dinero que nunca entró.
  if v_pedido.metodo_pago = 'TARJETA' and v_pedido.pasarela_estado is distinct from 'PAGADO' then
    raise exception 'Ese pedido es de pago con tarjeta y la pasarela todavía no registra el cobro.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'PRODUCTO',
           'producto_id', producto_id,
           'cantidad', cantidad
         )), '[]'::jsonb)
    into v_items
  from public.pedidos_web_items
  where pedido_id = p_pedido_id
    and producto_id is not null;

  begin
    select cv.venta_id, cv.total into v_venta_id, v_total
    from public.confirmar_venta(
      p_metodo_pago    => case v_pedido.metodo_pago
                            when 'YAPE' then 'Yape'
                            when 'PLIN' then 'Plin'
                            when 'TARJETA' then 'Tarjeta'
                            else 'Transferencia'
                          end,
      p_monto_recibido => null,
      p_items          => v_items,
      p_cliente_id     => v_pedido.cliente_id,
      p_codigo_cupon   => v_pedido.cupon_codigo,
      p_costo_delivery => v_pedido.costo_delivery
    ) as cv;
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint in ('COSTO_DESCONOCIDO', 'PROTECCION_GLOBAL') then
      raise exception 'CONFLICTO: el cupón de este pedido ya no cumple la protección económica con los precios o costos actuales (%). El pedido sigue pendiente: no se cobró ni se cambió nada. Revisa el cupón o la protección antes de verificar el pago.', v_msg
        using hint = 'CONFLICTO_PEDIDO';
    end if;
    raise;
  end;

  if round(v_total, 2) <> round(v_pedido.total, 2) then
    raise exception 'CONFLICTO: el total vigente (S/ %) ya no coincide con el que la clienta pagó (S/ %): cambiaron precios o condiciones después de crear el pedido. El pedido sigue pendiente: no se cobró ni se cambió nada.', round(v_total, 2), round(v_pedido.total, 2)
      using hint = 'CONFLICTO_PEDIDO';
  end if;

  update public.pedidos_web
  set pago_verificado = true,
      pago_verificado_en = now(),
      pago_verificado_por = auth.uid(),
      venta_id = v_venta_id,
      estado = 'LISTO'
  where id = p_pedido_id;

  return v_venta_id;
end;
$function$;

-- ---------------------------------------------------------
-- 3. cancelar_mi_pedido_web — no cancelar con un cobro de tarjeta vivo
-- ---------------------------------------------------------
create or replace function public.cancelar_mi_pedido_web(p_pedido_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cliente_id uuid;
  v_pedido     record;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'No tienes un perfil vinculado';
  end if;

  select * into v_pedido from public.pedidos_web where id = p_pedido_id for update;

  if v_pedido.id is null or v_pedido.cliente_id is distinct from v_cliente_id then
    raise exception 'Ese pedido no existe o no te pertenece';
  end if;

  if v_pedido.estado = 'CANCELADO' then
    raise exception 'Ese pedido ya está cancelado';
  end if;

  if v_pedido.pago_verificado then
    raise exception 'Ya confirmamos tu pago y generamos la venta — comunícate directamente con el negocio para solicitar la devolución.';
  end if;

  if v_pedido.pasarela_estado in ('PENDIENTE', 'PAGADO') then
    raise exception 'Tu pago con tarjeta está en proceso o ya fue cobrado — comunícate directamente con el negocio para solicitar la devolución.';
  end if;

  update public.pedidos_web
  set estado = 'CANCELADO', actualizado_en = now()
  where id = p_pedido_id;
end;
$function$;

commit;
