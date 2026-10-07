-- =========================================================
-- QA-075 (complemento): el doble clic SIMULTÁNEO al reclamar un cupón de promoción devuelve el mismo cupón
--
-- Qué pasaba (reproducido con 6 llamadas concurrentes de la misma clienta): reclamar_cupon_promocion() comprueba si ya
-- existe el cupón y, si no, lo inserta. Con dos llamadas a la vez ambas ven «no existe» y ambas insertan; la segunda choca con el
-- índice único (cliente_id, promocion_id) y la clienta recibe «duplicate key value violates unique constraint» en vez de su cupón.
-- No se duplicaba nada (el índice lo impide), pero la respuesta no era idempotente.
--
-- Cambio: la inserción usa ON CONFLICT DO NOTHING sobre ese mismo índice parcial. Quien pierde la carrera espera al commit del
-- ganador, no inserta, y devuelve el cupón ya emitido (con su vencimiento original). La notificación «¡Reclamaste un cupón!» solo
-- la crea quien realmente emitió el cupón (una sola por reclamo). Todo lo demás queda igual que en 20261007000001.
--
-- Reversión: volver a la definición de 20261007000001_cupones_promocion_vencimiento.sql.
-- =========================================================

begin;

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
  v_vence        timestamptz;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de reclamar un cupón.';
  end if;

  select * into v_promocion
  from public.promociones
  where public.promociones.id = p_promocion_id
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
    -- Vence al terminar el último día de la campaña (hora de Lima): el inicio del día siguiente, exclusivo.
    v_vence := case
      when v_promocion.vigente_hasta is null then null
      else ((v_promocion.vigente_hasta + 1)::timestamp at time zone 'America/Lima')
    end;

    insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento, promocion_id, vigente_hasta)
    values (
      v_cliente_id, public.generar_codigo_cupon(), 'PROMOCION',
      v_promocion.valor, v_promocion.tipo_descuento, p_promocion_id, v_vence
    )
    on conflict (cliente_id, promocion_id) where promocion_id is not null do nothing
    returning * into v_cupon;

    if v_cupon.id is not null then
      insert into public.notificaciones (cliente_id, tipo, titulo, mensaje, ruta)
      values (
        v_cliente_id,
        'PROMOCION',
        '¡Reclamaste un cupón!',
        'Tu cupón de "' || v_promocion.titulo || '" ya está en Mis cupones.',
        '/ofertas'
      );
    else
      -- Otra llamada simultánea de la misma clienta emitió el cupón primero: se devuelve ese.
      select * into v_cupon
      from public.cupones
      where cliente_id = v_cliente_id and promocion_id = p_promocion_id;
    end if;
  end if;

  return query select v_cupon.id, v_cupon.codigo, v_cupon.valor, v_cupon.tipo_descuento, v_cupon.estado;
end;
$$;

revoke execute on function public.reclamar_cupon_promocion(uuid) from public;
grant execute on function public.reclamar_cupon_promocion(uuid) to authenticated;

commit;
