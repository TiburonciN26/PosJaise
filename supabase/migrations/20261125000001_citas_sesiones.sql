-- =========================================================
-- Citas con VARIAS SESIONES (tratamientos): al agendar la primera, las siguientes se crean solas
--
-- Contexto: algunos servicios son tratamientos de varias sesiones (p. ej. 3 sesiones, una cada mes). La recepcionista no debería
-- acordarse de agendar las siguientes: al elegir el servicio y la fecha de la 1.ª, el sistema propone las demás (editables) y se
-- crean todas juntas.
--
-- REGLAS (confirmadas con el negocio, 2026-11-25):
--   · El adelanto y el descuento son SOLO de la primera sesión. Las siguientes nacen sin adelanto ni descuento.
--   · Todas llevan la misma clienta y la misma asistente; la fecha y la hora de cada una se pueden editar.
--   · Si se CANCELA la 1.ª sesión, o se marca como «NO ASISTIÓ», se cancelan las demás (las que sigan PENDIENTES; una ya completada
--     no se toca). Si se reactiva la 1.ª, vuelven las que se cancelaron por ese motivo (y solo esas).
--   · Cada sesión se completa y se cobra por separado, como una cita normal, con el mismo precio que la primera.
--
-- PIEZAS:
--   1. servicios.sesiones_total (1 = servicio normal) y servicios.sesiones_intervalo_dias (cada cuántos días se propone la siguiente).
--      Se configuran en Servicios (solo la administradora, como el resto de la ficha).
--   2. citas.serie_id / sesion_numero / sesiones_total: enlazan las sesiones. serie_id = id de la 1.ª sesión. Una cita suelta tiene los
--      tres en NULL. citas.cancelada_por_serie recuerda cuáles se cancelaron en cascada, para poder reactivarlas con la 1.ª.
--   3. guardar_cita_pos suma p_sesiones (jsonb, solo al CREAR): [{ fecha_hora, servicios: [{ servicio_id, duracion_min, precio }] }] —
--      una entrada por sesión siguiente, en orden (la primera entrada es la sesión 2). Se crea todo en la misma transacción. De 10 a
--      11 parámetros: DROP de la anterior para que PostgREST no vea dos candidatas.
--   4. Triggers de cancelación/reactivación en cascada (en el servidor, para que valgan sin importar desde dónde se cambie el estado).
--      La cascada corre con el mismo usuario, así que «quién canceló» (migración 20261122000003) queda igual en todas.
-- =========================================================

begin;

alter table public.servicios
  add column if not exists sesiones_total integer not null default 1
    check (sesiones_total between 1 and 12),
  add column if not exists sesiones_intervalo_dias integer
    check (sesiones_intervalo_dias is null or sesiones_intervalo_dias between 1 and 365);

alter table public.servicios
  drop constraint if exists servicios_sesiones_intervalo_chk;
alter table public.servicios
  add constraint servicios_sesiones_intervalo_chk
    check (sesiones_total = 1 or sesiones_intervalo_dias is not null);

alter table public.citas
  add column if not exists serie_id uuid,
  add column if not exists sesion_numero integer check (sesion_numero is null or sesion_numero >= 1),
  add column if not exists sesiones_total integer check (sesiones_total is null or sesiones_total >= 2),
  add column if not exists cancelada_por_serie boolean not null default false;

create index if not exists idx_citas_serie_id on public.citas (serie_id) where serie_id is not null;

-- guardar_cita_pos ------------------------------------------------------------------------------------------------------------
drop function if exists public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb, numeric, text);

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
  p_adelanto_metodo           text default null,
  p_sesiones                  jsonb default null -- [{ "fecha_hora": timestamptz, "servicios": [ ...igual que p_servicios ] }, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita_id  uuid;
  v_item     jsonb;
  v_sesion   jsonb;
  v_n        integer;
  v_duracion int;
  v_precio   numeric;
  v_total    numeric := 0;
  v_metodo   text;
  v_extra    integer := coalesce(jsonb_array_length(p_sesiones), 0);
  v_fecha    timestamptz;
  v_hija     uuid;
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

  -- Sesiones siguientes: solo al CREAR (editar una sesión no toca a las demás) y bien formadas.
  if v_extra > 0 then
    if p_cita_id is not null then
      raise exception 'Las sesiones siguientes solo se programan al crear la cita.';
    end if;
    if v_extra > 11 then
      raise exception 'Un tratamiento puede tener hasta 12 sesiones.';
    end if;
    for v_sesion in select * from jsonb_array_elements(p_sesiones)
    loop
      v_fecha := (v_sesion->>'fecha_hora')::timestamptz;
      if v_fecha is null or v_fecha <= p_fecha_hora then
        raise exception 'Cada sesión siguiente debe ser después de la primera.';
      end if;
      if v_sesion->'servicios' is null or jsonb_array_length(v_sesion->'servicios') = 0 then
        raise exception 'Hay una sesión siguiente sin servicios.';
      end if;
      for v_item in select * from jsonb_array_elements(v_sesion->'servicios')
      loop
        if (v_item->>'servicio_id') is null
           or coalesce((v_item->>'duracion_min')::int, 0) <= 0
           or coalesce((v_item->>'precio')::numeric, -1) < 0 then
          raise exception 'Hay un servicio inválido en una sesión siguiente.';
        end if;
      end loop;
    end loop;
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

  -- Sesiones siguientes: misma clienta y asistente, sin adelanto ni descuento (son solo de la primera).
  if v_extra > 0 then
    update public.citas
    set serie_id = v_cita_id, sesion_numero = 1, sesiones_total = v_extra + 1
    where id = v_cita_id;

    v_n := 1;
    for v_sesion in select * from jsonb_array_elements(p_sesiones)
    loop
      v_n := v_n + 1;
      insert into public.citas (
        cliente_id, cliente_nombre_referencia, asistente_id, fecha_hora, nota, creado_por,
        serie_id, sesion_numero, sesiones_total
      )
      values (
        p_cliente_id, p_cliente_nombre_referencia, p_asistente_id, (v_sesion->>'fecha_hora')::timestamptz, p_nota, auth.uid(),
        v_cita_id, v_n, v_extra + 1
      )
      returning id into v_hija;

      for v_item in select * from jsonb_array_elements(v_sesion->'servicios')
      loop
        insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
        values (
          v_hija,
          (v_item->>'servicio_id')::uuid,
          (v_item->>'duracion_min')::int,
          (v_item->>'precio')::numeric
        );
      end loop;
    end loop;
  end if;

  return v_cita_id;
end;
$$;

revoke execute on function public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb, numeric, text, jsonb) from public, anon;
grant execute on function public.guardar_cita_pos(uuid, uuid, text, uuid, timestamptz, text, numeric, jsonb, numeric, text, jsonb) to authenticated;

-- Cascada de estado ----------------------------------------------------------------------------------------------------------
-- BEFORE: una cita que ya no está cancelada deja de estar «cancelada por la serie».
create or replace function public.citas_limpiar_cancelada_por_serie()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.estado <> 'CANCELADA' then
    new.cancelada_por_serie := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_citas_limpiar_cancelada_por_serie on public.citas;
create trigger trg_citas_limpiar_cancelada_por_serie
  before update of estado on public.citas
  for each row execute function public.citas_limpiar_cancelada_por_serie();

-- AFTER: cancelar o marcar «no asistió» (o reactivar) la 1.ª sesión arrastra a las demás: las futuras quedan CANCELADAS.
create or replace function public.citas_cascada_sesiones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.serie_id is null or new.sesion_numero is distinct from 1 then
    return null;
  end if;

  if new.estado in ('CANCELADA', 'NO_ASISTIO') and old.estado not in ('CANCELADA', 'NO_ASISTIO') then
    update public.citas
       set estado = 'CANCELADA', cancelada_por_serie = true
     where serie_id = new.serie_id and id <> new.id and estado = 'PENDIENTE';
  elsif old.estado in ('CANCELADA', 'NO_ASISTIO') and new.estado = 'PENDIENTE' then
    update public.citas
       set estado = 'PENDIENTE'
     where serie_id = new.serie_id and id <> new.id and estado = 'CANCELADA' and cancelada_por_serie;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_citas_cascada_sesiones on public.citas;
create trigger trg_citas_cascada_sesiones
  after update of estado on public.citas
  for each row
  when (new.estado is distinct from old.estado)
  execute function public.citas_cascada_sesiones();

commit;
