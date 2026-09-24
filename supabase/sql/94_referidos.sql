-- =========================================================
-- POS Negocio 2 — Pestaña Web: Referidos (§2.8 del roadmap original)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Reglas confirmadas con el usuario (AskUserQuestion), basadas en datos
-- reales del propio negocio (revisados en vivo antes de proponerlas):
-- ticket promedio de servicio ~S/55 (47 registros, últimas 4 semanas),
-- ticket promedio de producto ~S/39 (97 ventas, ~2 meses):
-- - Moneda de recompensa: DESCUENTO EN SOLES (no puntos, no producto
--   gratis) — un crédito que el cliente menciona en su próxima visita
--   para que el cajero lo aplique, mismo patrón NO automatizado que ya
--   usa la recompensa de Fidelización (78_fidelizacion_web.sql: "Ver
--   recompensas disponibles" solo, sin canje automático en Ventas.jsx).
-- - Se libera SOLO cuando el referido completa su primera visita o
--   compra real (nunca al solo registrarse) — evita cuentas falsas
--   creadas solo para ganar el crédito.
-- - Recompensa para AMBOS lados: quien invita Y quien se registra.
-- - Montos (editables después desde "Referidos Web" en el POS, mismo
--   criterio que config_puntos — todavía no son definitivos): S/15
--   para quien invita, S/10 para quien se registra.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Configuración (fila única, id fijo = 1)
-- ---------------------------------------------------------
create table public.config_referidos (
  id                int primary key default 1,
  credito_referidor numeric(10, 2) not null default 15,
  credito_referido  numeric(10, 2) not null default 10,
  actualizado_en    timestamptz not null default now(),
  constraint config_referidos_singleton check (id = 1)
);

insert into public.config_referidos (id) values (1);

alter table public.config_referidos enable row level security;
grant select on public.config_referidos to authenticated;
grant update on public.config_referidos to authenticated;

create policy config_referidos_select on public.config_referidos
  for select to authenticated
  using (true);

create policy config_referidos_update_admin on public.config_referidos
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---------------------------------------------------------
-- 2. Columnas nuevas en clientes — sin grant directo a authenticated:
-- el cliente nunca lee/escribe esta tabla en crudo (staff-only, como
-- siempre), todo pasa por las RPC de abajo.
-- ---------------------------------------------------------
alter table public.clientes
  add column codigo_referido               text unique,
  add column referido_por                  uuid references public.clientes (id),
  add column recompensa_referido_aplicada  boolean not null default false,
  add column credito_referido              numeric(10, 2) not null default 0;

-- ---------------------------------------------------------
-- 3. Código de referido propio (se genera solo, una vez, al pedirlo)
-- ---------------------------------------------------------
create or replace function public.generar_codigo_referido()
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
    exit when not exists (select 1 from public.clientes where codigo_referido = v_codigo);
    v_intentos := v_intentos + 1;
    if v_intentos > 20 then
      raise exception 'No se pudo generar un código de referido único.';
    end if;
  end loop;
  return v_codigo;
end;
$$;

create or replace function public.mi_codigo_referido()
returns text
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
    raise exception 'Completa tu perfil antes de generar tu código de referido.';
  end if;

  select codigo_referido into v_codigo from public.clientes where id = v_cliente_id;

  if v_codigo is null then
    v_codigo := public.generar_codigo_referido();
    update public.clientes set codigo_referido = v_codigo where id = v_cliente_id;
  end if;

  return v_codigo;
end;
$$;

grant execute on function public.mi_codigo_referido() to authenticated;
revoke execute on function public.mi_codigo_referido() from public;

-- ---------------------------------------------------------
-- 4. Ingresar el código de alguien más (solo antes de la primera visita)
-- ---------------------------------------------------------
create or replace function public.aplicar_codigo_referido(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id   uuid;
  v_referente_id uuid;
  v_ya_visito    boolean;
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
end;
$$;

grant execute on function public.aplicar_codigo_referido(text) to authenticated;
revoke execute on function public.aplicar_codigo_referido(text) from public;

-- ---------------------------------------------------------
-- 5. Estado propio (código, crédito, si ya usó uno, cuántos refirió)
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
      c.credito_referido,
      c.referido_por is not null,
      (select count(*)::int from public.clientes r where r.referido_por = c.id),
      cfg.credito_referidor,
      cfg.credito_referido
    from public.clientes c, public.config_referidos cfg
    where c.id = v_cliente_id and cfg.id = 1;
end;
$$;

grant execute on function public.mi_estado_referidos() to authenticated;
revoke execute on function public.mi_estado_referidos() from public;

-- ---------------------------------------------------------
-- 6. Recompensa automática al completar la primera visita/compra —
-- dispara en registro_servicios (visita/servicio) y en pedidos_web
-- (compra de productos entregada), lo que ocurra primero.
-- recompensa_referido_aplicada evita que se otorgue dos veces.
-- ---------------------------------------------------------
create or replace function public.recompensar_referido_si_corresponde(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referente_id      uuid;
  v_credito_referidor numeric;
  v_credito_referido  numeric;
begin
  select referido_por into v_referente_id
  from public.clientes
  where id = p_cliente_id and recompensa_referido_aplicada = false and referido_por is not null;

  if v_referente_id is null then
    return;
  end if;

  select credito_referidor, credito_referido into v_credito_referidor, v_credito_referido
  from public.config_referidos where id = 1;

  update public.clientes
  set credito_referido = credito_referido + v_credito_referidor
  where id = v_referente_id;

  update public.clientes
  set credito_referido = credito_referido + v_credito_referido,
      recompensa_referido_aplicada = true
  where id = p_cliente_id;

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    v_referente_id,
    'REFERIDO',
    '¡Ganaste un crédito por referir!',
    'Un cliente que invitaste completó su primera visita o compra. Ganaste S/' ||
      v_credito_referidor || ' de crédito — menciónalo en tu próxima visita.',
    '/mi-perfil/referidos'
  );

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    p_cliente_id,
    'REFERIDO',
    '¡Ganaste un crédito de bienvenida!',
    'Por haber usado un código de referido, ganaste S/' ||
      v_credito_referido || ' de crédito — menciónalo en tu próxima visita.',
    '/mi-perfil/referidos'
  );
end;
$$;

create or replace function public.trg_recompensar_referido_registro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'ACTIVO' and new.cliente_id is not null then
    perform public.recompensar_referido_si_corresponde(new.cliente_id);
  end if;
  return new;
end;
$$;

create trigger trg_referido_registro_servicios
  after insert on public.registro_servicios
  for each row
  execute function public.trg_recompensar_referido_registro();

create or replace function public.trg_recompensar_referido_pedido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'ENTREGADO' and old.estado is distinct from new.estado then
    perform public.recompensar_referido_si_corresponde(new.cliente_id);
  end if;
  return new;
end;
$$;

create trigger trg_referido_pedido_web
  after update of estado on public.pedidos_web
  for each row
  execute function public.trg_recompensar_referido_pedido();

commit;
