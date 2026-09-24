-- =========================================================
-- POS Negocio 2 — Pestaña Web: Notificaciones (bandeja in-app)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- Decisión confirmada con el usuario: empezar por una bandeja DENTRO de
-- la app (no push de verdad al celular, eso necesita infraestructura que
-- hoy no existe — service worker con suscripción, VAPID, un backend que
-- dispare cada evento). Esta bandeja se alimenta de eventos REALES que
-- ya pasan en el sistema (nunca de datos inventados): un pedido cambia
-- de estado, una reseña se modera, el negocio cancela una cita — todos
-- disparados por triggers, nunca por el cliente insertando su propia
-- notificación.
--
-- Alcance de esta primera fase (deliberadamente acotado): solo eventos
-- que ya son un cambio de columna claro y siempre iniciado por el
-- personal (nunca ambiguo si fue el cliente o el negocio). Quedan FUERA
-- a propósito, para una fase futura: recordatorio de cita próxima (needs
-- un cron/scheduled job, no un trigger) y "subiste de nivel de puntos"
-- (el nivel es calculado al vuelo en mis_puntos(), no una columna que
-- cambie sola — detectarlo bien requeriría comparar antes/después en
-- cada posible causa: nueva visita, nuevo gasto, bono manual, o el admin
-- cambiando los umbrales para TODOS los clientes a la vez).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------
create table public.notificaciones (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  tipo       text not null,
  titulo     text not null,
  mensaje    text,
  ruta       text,
  leida      boolean not null default false,
  creado_en  timestamptz not null default now()
);

create index notificaciones_cliente_id_idx
  on public.notificaciones (cliente_id, creado_en desc);

alter table public.notificaciones enable row level security;

-- Sin insert/delete para el cliente a propósito: la única puerta de
-- entrada son los triggers de abajo (security definer, se saltan RLS).
grant select, update on public.notificaciones to authenticated;

create policy notificaciones_select on public.notificaciones
  for select to authenticated
  using (cliente_id = public.mi_cliente_id());

create policy notificaciones_update on public.notificaciones
  for update to authenticated
  using (cliente_id = public.mi_cliente_id())
  with check (cliente_id = public.mi_cliente_id());

-- ---------------------------------------------------------
-- 2. Pedido de productos cambia de estado (PedidosWeb.jsx, admin-only)
-- ---------------------------------------------------------
create or replace function public.notificar_cambio_pedido_web()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_titulo  text;
  v_mensaje text;
begin
  if new.estado = old.estado then
    return new;
  end if;

  v_titulo := case new.estado
    when 'LISTO' then 'Tu pedido está listo'
    when 'ENTREGADO' then 'Pedido entregado'
    when 'CANCELADO' then 'Pedido cancelado'
    else null
  end;

  if v_titulo is null then
    return new;
  end if;

  v_mensaje := case new.estado
    when 'LISTO' then 'Tu pedido ya está listo para recoger o coordinar la entrega.'
    when 'ENTREGADO' then 'Tu pedido fue marcado como entregado. ¡Gracias por tu compra!'
    else 'Tu pedido fue cancelado. Si tienes dudas, contáctanos.'
  end;

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje)
  values (new.cliente_id, 'PEDIDO', v_titulo, v_mensaje);

  return new;
end;
$$;

create trigger trg_notificar_cambio_pedido_web
  after update of estado on public.pedidos_web
  for each row
  execute function public.notificar_cambio_pedido_web();

-- ---------------------------------------------------------
-- 3. Reseña moderada (ResenasWeb.jsx, admin-only)
-- ---------------------------------------------------------
create or replace function public.notificar_cambio_resena()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'APROBADA' then
    insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
    values (
      new.cliente_id, 'RESENA', 'Tu reseña fue publicada',
      'Ya se ve en Nosotros > Reseñas. ¡Gracias por compartir tu experiencia!',
      '/mis-resenas'
    );
  elsif new.estado = 'RECHAZADA' then
    insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
    values (
      new.cliente_id, 'RESENA', 'Tu reseña no fue publicada',
      'Puedes editarla y volver a enviarla desde Tus reseñas.',
      '/mis-resenas'
    );
  end if;

  return new;
end;
$$;

create trigger trg_notificar_cambio_resena
  after update of estado on public.resenas
  for each row
  execute function public.notificar_cambio_resena();

-- ---------------------------------------------------------
-- 4. Cita cancelada POR EL NEGOCIO (no por la propia clienta)
-- rol_actual() no es null solo cuando quien ejecuta la actualización
-- tiene una fila en "usuarios" (personal) — cancelar_mi_cita_web() la
-- ejecuta la propia clienta (sin fila en usuarios), así que esa vía
-- nunca dispara esta notificación.
-- ---------------------------------------------------------
create or replace function public.notificar_cita_cancelada_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = old.estado or new.estado <> 'CANCELADA' then
    return new;
  end if;

  if public.rol_actual() is null then
    return new;
  end if;

  if new.cliente_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.clientes c
    where c.id = new.cliente_id and c.cliente_web_id is not null
  ) then
    return new;
  end if;

  insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
  values (
    new.cliente_id,
    'CITA',
    'Tu cita fue cancelada',
    'El salón canceló tu cita del ' ||
      to_char(new.fecha_hora at time zone 'America/Lima', 'DD/MM/YYYY hh12:mi AM') ||
      '. Contáctanos para reagendar.',
    '/citas'
  );

  return new;
end;
$$;

create trigger trg_notificar_cita_cancelada_staff
  after update of estado on public.citas
  for each row
  execute function public.notificar_cita_cancelada_staff();

commit;
