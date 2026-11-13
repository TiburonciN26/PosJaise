-- Apertura y cierre AUTOMÁTICO del negocio para el personal del POS, con horario editable por día.
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): hoy la administradora tiene que cerrar el negocio A MANO
-- (estado_negocio.abierto, interruptor del menú de usuario) para que cajeras / asistentes / encargadas / personal de
-- apoyo ya no puedan ingresar ni registrar nada. Quiere que se abra y se cierre solo, a la hora que ella fije para cada
-- día. Es un horario del POS, distinto del horario de atención de la web (horario_semanal, 20261112000004).
--
-- CÓMO FUNCIONA:
--   * horario_pos: una fila por día ISO (1 = lunes … 7 = domingo) con hora de apertura y de cierre; día sin horas =
--     ese día no se abre solo.
--   * horario_pos_estado (fila única): interruptor general «automático» (apagado al aplicar: nada cambia hasta que la
--     admin lo active) y el último evento aplicado.
--   * aplicar_horario_pos(): la corre pg_cron cada minuto. Busca el evento programado más reciente que ya pasó
--     (apertura → abierto, cierre → cerrado) y lo aplica UNA sola vez a estado_negocio.abierto. Por eso:
--       - si se pierde una corrida, la siguiente igual lo aplica (no depende de caer justo en el minuto);
--       - la admin puede seguir abriendo/cerrando a mano entre eventos: su cambio se respeta hasta el siguiente evento
--         programado (p. ej. abre un domingo para inventario y queda abierto hasta que ella cierre o llegue el próximo
--         cierre programado).
--     Se cambia SOLO la columna abierto: todo lo que ya bloquea con el negocio cerrado (login del personal en
--     AuthContext, negocio_abierto() en RLS/RPC, Realtime del interruptor) sigue funcionando igual. La administradora
--     nunca queda bloqueada.
--     El trigger de auditoría de estado_negocio registra el cambio sin usuario (no hay sesión); se completa con
--     «Automático (horario del POS)» para que en Auditoría se distinga de un cambio manual.
--   * horario_pos_config(): lectura para el personal (el menú muestra «cierra hoy a las …»); las clientas no lo ven.
--   * guardar_horario_pos(p_automatico, p_dias): solo ADMINISTRADOR; valida, deja auditoría legible por día y, si el
--     modo automático queda activo, ajusta el estado al horario EN ESE MOMENTO (devuelve cómo quedó).
--
-- PRODUCCIÓN: requiere la extensión pg_cron (disponible en Supabase; esta migración la activa).

begin;

create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------------------------
create table public.horario_pos (
  dia            smallint primary key check (dia between 1 and 7),
  apertura       time,
  cierre         time,
  actualizado_en timestamptz not null default now(),
  constraint horario_pos_horas_validas check (
    (apertura is null and cierre is null) or (apertura is not null and cierre is not null and apertura < cierre)
  )
);

comment on table public.horario_pos is
  'Apertura/cierre automático del POS por día ISO (1=lunes … 7=domingo). Se edita con guardar_horario_pos().';

create table public.horario_pos_estado (
  id             smallint primary key default 1 check (id = 1),
  automatico     boolean not null default false,
  ultimo_evento  timestamptz,
  actualizado_en timestamptz not null default now()
);

alter table public.horario_pos enable row level security;
alter table public.horario_pos_estado enable row level security;
revoke all on table public.horario_pos from public, anon, authenticated;
revoke all on table public.horario_pos_estado from public, anon, authenticated;

-- Propuesta inicial: lo que ya atiende la web (de la apertura del primer turno al cierre del último). El modo automático
-- arranca APAGADO, así que esto no cambia nada hasta que la administradora lo revise y lo active.
insert into public.horario_pos (dia, apertura, cierre)
select d.dia, h.bloque1_inicio, coalesce(h.bloque2_fin, h.bloque1_fin)
from generate_series(1, 7) as d(dia)
left join public.horario_semanal h on h.dia = d.dia;

insert into public.horario_pos_estado (id, automatico) values (1, false);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Aplicar el horario (pg_cron, cada minuto)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.aplicar_horario_pos()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado  public.horario_pos_estado%rowtype;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_momento timestamptz;
  v_abrir   boolean;
  v_actual  boolean;
begin
  select * into v_estado from public.horario_pos_estado where id = 1 for update;
  if not found or not v_estado.automatico then
    return null;
  end if;

  -- Evento programado más reciente que ya pasó (mira hasta 7 días atrás: cubre semanas con días cerrados).
  select e.momento, e.abrir into v_momento, v_abrir
  from generate_series(0, 7) as g(n)
  join public.horario_pos h
    on h.dia = extract(isodow from v_hoy - g.n)::int and h.apertura is not null
  cross join lateral (
    values
      ((((v_hoy - g.n) + h.apertura) at time zone 'America/Lima'), true),
      ((((v_hoy - g.n) + h.cierre) at time zone 'America/Lima'), false)
  ) as e(momento, abrir)
  where e.momento <= now()
  order by e.momento desc
  limit 1;

  if v_momento is null or v_momento <= coalesce(v_estado.ultimo_evento, '-infinity'::timestamptz) then
    return null;
  end if;

  update public.horario_pos_estado set ultimo_evento = v_momento where id = 1;

  select abierto into v_actual from public.estado_negocio where id = 1;
  if v_actual is distinct from v_abrir then
    update public.estado_negocio set abierto = v_abrir where id = 1;
    -- El trigger de auditoría no tiene usuario (corre sin sesión): marcar ese registro como automático.
    -- now() es el mismo en toda la transacción, igual que el default de auditoria.fecha.
    update public.auditoria
       set usuario_email = 'Automático (horario del POS)'
     where tabla = 'estado_negocio' and fecha = now() and usuario_email is null;
  end if;

  return v_abrir;
end;
$$;

revoke execute on function public.aplicar_horario_pos() from public, anon, authenticated;

-- Nombre fijo: volver a correr esta línea actualiza el job en vez de duplicarlo.
select cron.schedule('aplicar-horario-pos', '* * * * *', 'select public.aplicar_horario_pos()');

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Lectura (solo personal)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.horario_pos_config()
returns table (dia smallint, apertura time, cierre time, automatico boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.dia, h.apertura, h.cierre, e.automatico
  from public.horario_pos h
  cross join public.horario_pos_estado e
  where public.rol_actual() is not null
  order by h.dia;
$$;

revoke execute on function public.horario_pos_config() from public, anon;
grant execute on function public.horario_pos_config() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Guardar (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
-- p_dias: los 7 días, p. ej. [{"dia":1,"apertura":"09:30","cierre":"21:00"}, {"dia":7,"apertura":null,"cierre":null}, …]
-- Devuelve si el negocio quedó abierto (true/false) tras ajustarse al horario, o null si el modo automático está apagado.
create or replace function public.guardar_horario_pos(p_automatico boolean, p_dias jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombres constant text[] := array['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  v_email   text;
  v_item    jsonb;
  v_dia     int;
  v_vistos  int[] := '{}';
  v_ap      time;
  v_ci      time;
  v_ant     public.horario_pos%rowtype;
  v_auto_antes boolean;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede cambiar el horario del POS.' using errcode = '42501';
  end if;
  if p_automatico is null then
    raise exception 'Indica si la apertura y el cierre automático quedan activos.' using errcode = 'P0001';
  end if;
  if p_dias is null or jsonb_typeof(p_dias) <> 'array' or jsonb_array_length(p_dias) <> 7 then
    raise exception 'Envía el horario de los 7 días de la semana.' using errcode = 'P0001';
  end if;

  select email into v_email from public.usuarios where id = auth.uid();

  for v_item in select value from jsonb_array_elements(p_dias) loop
    begin
      v_dia := (v_item->>'dia')::int;
      v_ap  := nullif(v_item->>'apertura', '')::time;
      v_ci  := nullif(v_item->>'cierre', '')::time;
    exception when others then
      raise exception 'El horario enviado tiene una hora inválida.' using errcode = 'P0001';
    end;

    if v_dia is null or v_dia not between 1 and 7 or v_dia = any(v_vistos) then
      raise exception 'El horario enviado tiene un día inválido o repetido.' using errcode = 'P0001';
    end if;
    v_vistos := v_vistos || v_dia;

    if (v_ap is null) <> (v_ci is null) then
      raise exception '%: completa la hora de apertura y la de cierre.', v_nombres[v_dia] using errcode = 'P0001';
    end if;
    if v_ap is not null and v_ap >= v_ci then
      raise exception '%: la hora de cierre debe ser después de la apertura.', v_nombres[v_dia] using errcode = 'P0001';
    end if;

    select * into v_ant from public.horario_pos where dia = v_dia for update;
    if not found or v_ant.apertura is distinct from v_ap or v_ant.cierre is distinct from v_ci then
      insert into public.horario_pos (dia, apertura, cierre, actualizado_en)
      values (v_dia, v_ap, v_ci, now())
      on conflict (dia) do update
        set apertura = excluded.apertura, cierre = excluded.cierre, actualizado_en = excluded.actualizado_en;

      insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
      values (
        v_email, 'horario_pos', v_dia::text, v_nombres[v_dia], 'horario',
        case when v_ant.apertura is null then 'No abre solo'
             else to_char(v_ant.apertura, 'HH24:MI') || '-' || to_char(v_ant.cierre, 'HH24:MI') end,
        case when v_ap is null then 'No abre solo'
             else to_char(v_ap, 'HH24:MI') || '-' || to_char(v_ci, 'HH24:MI') end
      );
    end if;
  end loop;

  select automatico into v_auto_antes from public.horario_pos_estado where id = 1 for update;
  if v_auto_antes is distinct from p_automatico then
    insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
    values (
      v_email, 'horario_pos', '0', 'Apertura y cierre automático', 'automatico',
      case when v_auto_antes then 'activado' else 'desactivado' end,
      case when p_automatico then 'activado' else 'desactivado' end
    );
  end if;

  -- Al guardar, el estado se ajusta al horario recién guardado (ultimo_evento = null obliga a reaplicar).
  update public.horario_pos_estado
     set automatico = p_automatico, ultimo_evento = null, actualizado_en = now()
   where id = 1;

  if not p_automatico then
    return null;
  end if;
  perform public.aplicar_horario_pos();
  return (select abierto from public.estado_negocio where id = 1);
end;
$$;

revoke execute on function public.guardar_horario_pos(boolean, jsonb) from public, anon;
grant execute on function public.guardar_horario_pos(boolean, jsonb) to authenticated;

commit;
