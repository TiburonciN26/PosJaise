-- Apertura/cierre automático del POS: segundo horario OPCIONAL por día.
--
-- POR QUÉ (pedido de la dueña, 2026-11-12, al revisar 20261112000005): por defecto cada día tiene un solo horario
-- (p. ej. 10:00-20:30), pero en los días que ella quiera debe poder poner dos (10:00-13:00 y 15:00-20:30). En el
-- descanso entre ambos el negocio se CIERRA solo para el personal y a las 15:00 se vuelve a abrir.
--
-- QUÉ SE TOCA:
--   * horario_pos: columnas apertura2 / cierre2 (null = sin segundo horario). El CHECK exige que el segundo empiece
--     después de que termine el primero.
--   * aplicar_horario_pos(): los eventos del día pasan a ser hasta 4 (abre, cierra, abre, cierra). El resto igual.
--   * horario_pos_config(): devuelve también apertura2 / cierre2 (cambia el tipo de retorno: drop + create).
--   * guardar_horario_pos(): recibe apertura2 / cierre2 por día; mismos mensajes que el horario de la web
--     («primer turno» / «segundo turno») porque el modal comparte el editor con ese horario.

begin;

alter table public.horario_pos
  add column apertura2 time,
  add column cierre2   time;

alter table public.horario_pos drop constraint horario_pos_horas_validas;
alter table public.horario_pos add constraint horario_pos_horas_validas check (
  (apertura is null and cierre is null and apertura2 is null and cierre2 is null)
  or (
    apertura is not null and cierre is not null and apertura < cierre
    and (
      (apertura2 is null and cierre2 is null)
      or (apertura2 is not null and cierre2 is not null and cierre < apertura2 and apertura2 < cierre2)
    )
  )
);

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
      ((((v_hoy - g.n) + h.cierre) at time zone 'America/Lima'), false),
      ((((v_hoy - g.n) + h.apertura2) at time zone 'America/Lima'), true),
      ((((v_hoy - g.n) + h.cierre2) at time zone 'America/Lima'), false)
  ) as e(momento, abrir)
  where e.momento is not null and e.momento <= now()
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

-- ---------------------------------------------------------------------------------------------------------------
drop function public.horario_pos_config();

create function public.horario_pos_config()
returns table (dia smallint, apertura time, cierre time, apertura2 time, cierre2 time, automatico boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.dia, h.apertura, h.cierre, h.apertura2, h.cierre2, e.automatico
  from public.horario_pos h
  cross join public.horario_pos_estado e
  where public.rol_actual() is not null
  order by h.dia;
$$;

revoke execute on function public.horario_pos_config() from public, anon;
grant execute on function public.horario_pos_config() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- p_dias: los 7 días, p. ej. [{"dia":1,"apertura":"10:00","cierre":"13:00","apertura2":"15:00","cierre2":"20:30"}, …]
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
  v_ap2     time;
  v_ci2     time;
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
      v_ap2 := nullif(v_item->>'apertura2', '')::time;
      v_ci2 := nullif(v_item->>'cierre2', '')::time;
    exception when others then
      raise exception 'El horario enviado tiene una hora inválida.' using errcode = 'P0001';
    end;

    if v_dia is null or v_dia not between 1 and 7 or v_dia = any(v_vistos) then
      raise exception 'El horario enviado tiene un día inválido o repetido.' using errcode = 'P0001';
    end if;
    v_vistos := v_vistos || v_dia;

    -- Mismas reglas y mensajes que guardar_horario_atencion() (el modal comparte el editor).
    if v_ap is null and v_ci is null then
      if v_ap2 is not null or v_ci2 is not null then
        raise exception '%: falta el primer turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
    else
      if v_ap is null or v_ci is null then
        raise exception '%: completa el inicio y el fin del primer turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if v_ap >= v_ci then
        raise exception '%: el primer turno debe terminar después de empezar.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if (v_ap2 is null) <> (v_ci2 is null) then
        raise exception '%: completa el inicio y el fin del segundo turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if v_ap2 is not null then
        if v_ap2 <= v_ci then
          raise exception '%: el segundo turno debe empezar después de que termine el primero.', v_nombres[v_dia]
            using errcode = 'P0001';
        end if;
        if v_ap2 >= v_ci2 then
          raise exception '%: el segundo turno debe terminar después de empezar.', v_nombres[v_dia] using errcode = 'P0001';
        end if;
      end if;
    end if;

    select * into v_ant from public.horario_pos where dia = v_dia for update;
    if not found
       or v_ant.apertura is distinct from v_ap or v_ant.cierre is distinct from v_ci
       or v_ant.apertura2 is distinct from v_ap2 or v_ant.cierre2 is distinct from v_ci2 then
      insert into public.horario_pos (dia, apertura, cierre, apertura2, cierre2, actualizado_en)
      values (v_dia, v_ap, v_ci, v_ap2, v_ci2, now())
      on conflict (dia) do update
        set apertura = excluded.apertura, cierre = excluded.cierre,
            apertura2 = excluded.apertura2, cierre2 = excluded.cierre2,
            actualizado_en = excluded.actualizado_en;

      insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
      values (
        v_email, 'horario_pos', v_dia::text, v_nombres[v_dia], 'horario',
        case when v_ant.apertura is null then 'No abre solo'
             else to_char(v_ant.apertura, 'HH24:MI') || '-' || to_char(v_ant.cierre, 'HH24:MI')
               || coalesce(' y ' || to_char(v_ant.apertura2, 'HH24:MI') || '-' || to_char(v_ant.cierre2, 'HH24:MI'), '')
        end,
        case when v_ap is null then 'No abre solo'
             else to_char(v_ap, 'HH24:MI') || '-' || to_char(v_ci, 'HH24:MI')
               || coalesce(' y ' || to_char(v_ap2, 'HH24:MI') || '-' || to_char(v_ci2, 'HH24:MI'), '')
        end
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
