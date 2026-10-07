-- =========================================================
-- QA-075: la vigencia de una promoción por fechas limita también el USO del cupón
--
-- Regla confirmada por el propietario: las fechas de campaña limitan tanto el reclamo como el uso.
--
-- Qué pasaba: reclamar_cupon_promocion() ya rechazaba reclamar fuera de las fechas, pero el cupón emitido
-- nacía con vigente_hasta = null (nunca vence). Una campaña vencida dejaba cupones DISPONIBLES que la vista
-- previa, la Caja, el pedido y la verificación de pago aceptaban sin límite.
--
-- Cambio (solo la EMISIÓN; la validación ya era autoritativa y compartida):
--   * Todas las rutas de uso (recompensas_validar_cupon_pedido → vista previa, confirmar_pedido_productos,
--     verificar_pago_pedido_web; y confirmar_venta/Caja) ya exigen `vigente_hasta is null or vigente_hasta > now()`
--     y responden «Este cupón ya venció» ANTES de anunciar un importe pagable. No se tocan.
--   * reclamar_cupon_promocion() ahora congela en el cupón el vencimiento de la campaña:
--       vigente_hasta = inicio del día SIGUIENTE a promociones.vigente_hasta, en America/Lima.
--     Como la comparación es estricta (`> now()`), el cupón sirve durante TODO el último día de la campaña
--     (hasta las 23:59:59.999 de Lima) y deja de servir a las 00:00 del día siguiente; no vence al empezar
--     el último día. Una promoción sin fecha final (vigente_hasta null) emite un cupón que no vence, como antes.
--   * Se conserva todo lo demás: idempotencia (un cupón por clienta y promoción; el segundo intento devuelve el
--     mismo, con su vencimiento original), la notificación, el rechazo de reclamar fuera de fechas, y las
--     protecciones económicas, de stock y de anulación (anular_venta ya no reactiva un cupón vencido:
--     `vigente_hasta is null or vigente_hasta > now()`; sin cambios).
--
-- No cubierto a propósito: NO se actualizan cupones ya emitidos ni producción. El tratamiento propuesto para los
-- cupones PROMOCION antiguos sin vencimiento está documentado aparte (docs/recompensas-fase2/COHERENCIA-NIVELES-Y-VIGENCIA.md)
-- y requiere una decisión y una autorización explícitas.
--
-- Reversión: volver a la definición de 20261002000003_pedidos_cupones_ambiguedades_pago.sql (sin vigente_hasta en el insert).
-- Los cupones emitidos con esta versión conservan su vencimiento.
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

revoke execute on function public.reclamar_cupon_promocion(uuid) from public;
grant execute on function public.reclamar_cupon_promocion(uuid) to authenticated;

commit;
