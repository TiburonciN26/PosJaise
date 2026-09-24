-- =========================================================
-- POS Negocio 2 — Pestaña Web: Reseñas (testimonios públicos)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 85_carrito_pedidos_web.sql ya se haya corrido.
--
-- Decisiones confirmadas con el usuario:
-- - Una sola reseña por clienta, editable (no un historial de varias):
--   "cliente_id" queda UNIQUE y guardar_mi_resena() hace upsert.
-- - Moderación: el admin aprueba antes de que se vea pública — al
--   guardar (o editar) queda en PENDIENTE, nunca se publica sola.
--   Editar una reseña ya aprobada la vuelve a mandar a PENDIENTE (el
--   contenido cambió, hay que revisarlo de nuevo).
-- =========================================================

begin;

create table public.resenas (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null unique references public.clientes (id) on delete cascade,
  calificacion   integer not null check (calificacion between 1 and 5),
  comentario     text,
  estado         text not null default 'PENDIENTE'
                    check (estado in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.resenas enable row level security;

grant select, update on public.resenas to authenticated;

-- La propia clienta ve su reseña en cualquier estado (para saber si
-- sigue pendiente); cualquier autenticado ve las ya aprobadas (el muro
-- público de Nosotros > Reseñas); el admin ve todo (moderación).
create policy resenas_select on public.resenas
  for select to authenticated
  using (
    cliente_id = public.mi_cliente_id()
    or estado = 'APROBADA'
    or public.es_admin()
  );

create policy resenas_update_admin on public.resenas
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---------------------------------------------------------
-- guardar_mi_resena(): único punto de escritura para la clienta —
-- upsert por cliente_id, siempre vuelve a PENDIENTE. Mismo criterio que
-- el resto de RPC de escritura del cliente: revalida en el servidor
-- (calificación 1-5), nunca confía en lo que ya validó el navegador.
-- ---------------------------------------------------------
create or replace function public.guardar_mi_resena(
  p_calificacion integer,
  p_comentario   text
)
returns table (
  id             uuid,
  calificacion   integer,
  comentario     text,
  estado         text,
  actualizado_en timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de dejar una reseña.';
  end if;

  if p_calificacion is null or p_calificacion < 1 or p_calificacion > 5 then
    raise exception 'La calificación debe ser de 1 a 5 estrellas.';
  end if;

  return query
  insert into public.resenas as r (cliente_id, calificacion, comentario, estado)
  values (
    v_cliente_id, p_calificacion,
    nullif(btrim(coalesce(p_comentario, '')), ''),
    'PENDIENTE'
  )
  on conflict (cliente_id) do update
    set calificacion   = excluded.calificacion,
        comentario     = excluded.comentario,
        estado         = 'PENDIENTE',
        actualizado_en = now()
  returning r.id, r.calificacion, r.comentario, r.estado, r.actualizado_en;
end;
$$;

grant execute on function public.guardar_mi_resena(integer, text) to authenticated;
revoke execute on function public.guardar_mi_resena(integer, text) from public;

-- ---------------------------------------------------------
-- mi_resena(): la propia reseña de la clienta (o vacío si no dejó
-- ninguna todavía) — para la pantalla "Tus reseñas" del avatar.
-- ---------------------------------------------------------
create or replace function public.mi_resena()
returns table (
  id             uuid,
  calificacion   integer,
  comentario     text,
  estado         text,
  actualizado_en timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.calificacion, r.comentario, r.estado, r.actualizado_en
  from public.resenas r
  where r.cliente_id = public.mi_cliente_id();
$$;

grant execute on function public.mi_resena() to authenticated;
revoke execute on function public.mi_resena() from public;

-- ---------------------------------------------------------
-- resenas_publicas(): el muro de testimonios de Nosotros > Reseñas —
-- solo las aprobadas, con el nombre de la clienta (el frontend decide
-- si lo trunca a "Nombre I." para mostrar, acá se expone completo por
-- si en algún momento hace falta el dato completo en otro contexto).
-- ---------------------------------------------------------
create or replace function public.resenas_publicas()
returns table (
  id           uuid,
  nombre       text,
  calificacion integer,
  comentario   text,
  creado_en    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, c.nombre, r.calificacion, r.comentario, r.creado_en
  from public.resenas r
  join public.clientes c on c.id = r.cliente_id
  where r.estado = 'APROBADA'
  order by r.creado_en desc;
$$;

grant execute on function public.resenas_publicas() to authenticated;
revoke execute on function public.resenas_publicas() from public;

commit;
