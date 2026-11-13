-- Caja chica POS: un FONDO FIJO en efectivo para gastos menores del negocio (taxi, bolsas, útiles, agua…).
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): hasta ahora las cajeras anotaban esos gastitos en Gastos → variables
-- (20261001000080 ya lo llamaba «una especie de caja chica»), pero así no se sabía cuánto efectivo quedaba en la cajita ni
-- cuándo la dueña la había repuesto. No es el cuadre de ventas del día: no se conecta con Ventas ni Deudas.
--
-- REGLAS:
--   * La administradora fija el MONTO DEL FONDO (lo que debería haber con la caja llena, p. ej. S/ 200).
--   * SALIDA (gasto pagado con la caja): administradora, cajera y encargada (los roles que ya manejan Gastos / Ventas).
--     Con el negocio cerrado, solo la administradora. No deja sacar más que el saldo. Cada salida crea SOLA su gasto
--     VARIABLE del mes («Caja chica: <motivo>»), para que se anote una sola vez y Gastos / utilidad sigan completos.
--   * REPOSICIÓN (la dueña vuelve a poner dinero): solo la administradora. No es un gasto: no toca Gastos.
--   * CONTEO (la dueña cuenta el efectivo real): solo la administradora. Si no cuadra se registra un FALTANTE (que también
--     es gasto variable del mes) o un SOBRANTE, y el saldo queda igual a lo contado. Si cuadra queda un CONTEO de S/ 0 como
--     constancia de quién contó y cuándo.
--   * ANULAR: la administradora, cualquier salida o reposición; quien hizo una salida, solo la suya y el mismo día (hora de
--     Lima). Nada se borra: el movimiento queda ANULADO y su gasto pasa a CANCELADO. Faltantes / sobrantes / conteos no se
--     anulan: se corrigen volviendo a contar.
--
-- DISEÑO:
--   * El saldo NO se guarda: es la suma de los movimientos ACTIVOS (reposición y sobrante suman; salida y faltante
--     restan). Así nunca se descuadra con el historial. Cada escritura bloquea la fila única de caja_chica_config
--     (for update) para que dos salidas a la vez no dejen el saldo en negativo.
--   * Toda escritura pasa por funciones security definer (sin GRANT de escritura en las tablas), igual que Almacén.
--   * gastos.caja_chica_movimiento_id liga el gasto con su movimiento. Un trigger impide editar / cancelar / eliminar esos
--     gastos desde la API (pestaña Gastos): solo se cambian desde estas funciones, que lo indican con el ajuste de sesión
--     app.caja_chica_rpc. Si no, el gasto y el saldo quedarían distintos.
--   * caja_chica_config (el monto del fondo) queda en Auditoría con registrar_auditoria(). Los movimientos son su propio
--     historial (quién, cuándo, quién anuló).

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------------------------
create table public.caja_chica_config (
  id          smallint primary key default 1,
  monto_fondo numeric(10, 2) not null default 0 check (monto_fondo >= 0 and monto_fondo < 100000000),
  constraint caja_chica_config_singleton check (id = 1)
);

insert into public.caja_chica_config (id, monto_fondo) values (1, 0);

comment on table public.caja_chica_config is
  'Fila única: monto del fondo de caja chica. Solo se cambia con guardar_fondo_caja_chica().';

create table public.caja_chica_movimientos (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('SALIDA', 'REPOSICION', 'FALTANTE', 'SOBRANTE', 'CONTEO')),
  monto         numeric(10, 2) not null check (monto >= 0 and monto < 100000000),
  motivo        text check (motivo is null or char_length(motivo) between 1 and 80),
  nota          text check (nota is null or char_length(nota) <= 200),
  saldo_despues numeric(10, 2) not null,
  estado        text not null default 'ACTIVO' check (estado in ('ACTIVO', 'ANULADO')),
  usuario_id    uuid references public.usuarios (id) on delete set null,
  fecha         timestamptz not null default now(),
  anulado_por   uuid references public.usuarios (id) on delete set null,
  anulado_en    timestamptz,
  -- Solo el conteo exacto lleva S/ 0; el resto mueve dinero. La salida siempre dice en qué se gastó.
  constraint caja_chica_monto_positivo check (tipo = 'CONTEO' or monto > 0),
  constraint caja_chica_salida_con_motivo check (tipo <> 'SALIDA' or motivo is not null)
);

create index caja_chica_movimientos_fecha on public.caja_chica_movimientos (fecha desc);

comment on table public.caja_chica_movimientos is
  'Salidas, reposiciones y conteos de la caja chica. Solo los crean / anulan las funciones *_caja_chica().';

alter table public.caja_chica_config enable row level security;
alter table public.caja_chica_movimientos enable row level security;

-- Sin políticas ni GRANT: se leen con resumen_caja_chica() / movimientos_caja_chica(). Se revoca todo porque la base Local
-- da privilegios por defecto (producción no).
revoke all on table public.caja_chica_config from public, anon, authenticated;
revoke all on table public.caja_chica_movimientos from public, anon, authenticated;

drop trigger if exists auditoria_caja_chica_config on public.caja_chica_config;
create trigger auditoria_caja_chica_config
  after update on public.caja_chica_config
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Enlace con Gastos
-- ---------------------------------------------------------------------------------------------------------------
-- gastos tiene GRANT a nivel de tabla (20261001000004), así que la columna nueva ya se puede leer desde la pestaña Gastos.
alter table public.gastos
  add column if not exists caja_chica_movimiento_id uuid unique
    references public.caja_chica_movimientos (id) on delete restrict;

create or replace function public.proteger_gastos_caja_chica()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.caja_chica_rpc', true), '') = 'on' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'INSERT' then
    if NEW.caja_chica_movimiento_id is not null then
      raise exception 'Los gastos de caja chica se registran desde la pestaña Caja chica.' using errcode = 'P0001';
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.caja_chica_movimiento_id is not null then
      raise exception 'Este gasto viene de Caja chica: anúlalo desde la pestaña Caja chica.' using errcode = 'P0001';
    end if;
    return OLD;
  end if;

  -- UPDATE: solo se bloquea si cambia algo del gasto. creado_por puede pasar a null (FK on delete set null al eliminar
  -- un usuario) sin que esto lo impida.
  if (OLD.caja_chica_movimiento_id is not null or NEW.caja_chica_movimiento_id is not null)
     and (NEW.nombre, NEW.tipo, NEW.monto, NEW.mes, NEW.anio, NEW.estado, NEW.caja_chica_movimiento_id)
         is distinct from
         (OLD.nombre, OLD.tipo, OLD.monto, OLD.mes, OLD.anio, OLD.estado, OLD.caja_chica_movimiento_id) then
    raise exception 'Este gasto viene de Caja chica: anúlalo desde la pestaña Caja chica.' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists proteger_gastos_caja_chica on public.gastos;
create trigger proteger_gastos_caja_chica
  before insert or update or delete on public.gastos
  for each row execute function public.proteger_gastos_caja_chica();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Ayudantes internos (sin EXECUTE para la API)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.saldo_caja_chica()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    case
      when tipo in ('REPOSICION', 'SOBRANTE') then monto
      when tipo in ('SALIDA', 'FALTANTE') then -monto
      else 0
    end
  ), 0)::numeric(10, 2)
  from public.caja_chica_movimientos
  where estado = 'ACTIVO';
$$;

revoke execute on function public.saldo_caja_chica() from public, anon, authenticated;

create or replace function public.puede_usar_caja_chica()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.rol_actual() in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA'), false);
$$;

revoke execute on function public.puede_usar_caja_chica() from public, anon, authenticated;

-- Crea el gasto VARIABLE del mes en curso (hora de Lima) ligado a un movimiento.
create or replace function public.crear_gasto_caja_chica(p_movimiento_id uuid, p_nombre text, p_monto numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform set_config('app.caja_chica_rpc', 'on', true);
  insert into public.gastos (nombre, tipo, monto, mes, anio, creado_por, caja_chica_movimiento_id)
  values (p_nombre, 'VARIABLE', p_monto, extract(month from v_hoy)::int, extract(year from v_hoy)::int, auth.uid(),
          p_movimiento_id);
  perform set_config('app.caja_chica_rpc', '', true);
end;
$$;

revoke execute on function public.crear_gasto_caja_chica(uuid, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Salida (administradora, cajera, encargada)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.registrar_salida_caja_chica(p_monto numeric, p_motivo text, p_nota text)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_monto  numeric(10, 2) := round(p_monto, 2);
  v_saldo  numeric(10, 2);
  v_id     uuid;
begin
  if not public.puede_usar_caja_chica() then
    raise exception 'Solo la administradora, la cajera o la encargada pueden usar la caja chica.' using errcode = '42501';
  end if;
  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.' using errcode = 'P0001';
  end if;
  if v_monto is null or v_monto <= 0 or v_monto >= 100000000 then
    raise exception 'El monto debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if char_length(v_motivo) = 0 or char_length(v_motivo) > 80 then
    raise exception 'Escribe en qué se gastó (máximo 80 caracteres).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_nota, '')) > 200 then
    raise exception 'La nota no puede pasar de 200 caracteres.' using errcode = 'P0001';
  end if;

  perform 1 from public.caja_chica_config where id = 1 for update;
  v_saldo := public.saldo_caja_chica();
  if v_monto > v_saldo then
    raise exception 'Solo quedan S/ % en caja chica.', to_char(v_saldo, 'FM999999990.00') using errcode = 'P0001';
  end if;

  insert into public.caja_chica_movimientos (tipo, monto, motivo, nota, saldo_despues, usuario_id)
  values ('SALIDA', v_monto, v_motivo, nullif(btrim(p_nota), ''), v_saldo - v_monto, auth.uid())
  returning id into v_id;

  perform public.crear_gasto_caja_chica(v_id, 'Caja chica: ' || v_motivo, v_monto);

  return v_saldo - v_monto;
end;
$$;

revoke execute on function public.registrar_salida_caja_chica(numeric, text, text) from public, anon;
grant execute on function public.registrar_salida_caja_chica(numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Reposición (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.reponer_caja_chica(p_monto numeric, p_nota text)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_monto numeric(10, 2) := round(p_monto, 2);
  v_saldo numeric(10, 2);
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede reponer la caja chica.' using errcode = '42501';
  end if;
  if v_monto is null or v_monto <= 0 or v_monto >= 100000000 then
    raise exception 'El monto debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_nota, '')) > 200 then
    raise exception 'La nota no puede pasar de 200 caracteres.' using errcode = 'P0001';
  end if;

  perform 1 from public.caja_chica_config where id = 1 for update;
  v_saldo := public.saldo_caja_chica();

  insert into public.caja_chica_movimientos (tipo, monto, nota, saldo_despues, usuario_id)
  values ('REPOSICION', v_monto, nullif(btrim(p_nota), ''), v_saldo + v_monto, auth.uid());

  return v_saldo + v_monto;
end;
$$;

revoke execute on function public.reponer_caja_chica(numeric, text) from public, anon;
grant execute on function public.reponer_caja_chica(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Conteo (solo administradora). Devuelve la diferencia: contado − saldo (negativo = faltante).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.contar_caja_chica(p_contado numeric, p_nota text)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contado    numeric(10, 2) := round(p_contado, 2);
  v_saldo      numeric(10, 2);
  v_diferencia numeric(10, 2);
  v_id         uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede contar la caja chica.' using errcode = '42501';
  end if;
  if v_contado is null or v_contado < 0 or v_contado >= 100000000 then
    raise exception 'Escribe cuánto efectivo hay en la caja (0 o más).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_nota, '')) > 200 then
    raise exception 'La nota no puede pasar de 200 caracteres.' using errcode = 'P0001';
  end if;

  perform 1 from public.caja_chica_config where id = 1 for update;
  v_saldo := public.saldo_caja_chica();
  v_diferencia := v_contado - v_saldo;

  if v_diferencia = 0 then
    insert into public.caja_chica_movimientos (tipo, monto, motivo, nota, saldo_despues, usuario_id)
    values ('CONTEO', 0, 'Conteo: cuadra', nullif(btrim(p_nota), ''), v_saldo, auth.uid());
  elsif v_diferencia < 0 then
    insert into public.caja_chica_movimientos (tipo, monto, motivo, nota, saldo_despues, usuario_id)
    values ('FALTANTE', -v_diferencia, 'Faltante en conteo', nullif(btrim(p_nota), ''), v_contado, auth.uid())
    returning id into v_id;
    perform public.crear_gasto_caja_chica(v_id, 'Caja chica: faltante en conteo', -v_diferencia);
  else
    insert into public.caja_chica_movimientos (tipo, monto, motivo, nota, saldo_despues, usuario_id)
    values ('SOBRANTE', v_diferencia, 'Sobrante en conteo', nullif(btrim(p_nota), ''), v_contado, auth.uid());
  end if;

  return v_diferencia;
end;
$$;

revoke execute on function public.contar_caja_chica(numeric, text) from public, anon;
grant execute on function public.contar_caja_chica(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Anular (administradora: salidas y reposiciones; quien hizo una salida: la suya, el mismo día)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.anular_movimiento_caja_chica(p_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov   public.caja_chica_movimientos%rowtype;
  v_admin boolean := public.es_admin();
  v_saldo numeric(10, 2);
begin
  if not public.puede_usar_caja_chica() then
    raise exception 'Solo la administradora, la cajera o la encargada pueden usar la caja chica.' using errcode = '42501';
  end if;
  if not v_admin and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.' using errcode = 'P0001';
  end if;

  perform 1 from public.caja_chica_config where id = 1 for update;
  select * into v_mov from public.caja_chica_movimientos where id = p_id for update;
  if not found then
    raise exception 'Ese movimiento no existe.' using errcode = 'P0001';
  end if;
  if v_mov.estado = 'ANULADO' then
    raise exception 'Ese movimiento ya estaba anulado.' using errcode = 'P0001';
  end if;
  if v_mov.tipo not in ('SALIDA', 'REPOSICION') then
    raise exception 'Los conteos no se anulan: para corregirlo, vuelve a contar la caja.' using errcode = 'P0001';
  end if;
  if not v_admin then
    if v_mov.tipo <> 'SALIDA' or v_mov.usuario_id is distinct from auth.uid()
       or (v_mov.fecha at time zone 'America/Lima')::date <> (now() at time zone 'America/Lima')::date then
      raise exception 'Solo puedes anular tus propias salidas del día. Pídele a la administradora que la anule.'
        using errcode = '42501';
    end if;
  end if;

  v_saldo := public.saldo_caja_chica();
  if v_mov.tipo = 'REPOSICION' and v_saldo - v_mov.monto < 0 then
    raise exception 'No se puede anular: el saldo quedaría en negativo (ya se gastó parte de esa reposición).'
      using errcode = 'P0001';
  end if;

  update public.caja_chica_movimientos
     set estado = 'ANULADO', anulado_por = auth.uid(), anulado_en = now()
   where id = p_id;

  perform set_config('app.caja_chica_rpc', 'on', true);
  update public.gastos set estado = 'CANCELADO' where caja_chica_movimiento_id = p_id;
  perform set_config('app.caja_chica_rpc', '', true);

  return public.saldo_caja_chica();
end;
$$;

revoke execute on function public.anular_movimiento_caja_chica(uuid) from public, anon;
grant execute on function public.anular_movimiento_caja_chica(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Monto del fondo (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.guardar_fondo_caja_chica(p_monto numeric)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_monto numeric(10, 2) := round(p_monto, 2);
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede cambiar el fondo de caja chica.' using errcode = '42501';
  end if;
  if v_monto is null or v_monto < 0 or v_monto >= 100000000 then
    raise exception 'El fondo debe ser un monto de 0 o más.' using errcode = 'P0001';
  end if;

  update public.caja_chica_config set monto_fondo = v_monto where id = 1;
  return v_monto;
end;
$$;

revoke execute on function public.guardar_fondo_caja_chica(numeric) from public, anon;
grant execute on function public.guardar_fondo_caja_chica(numeric) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Lecturas
-- ---------------------------------------------------------------------------------------------------------------
-- Tarjetas de la pestaña. gastado_mes (salidas + faltantes activos del mes, hora de Lima) solo para la administradora.
create or replace function public.resumen_caja_chica()
returns table (saldo numeric, fondo numeric, gastado_mes numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.saldo_caja_chica(),
    c.monto_fondo,
    case when public.es_admin() then (
      select coalesce(sum(m.monto), 0)
      from public.caja_chica_movimientos m
      where m.estado = 'ACTIVO'
        and m.tipo in ('SALIDA', 'FALTANTE')
        and m.fecha >= (date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima')
    ) end
  from public.caja_chica_config c
  where c.id = 1 and public.puede_usar_caja_chica();
$$;

revoke execute on function public.resumen_caja_chica() from public, anon;
grant execute on function public.resumen_caja_chica() to authenticated;

-- Historial: p_periodo = 'HOY' | 'SEMANA' (desde el lunes) | 'MES' (desde el día 1), hora de Lima. Últimos 500.
-- puede_anular ya viene calculado para quien consulta (mismas reglas que anular_movimiento_caja_chica).
create or replace function public.movimientos_caja_chica(p_periodo text)
returns table (
  id uuid,
  fecha timestamptz,
  tipo text,
  monto numeric,
  motivo text,
  nota text,
  saldo_despues numeric,
  estado text,
  usuario_nombre text,
  anulado_por_nombre text,
  anulado_en timestamptz,
  puede_anular boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ahora as (select now() at time zone 'America/Lima' as lima)
  select m.id, m.fecha, m.tipo, m.monto, m.motivo, m.nota, m.saldo_despues, m.estado,
         u.nombre_completo, a.nombre_completo, m.anulado_en,
         m.estado = 'ACTIVO' and (
           (public.es_admin() and m.tipo in ('SALIDA', 'REPOSICION'))
           or (m.tipo = 'SALIDA' and m.usuario_id = auth.uid()
               and (m.fecha at time zone 'America/Lima')::date = (select lima from ahora)::date)
         )
  from public.caja_chica_movimientos m
  left join public.usuarios u on u.id = m.usuario_id
  left join public.usuarios a on a.id = m.anulado_por
  where public.puede_usar_caja_chica()
    and m.fecha >= (
      date_trunc(
        case upper(coalesce(p_periodo, 'MES')) when 'HOY' then 'day' when 'SEMANA' then 'week' else 'month' end,
        (select lima from ahora)
      ) at time zone 'America/Lima'
    )
  order by m.fecha desc
  limit 500;
$$;

revoke execute on function public.movimientos_caja_chica(text) from public, anon;
grant execute on function public.movimientos_caja_chica(text) to authenticated;

commit;
