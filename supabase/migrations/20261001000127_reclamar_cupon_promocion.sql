-- =========================================================
-- POS Negocio 2 — Inicio (portal cliente): reclamar cupón de una
-- promoción activa
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 97_cupones_fidelizacion.sql (tipo_descuento en cupones) y
-- 79_promociones.sql (tabla promociones) ya se hayan corrido.
--
-- docs/diseno-inicio/README.md, sección "Promoción activa": la clienta
-- toca "Reclamar cupón" en el bloque de promoción del Inicio y el cupón
-- queda guardado en Mis cupones — mismo mecanismo de cupones de un solo
-- uso que ya usan Referidos y Fidelización (97_cupones_fidelizacion.sql),
-- un origen más ('PROMOCION') en vez de un sistema aparte.
--
-- Idempotente a propósito: tocar "Reclamar cupón" dos veces (doble tap,
-- o volver a entrar al Inicio ya habiéndolo reclamado antes) nunca crea
-- un segundo cupón — el índice único (cliente_id, promocion_id) y el
-- "ya existe, devuélvelo" de la función lo garantizan.
-- =========================================================

begin;

alter table public.cupones
  add column promocion_id uuid references public.promociones (id);

-- Un cupón por clienta por promoción (parcial: solo aplica a los cupones
-- que sí vienen de una promoción — los de Referidos/Fidelización siguen
-- sin este límite, no tienen promocion_id).
create unique index cupones_cliente_promocion_unq
  on public.cupones (cliente_id, promocion_id)
  where promocion_id is not null;

alter table public.cupones drop constraint if exists cupones_origen_check;
alter table public.cupones
  add constraint cupones_origen_check
  check (origen in ('REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION', 'PROMOCION'));

-- mis_cupones() no devolvía promocion_id — sin esto, el Inicio no puede
-- saber si la clienta ya reclamó el cupón de la promoción activa (drop
-- necesario: create or replace no permite cambiar el tipo de retorno de
-- una función, mismo caso ya documentado en 97_cupones_fidelizacion.sql).
drop function if exists public.mis_cupones();

create or replace function public.mis_cupones()
returns table (
  id             uuid,
  codigo         text,
  origen         text,
  valor          numeric,
  tipo_descuento text,
  promocion_id   uuid,
  estado         text,
  creado_en      timestamptz,
  canjeado_en    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, codigo, origen, valor, tipo_descuento, promocion_id, estado, creado_en, canjeado_en
  from public.cupones
  where cliente_id = public.mi_cliente_id()
  order by (estado = 'DISPONIBLE') desc, creado_en desc;
$$;

grant execute on function public.mis_cupones() to authenticated;
revoke execute on function public.mis_cupones() from public;

-- reclamar_cupon_promocion(): valida en el SERVIDOR que la promoción
-- sigue activa y vigente (misma condición que la policy
-- promociones_select_web, no lo que el navegador crea que vio) y que
-- todavía no existe un cupón de esa clienta para esa promoción — si ya
-- existe, lo devuelve tal cual (idempotente) en vez de fallar o
-- duplicar.
create or replace function public.reclamar_cupon_promocion(p_promocion_id uuid)
returns table (
  id             uuid,
  codigo         text,
  valor          numeric,
  tipo_descuento text,
  estado         text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id   uuid;
  v_promocion    public.promociones;
  v_cupon        public.cupones;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de reclamar un cupón.';
  end if;

  select * into v_promocion
  from public.promociones
  where id = p_promocion_id
    and activo = true
    and (vigente_desde is null or vigente_desde <= (now() at time zone 'America/Lima')::date)
    and (vigente_hasta is null or vigente_hasta >= (now() at time zone 'America/Lima')::date);

  if v_promocion.id is null then
    raise exception 'Esta promoción ya no está activa.';
  end if;

  select * into v_cupon
  from public.cupones
  where cliente_id = v_cliente_id and promocion_id = p_promocion_id;

  if v_cupon.id is null then
    insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento, promocion_id)
    values (
      v_cliente_id, public.generar_codigo_cupon(), 'PROMOCION',
      v_promocion.valor, v_promocion.tipo_descuento, p_promocion_id
    )
    returning * into v_cupon;

    insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
    values (
      v_cliente_id,
      'PROMOCION',
      '¡Reclamaste un cupón!',
      'Tu cupón de "' || v_promocion.titulo || '" ya está en Mis cupones.',
      '/ofertas'
    );
  end if;

  return query select v_cupon.id, v_cupon.codigo, v_cupon.valor, v_cupon.tipo_descuento, v_cupon.estado;
end;
$$;

grant execute on function public.reclamar_cupon_promocion(uuid) to authenticated;
revoke execute on function public.reclamar_cupon_promocion(uuid) from public;

commit;
