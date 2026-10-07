-- =========================================================
-- BORRADOR — Recompensas Fase 2: apertura histórica ×5 (decisiones A y B aprobadas).
--
-- NO está en supabase/migrations/ A PROPÓSITO: nada debe aplicarlo por accidente (ni `db push`, ni `db reset`, ni
-- `migration up`). Solo se ha ensayado en la instancia desechable «JaiseEnsayo» (ver PLAN-LOTE-SIGUIENTE.md y
-- RESULTADOS-ENSAYO.md). Pasar a migración y aplicarlo en QA o producción requiere autorización aparte.
--
-- Qué hace
--   · recompensas_ejecutar_apertura(p_corte, p_ejecutar): con p_ejecutar = false solo INFORMA (no escribe). Con true escribe
--     la apertura de todas las clientas aún no procesadas. Idempotente por clienta.
--   · Vinculadas (cliente_web_id): un movimiento APERTURA (monedas = puntos antiguos × 5 y clasificación inicial igual) y,
--     si corresponde, un movimiento de sellos APERTURA = visitas − 5 × reclamadas (íntegro: puede superar 20 o ser negativo).
--   · Decisión A — sin cuenta web: el saldo queda CONGELADO al corte en recompensas_apertura_espera. Al vincular la cuenta a
--     la misma ficha se habilita UNA sola vez (disparador). No se recalcula con actividad posterior ni se acreditan las
--     compras hechas sin cuenta; desvincular/revincular u otra cuenta no abre otra vez (la clave es la ficha).
--   · Decisión B — anular una venta histórica no descuenta apertura: anular_venta solo revierte movimientos VENTA de esa
--     venta, y las atenciones anteriores al corte están en el mapa de aportes (confirmar_venta no las acredita de nuevo).
--   · Atribución auditable en recompensas_apertura_aportes (ATENCION, VISITA_DIA, BONO_MANUAL, REDONDEO): suma exacta de los
--     puntos antiguos.
--   · Reversibilidad: recompensas_apertura_reversible() dice, por clienta, si borrar su apertura es seguro. NO lo es si ya hay
--     ventas, canjes o movimientos posteriores; entonces la única vía es restaurar la copia previa.
--
-- Concurrencia y ventana corte→apertura→activación (v2, tras el ensayo de concurrencia):
--   · MODO DEFINITIVO (p_corte nulo, p_ejecutar = true): bajo bloqueo de las tablas ventas, registro_servicios y clientes
--     (SHARE ROW EXCLUSIVE; las escrituras de otras sesiones ESPERAN, con lock_timeout de 15 s) el corte se toma del reloj
--     DENTRO del bloqueo, y con p_activar = true Recompensas se activa en la MISMA transacción. No hay hueco entre el corte,
--     la apertura y la activación. El corte del ensayo NO se reutiliza: el modo definitivo nunca recibe un corte de fuera.
--   · p_corte explícito solo sirve para dry-run y ensayos (no bloquea tablas).
--   · Revertir una apertura exige Recompensas APAGADO y bloquea la fila de la clienta y la de configuración; así ni una venta
--     ni un canje ni una activación pueden intercalarse. Con el programa activo la única recuperación es restaurar la copia.
--
-- Precondiciones que la función verifica (si falla una, no escribe): administrador; corte no futuro; Recompensas APAGADO;
-- corte de configuración nulo o igual al pedido; umbrales de recompensas_config = antiguos ×5; sellos_por_premio = 5; ninguna
-- clienta por procesar con aportes preexistentes (bloqueo).
-- Fórmula antigua (idéntica a recompensas_simular_transicion): atenciones ACTIVO anteriores al corte;
--   puntos = floor(visitas·puntos_por_visita + gastado·puntos_por_sol_gastado) + puntos_bono.
-- =========================================================

begin;

create table public.recompensas_apertura_espera (
  cliente_id      uuid primary key references public.clientes (id),
  corte           timestamptz not null,
  puntos_antiguos int not null,
  monedas         numeric(18, 8) not null,
  clasificacion   numeric(18, 8) not null,
  sellos          int not null,
  estado          text not null default 'EN_ESPERA' check (estado in ('EN_ESPERA', 'HABILITADA')),
  detalle         jsonb,
  creado_en       timestamptz not null default now(),
  habilitada_en   timestamptz
);
alter table public.recompensas_apertura_espera enable row level security;
revoke all on public.recompensas_apertura_espera from anon, authenticated;
grant select on public.recompensas_apertura_espera to authenticated;
create policy recompensas_espera_select on public.recompensas_apertura_espera
  for select to authenticated using (public.es_admin());

-- Cálculo común (solo lectura, interno).
create or replace function public._recompensas_apertura_calculo(p_corte timestamptz)
returns table (
  cliente_id uuid, vinculada boolean, visitas int, gastado numeric, bono int,
  puntos int, redondeo numeric, reclamadas int, sellos int
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with cfg as (select * from public.config_puntos where id = 1),
  base as (
    select c.id as cid, (c.cliente_web_id is not null) as vinc,
           coalesce(c.puntos_bono, 0) as bono,
           coalesce(c.fidelizacion_recompensas_reclamadas, 0) as recl,
           count(distinct (rs.fecha at time zone 'America/Lima')::date)
             filter (where rs.estado = 'ACTIVO' and rs.fecha < p_corte)::int as vis,
           coalesce(sum(rs.precio) filter (where rs.estado = 'ACTIVO' and rs.fecha < p_corte), 0) as gas
    from public.clientes c
    left join public.registro_servicios rs on rs.cliente_id = c.id
    group by c.id
  )
  select b.cid, b.vinc, b.vis, b.gas, b.bono,
         floor(b.vis * cfg.puntos_por_visita + b.gas * cfg.puntos_por_sol_gastado)::int + b.bono,
         floor(b.vis * cfg.puntos_por_visita + b.gas * cfg.puntos_por_sol_gastado)
           - (b.vis * cfg.puntos_por_visita + b.gas * cfg.puntos_por_sol_gastado),
         b.recl,
         b.vis - 5 * b.recl
  from base b, cfg;
$$;
revoke execute on function public._recompensas_apertura_calculo(timestamptz) from public, anon, authenticated;

-- Escritura de la apertura de UNA clienta vinculada a partir de valores ya calculados o congelados. Idempotente por clave.
create or replace function public._recompensas_apertura_escribir(
  p_cliente_id uuid, p_corte timestamptz, p_puntos int, p_sellos int, p_detalle jsonb
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clasificacion, clave, detalle)
  values (p_cliente_id, 'APERTURA', p_puntos * 5, p_puntos * 5, 'apertura:' || p_cliente_id, p_detalle)
  on conflict (clave) do nothing;
  if p_sellos <> 0 then
    insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, clave, detalle)
    values (p_cliente_id, 'APERTURA', p_sellos, 'apertura-sellos:' || p_cliente_id, p_detalle)
    on conflict (clave) do nothing;
  end if;
end;
$$;
revoke execute on function public._recompensas_apertura_escribir(uuid, timestamptz, int, int, jsonb) from public, anon, authenticated;

create or replace function public.recompensas_ejecutar_apertura(
  p_corte timestamptz, p_ejecutar boolean default false, p_activar boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.config_puntos;
  v_rc  public.recompensas_config;
  v_bloqueos int;
  v_pend int;
  v_vinc int;
  v_esp int;
  v_puntos_vinc bigint;
  v_sellos_vinc bigint;
  v_puntos_esp bigint;
  v_definitivo boolean := (p_corte is null);
  r jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ejecutar la apertura.';
  end if;
  if v_definitivo and not p_ejecutar then
    raise exception 'El modo definitivo (corte nulo) exige p_ejecutar = true; para un dry-run indique un corte.';
  end if;
  if p_activar and not p_ejecutar then
    raise exception 'p_activar solo se admite junto con p_ejecutar = true.';
  end if;
  if not v_definitivo and p_corte > now() then
    raise exception 'El corte no puede estar en el futuro.';
  end if;
  perform pg_advisory_xact_lock(hashtext('recompensas_apertura'));

  if v_definitivo then
    -- Las escrituras de otras sesiones esperan hasta nuestro COMMIT; el corte se toma con el bloqueo ya tomado.
    set local lock_timeout = '15s';
    -- ORDEN DE BLOQUEO = el de una venta (insert en ventas → update de registro_servicios). Con otro orden, una venta en vuelo
    -- y esta apertura se bloquean mutuamente (deadlock) y Postgres cancelaría la VENTA; con este orden la apertura espera.
    lock table public.ventas, public.registro_servicios, public.clientes in share row exclusive mode;
    p_corte := clock_timestamp();
  end if;

  select * into v_cfg from public.config_puntos where id = 1;
  -- Bloquea la configuración: nadie puede activar ni cambiar el corte mientras se escribe la apertura.
  select * into v_rc from public.recompensas_config where id = 1 for update;
  if v_rc.activo then
    raise exception 'Recompensas ya está activo: la apertura se ejecuta antes de activarlo.';
  end if;
  if v_rc.corte is not null and v_rc.corte <> p_corte then
    raise exception 'Ya existe un corte distinto (%).', v_rc.corte;
  end if;
  if v_rc.umbral_premium <> v_cfg.umbral_premium * 5 or v_rc.umbral_vip <> v_cfg.umbral_vip * 5 then
    raise exception 'Los umbrales de recompensas_config no son los antiguos ×5.';
  end if;
  if v_rc.sellos_por_premio <> 5 then
    raise exception 'sellos_por_premio debe ser 5 para que la conversión de sellos sea exacta.';
  end if;

  create temporary table _ap_pend on commit drop as
  select k.*
  from public._recompensas_apertura_calculo(p_corte) k
  where not exists (select 1 from public.recompensas_movimientos m where m.clave = 'apertura:' || k.cliente_id)
    and not exists (select 1 from public.recompensas_apertura_espera e where e.cliente_id = k.cliente_id);

  select count(*), count(*) filter (where vinculada), count(*) filter (where not vinculada),
         coalesce(sum(puntos) filter (where vinculada), 0), coalesce(sum(sellos) filter (where vinculada), 0),
         coalesce(sum(puntos) filter (where not vinculada), 0)
    into v_pend, v_vinc, v_esp, v_puntos_vinc, v_sellos_vinc, v_puntos_esp
  from _ap_pend;

  select count(distinct a.cliente_id) into v_bloqueos
  from public.recompensas_apertura_aportes a join _ap_pend p on p.cliente_id = a.cliente_id;

  r := jsonb_build_object(
    'corte', p_corte, 'ejecutado', false, 'modo', case when v_definitivo then 'definitivo' else 'ensayo' end,
    'clientas_por_procesar', v_pend, 'vinculadas', v_vinc, 'en_espera', v_esp,
    'puntos_antiguos_vinculadas', v_puntos_vinc, 'monedas_apertura_vinculadas', v_puntos_vinc * 5,
    'sellos_netos_vinculadas', v_sellos_vinc, 'puntos_congelados_en_espera', v_puntos_esp,
    'bloqueos_aportes_preexistentes', v_bloqueos);

  if not p_ejecutar then
    return r;
  end if;
  if v_bloqueos > 0 then
    raise exception 'Hay % clienta(s) por procesar con aportes de apertura preexistentes; no se escribe nada.', v_bloqueos;
  end if;

  -- Mapa de aportes (todas las clientas procesadas, vinculadas o en espera).
  insert into public.recompensas_apertura_aportes (cliente_id, origen, registro_servicio_id, dia, puntos_antiguos, monedas)
  select rs.cliente_id, 'ATENCION', rs.id, (rs.fecha at time zone 'America/Lima')::date,
         rs.precio * v_cfg.puntos_por_sol_gastado, rs.precio * v_cfg.puntos_por_sol_gastado * 5
  from public.registro_servicios rs join _ap_pend p on p.cliente_id = rs.cliente_id
  where rs.estado = 'ACTIVO' and rs.fecha < p_corte;

  insert into public.recompensas_apertura_aportes (cliente_id, origen, dia, puntos_antiguos, monedas)
  select d.cliente_id, 'VISITA_DIA', d.dia, v_cfg.puntos_por_visita, v_cfg.puntos_por_visita * 5
  from (select distinct rs.cliente_id, (rs.fecha at time zone 'America/Lima')::date as dia
          from public.registro_servicios rs join _ap_pend p on p.cliente_id = rs.cliente_id
         where rs.estado = 'ACTIVO' and rs.fecha < p_corte) d;

  insert into public.recompensas_apertura_aportes (cliente_id, origen, puntos_antiguos, monedas)
  select p.cliente_id, 'BONO_MANUAL', p.bono, p.bono * 5 from _ap_pend p where p.bono <> 0;

  insert into public.recompensas_apertura_aportes (cliente_id, origen, puntos_antiguos, monedas)
  select p.cliente_id, 'REDONDEO', p.redondeo, p.redondeo * 5 from _ap_pend p where p.redondeo <> 0;

  -- Vinculadas: apertura en ambos libros.
  perform public._recompensas_apertura_escribir(
    p.cliente_id, p_corte, p.puntos, p.sellos,
    jsonb_build_object('corte', p_corte, 'puntos_antiguos', p.puntos, 'visitas', p.visitas, 'gastado', p.gastado,
                       'bono', p.bono, 'redondeo', p.redondeo, 'reclamadas', p.reclamadas, 'sellos', p.sellos))
  from _ap_pend p where p.vinculada;

  -- Sin cuenta web: saldo congelado al corte (decisión A).
  insert into public.recompensas_apertura_espera
    (cliente_id, corte, puntos_antiguos, monedas, clasificacion, sellos, detalle)
  select p.cliente_id, p_corte, p.puntos, p.puntos * 5, p.puntos * 5, p.sellos,
         jsonb_build_object('corte', p_corte, 'puntos_antiguos', p.puntos, 'visitas', p.visitas, 'gastado', p.gastado,
                            'bono', p.bono, 'redondeo', p.redondeo, 'reclamadas', p.reclamadas, 'sellos', p.sellos)
  from _ap_pend p where not p.vinculada;

  -- apertura_ejecutada_en (migración 20261008000002) desbloquea recompensas_establecer_activo(true): solo esta función la fija.
  update public.recompensas_config set corte = p_corte, apertura_ejecutada_en = coalesce(apertura_ejecutada_en, now()), actualizado_en = now() where id = 1;

  if p_activar then
    perform public.recompensas_establecer_activo(true); -- misma transacción: sin hueco entre apertura y activación
  end if;

  -- Reconciliación sobre lo ESCRITO (no sobre lo calculado).
  r := r || jsonb_build_object(
    'ejecutado', true, 'activado', p_activar,
    'conciliacion', jsonb_build_object(
      'monedas_escritas_vinculadas', (select coalesce(sum(m.monedas), 0) from public.recompensas_movimientos m
                                        join _ap_pend p on p.cliente_id = m.cliente_id and p.vinculada
                                       where m.clave = 'apertura:' || m.cliente_id),
      'aportes_puntos_escritos', (select coalesce(sum(a.puntos_antiguos), 0) from public.recompensas_apertura_aportes a
                                    join _ap_pend p on p.cliente_id = a.cliente_id),
      'puntos_esperados', (select coalesce(sum(puntos), 0) from _ap_pend),
      'filas_espera', (select count(*) from public.recompensas_apertura_espera e join _ap_pend p on p.cliente_id = e.cliente_id)));
  return r;
end;
$$;
revoke execute on function public.recompensas_ejecutar_apertura(timestamptz, boolean, boolean) from public, anon;
grant execute on function public.recompensas_ejecutar_apertura(timestamptz, boolean, boolean) to authenticated;

-- Decisión A: habilitación única al vincular la cuenta a la misma ficha.
create or replace function public.recompensas_habilitar_apertura(p_cliente_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  e public.recompensas_apertura_espera;
  v_vinc boolean;
begin
  select * into e from public.recompensas_apertura_espera where cliente_id = p_cliente_id for update;
  if not found or e.estado <> 'EN_ESPERA' then return false; end if;
  select (cliente_web_id is not null) into v_vinc from public.clientes where id = p_cliente_id;
  if not coalesce(v_vinc, false) then return false; end if;
  perform public._recompensas_apertura_escribir(p_cliente_id, e.corte, e.puntos_antiguos, e.sellos,
                                                e.detalle || jsonb_build_object('habilitada_en', now()));
  update public.recompensas_apertura_espera set estado = 'HABILITADA', habilitada_en = now() where cliente_id = p_cliente_id;
  return true;
end;
$$;
revoke execute on function public.recompensas_habilitar_apertura(uuid) from public, anon, authenticated;

create or replace function public._recompensas_trg_habilitar_apertura()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompensas_habilitar_apertura(new.id);
  return new;
end;
$$;
revoke execute on function public._recompensas_trg_habilitar_apertura() from public, anon, authenticated;

create trigger trg_recompensas_habilitar_apertura
  after update of cliente_web_id on public.clientes
  for each row
  when (new.cliente_web_id is not null and old.cliente_web_id is distinct from new.cliente_web_id)
  execute function public._recompensas_trg_habilitar_apertura();

-- Seguridad de la recuperación: ¿es seguro borrar la apertura de esta clienta?
create or replace function public.recompensas_apertura_reversible()
returns table (cliente_id uuid, reversible boolean, motivo text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede consultar la reversibilidad de la apertura.';
  end if;
  return query
  with abiertas as (
    select m.cliente_id as cid from public.recompensas_movimientos m where m.tipo = 'APERTURA'
    union select e.cliente_id from public.recompensas_apertura_espera e
  )
  select a.cid,
         (x.mov = 0 and x.sel = 0 and x.canj = 0 and x.det = 0),
         case when x.mov + x.sel + x.canj + x.det = 0 then 'sin actividad posterior'
              else 'actividad posterior: ' || x.mov || ' movimientos, ' || x.sel || ' de sellos, '
                   || x.canj || ' canjes, ' || x.det || ' ventas con recompensas' end
  from abiertas a
  cross join lateral (
    select (select count(*) from public.recompensas_movimientos m where m.cliente_id = a.cid and m.tipo <> 'APERTURA')::int as mov,
           (select count(*) from public.recompensas_sellos_movs s where s.cliente_id = a.cid and s.tipo <> 'APERTURA')::int as sel,
           (select count(*) from public.recompensas_canjes c where c.cliente_id = a.cid)::int as canj,
           (select count(*) from public.recompensas_venta_detalle d join public.ventas v on v.id = d.venta_id
             where v.cliente_id = a.cid)::int as det
  ) x;
end;
$$;
revoke execute on function public.recompensas_apertura_reversible() from public, anon;
grant execute on function public.recompensas_apertura_reversible() to authenticated;

-- Borrado dirigido: SOLO si no hay actividad posterior. Si la hay, rechaza: se recupera restaurando la copia previa.
create or replace function public.recompensas_revertir_apertura(p_cliente_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
  v_rc public.recompensas_config;
  v_mov int; v_sel int; v_apo int; v_esp int;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede revertir una apertura.';
  end if;
  -- Con FOR SHARE la activación (UPDATE de la configuración) espera a que esta transacción termine.
  select * into v_rc from public.recompensas_config where id = 1 for share;
  if v_rc.activo then
    raise exception 'Recompensas está activo: la apertura solo se revierte antes de activarlo; restaure la copia previa.';
  end if;
  -- Bloquea la fila de la clienta: ninguna escritura que la referencie se intercala entre la comprobación y el borrado.
  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'La clienta no existe.';
  end if;
  select rv.reversible into v_ok from public.recompensas_apertura_reversible() rv where rv.cliente_id = p_cliente_id;
  if v_ok is null then
    raise exception 'La clienta no tiene apertura.';
  end if;
  if not v_ok then
    raise exception 'La apertura de esta clienta ya tiene ventas, canjes o movimientos posteriores: no se borra; restaure la copia previa.';
  end if;
  delete from public.recompensas_movimientos where cliente_id = p_cliente_id and tipo = 'APERTURA';
  get diagnostics v_mov = row_count;
  delete from public.recompensas_sellos_movs where cliente_id = p_cliente_id and tipo = 'APERTURA';
  get diagnostics v_sel = row_count;
  delete from public.recompensas_apertura_aportes where cliente_id = p_cliente_id;
  get diagnostics v_apo = row_count;
  delete from public.recompensas_apertura_espera where cliente_id = p_cliente_id;
  get diagnostics v_esp = row_count;
  return jsonb_build_object('movimientos', v_mov, 'sellos', v_sel, 'aportes', v_apo, 'espera', v_esp);
end;
$$;
revoke execute on function public.recompensas_revertir_apertura(uuid) from public, anon;
grant execute on function public.recompensas_revertir_apertura(uuid) to authenticated;

commit;
