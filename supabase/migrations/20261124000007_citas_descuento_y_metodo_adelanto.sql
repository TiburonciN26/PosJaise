-- =========================================================
-- Citas: DESCUENTO acordado al agendar + método con que se pagó el ADELANTO
--
-- 1) DESCUENTO DE LA CITA (citas.descuento, en soles). Funciona como el adelanto, con una diferencia de fondo: el adelanto es plata
--    que YA entró a caja; el descuento es plata que NO va a entrar (dinero perdido por una promesa a la clienta). Por eso en Ventas
--    sí cuenta como «Descuentos» en el Dashboard.
--    · Se aplica UNA sola vez: está «pendiente» mientras ninguna atención de la cita esté en una venta ACTIVA. Anular esa venta
--      libera las atenciones (registro_servicios.venta_id = null) y el descuento vuelve a estar pendiente solo.
--    · descuentos_cita_de_atenciones(): lo consulta Ventas / «Atención a cobrar» para detectarlo y aplicarlo automático en el campo
--      de descuento del carrito. NO se toca confirmar_venta: el descuento viaja como el descuento manual en soles de siempre
--      (sigue valiendo «un solo descuento por venta»: no se combina con cupón ni con porcentaje).
--
-- 2) MÉTODO DEL ADELANTO (citas.adelanto_metodo: Efectivo, Tarjeta, Transferencia o Yape, los mismos que Ventas). Es solo
--    informativo: no mueve caja. Al cobrar, un trigger sobre ventas_adelantos copia el método a ventas.adelanto_metodo, para que el
--    detalle de la venta muestre «Adelanto de la cita … (Yape)». Se hace con trigger y no dentro de confirmar_venta para no volver
--    a copiar esa función entera por un dato informativo.
--    adelantos_pendientes_de_atenciones() cambia de columnas (suma `metodo`): se hace DROP + CREATE; confirmar_venta la llama por
--    nombre de columna, así que no se ve afectado.
--
-- 3) guardar_cita_pos() suma p_descuento y p_adelanto_metodo (de 8 a 10 parámetros): DROP de la anterior para que PostgREST no vea
--    dos candidatas. Valida en el servidor lo mismo que el modal: adelanto y descuento no negativos y, juntos, no mayores al total de
--    los servicios; sin adelanto no se guarda método.
-- =========================================================

begin;

alter table public.citas
  add column if not exists descuento numeric(10, 2)
    check (descuento is null or descuento >= 0),
  add column if not exists adelanto_metodo text
    check (adelanto_metodo is null or adelanto_metodo in ('Efectivo', 'Tarjeta', 'Transferencia', 'Yape'));

alter table public.ventas
  add column if not exists adelanto_metodo text;

-- guardar_cita_pos -----------------------------------------------------------------------------------------------------------
drop function if exists public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb);

create or replace function public.guardar_cita_pos(
  p_cita_id                   uuid,
  p_cliente_id                uuid,
  p_cliente_nombre_referencia text,
  p_asistente_id              uuid,
  p_fecha_hora                timestamptz,
  p_nota                      text,
  p_adelanto                  numeric,
  p_servicios                 jsonb, -- [{ "servicio_id": uuid, "duracion_min": int, "precio": numeric }, ...]
  p_descuento                 numeric default null,
  p_adelanto_metodo           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita_id  uuid;
  v_item     jsonb;
  v_duracion int;
  v_precio   numeric;
  v_total    numeric := 0;
  v_metodo   text;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if p_servicios is null or jsonb_array_length(p_servicios) = 0 then
    raise exception 'Agrega al menos un servicio.';
  end if;

  for v_item in select * from jsonb_array_elements(p_servicios)
  loop
    v_duracion := (v_item->>'duracion_min')::int;
    v_precio := (v_item->>'precio')::numeric;
    if (v_item->>'servicio_id') is null then
      raise exception 'Hay un servicio inválido en la cita.';
    end if;
    if v_duracion is null or v_duracion <= 0 then
      raise exception 'Hay una duración inválida en los servicios.';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'Hay un precio inválido en los servicios.';
    end if;
    v_total := v_total + v_precio;
  end loop;

  if p_adelanto is not null and p_adelanto < 0 then
    raise exception 'El adelanto no es válido.';
  end if;
  if p_descuento is not null and p_descuento < 0 then
    raise exception 'El descuento no es válido.';
  end if;
  if coalesce(p_adelanto, 0) + coalesce(p_descuento, 0) > v_total then
    raise exception 'El adelanto y el descuento no pueden superar el total de los servicios.';
  end if;

  v_metodo := nullif(btrim(coalesce(p_adelanto_metodo, '')), '');
  if v_metodo is not null and v_metodo not in ('Efectivo', 'Tarjeta', 'Transferencia', 'Yape') then
    raise exception 'El método de pago del adelanto no es válido.';
  end if;
  -- Sin adelanto no hay método que guardar.
  if coalesce(p_adelanto, 0) <= 0 then
    v_metodo := null;
  end if;

  if p_cita_id is not null then
    update public.citas
    set cliente_id                = p_cliente_id,
        cliente_nombre_referencia = p_cliente_nombre_referencia,
        asistente_id              = p_asistente_id,
        fecha_hora                = p_fecha_hora,
        nota                      = p_nota,
        adelanto                  = p_adelanto,
        descuento                 = nullif(p_descuento, 0),
        adelanto_metodo           = v_metodo
    where id = p_cita_id;

    if not found then
      raise exception 'La cita no existe';
    end if;

    v_cita_id := p_cita_id;

    delete from public.cita_servicios where cita_id = v_cita_id;
  else
    insert into public.citas (
      cliente_id, cliente_nombre_referencia, asistente_id,
      fecha_hora, nota, adelanto, descuento, adelanto_metodo, creado_por
    )
    values (
      p_cliente_id, p_cliente_nombre_referencia, p_asistente_id,
      p_fecha_hora, p_nota, p_adelanto, nullif(p_descuento, 0), v_metodo, auth.uid()
    )
    returning id into v_cita_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_servicios)
  loop
    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (
      v_cita_id,
      (v_item->>'servicio_id')::uuid,
      (v_item->>'duracion_min')::int,
      (v_item->>'precio')::numeric
    );
  end loop;

  return v_cita_id;
end;
$$;

revoke execute on function public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb, numeric, text) from public, anon;
grant execute on function public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb, numeric, text) to authenticated;

-- adelantos_pendientes_de_atenciones: ahora también devuelve el método con que se pagó ---------------------------------------
drop function if exists public.adelantos_pendientes_de_atenciones(uuid[]);

create or replace function public.adelantos_pendientes_de_atenciones(p_registro_ids uuid[])
returns table (cita_id uuid, pendiente numeric, registro_ids uuid[], metodo text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rol_actual() is null or public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'No tienes permiso para consultar esto' using errcode = '42501';
  end if;

  return query
  select c.id,
         c.adelanto - coalesce(ap.aplicado, 0),
         array_agg(cs.registro_servicio_id),
         c.adelanto_metodo
  from public.cita_servicios cs
  join public.citas c on c.id = cs.cita_id
  left join lateral (
    select sum(va.monto) as aplicado
    from public.ventas_adelantos va
    join public.ventas v on v.id = va.venta_id and v.estado = 'ACTIVA'
    where va.cita_id = c.id
  ) ap on true
  where cs.registro_servicio_id = any (coalesce(p_registro_ids, '{}'::uuid[]))
    and c.adelanto is not null and c.adelanto > 0
  group by c.id, c.adelanto, ap.aplicado, c.adelanto_metodo
  having c.adelanto - coalesce(ap.aplicado, 0) > 0;
end;
$$;

revoke execute on function public.adelantos_pendientes_de_atenciones(uuid[]) from public, anon;
grant execute on function public.adelantos_pendientes_de_atenciones(uuid[]) to authenticated;

-- descuentos_cita_de_atenciones: descuento de cita aún sin aplicar, para las atenciones dadas --------------------------------
create or replace function public.descuentos_cita_de_atenciones(p_registro_ids uuid[])
returns table (cita_id uuid, descuento numeric, registro_ids uuid[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rol_actual() is null or public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'No tienes permiso para consultar esto' using errcode = '42501';
  end if;

  return query
  select c.id,
         c.descuento,
         array_agg(cs.registro_servicio_id)
  from public.cita_servicios cs
  join public.citas c on c.id = cs.cita_id
  where cs.registro_servicio_id = any (coalesce(p_registro_ids, '{}'::uuid[]))
    and c.descuento is not null and c.descuento > 0
    -- Pendiente = ninguna atención de la cita está ya en una venta ACTIVA (el descuento se aplica una sola vez).
    and not exists (
      select 1
      from public.cita_servicios cs2
      join public.registro_servicios rs on rs.id = cs2.registro_servicio_id
      join public.ventas v on v.id = rs.venta_id and v.estado = 'ACTIVA'
      where cs2.cita_id = c.id
    )
  group by c.id, c.descuento;
end;
$$;

revoke execute on function public.descuentos_cita_de_atenciones(uuid[]) from public, anon;
grant execute on function public.descuentos_cita_de_atenciones(uuid[]) to authenticated;

-- Trigger: ventas.adelanto_metodo ← método del adelanto de la(s) cita(s) cobradas en esa venta ------------------------------
create or replace function public.ventas_adelantos_copiar_metodo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ventas v
  set adelanto_metodo = (
    select string_agg(distinct c.adelanto_metodo, ', ')
    from public.ventas_adelantos va
    join public.citas c on c.id = va.cita_id
    where va.venta_id = new.venta_id and c.adelanto_metodo is not null
  )
  where v.id = new.venta_id;
  return null;
end;
$$;

drop trigger if exists ventas_adelantos_copiar_metodo on public.ventas_adelantos;
create trigger ventas_adelantos_copiar_metodo
  after insert on public.ventas_adelantos
  for each row execute function public.ventas_adelantos_copiar_metodo();

commit;
