-- Horario de atención configurable por la administradora, POR DÍA y con hasta dos turnos.
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): la administradora es quien abre y cierra el negocio y debe poder fijar el
-- horario de atención y los días desde el POS, incluso con doble turno solo en algunos días (p. ej. lunes a sábado
-- 10:00-13:00 y 15:00-20:30, domingo 10:00-14:00). Hasta hoy el horario vivía en estado_negocio
-- (20261001000074_horario_atencion.sql) como UN solo par de bloques para todos los días que atiende, cargado a mano por
-- SQL: no había pantalla para editarlo y no permitía horarios distintos según el día.
--
-- QUÉ SE HACE:
--   * horario_semanal: una fila por día ISO (1 = lunes … 7 = domingo) con turno 1 y turno 2 opcional. Día cerrado =
--     todas las horas en null. Se siembra con el horario que había en estado_negocio, así nada cambia al aplicar.
--     Sin acceso directo para anon/authenticated (RLS sin políticas + revoke): se lee con horario_atencion_semanal() y
--     se escribe solo con guardar_horario_atencion() (valida y deja auditoría legible).
--   * horario_atencion_semanal(): lectura pública (visitantes y clientas la necesitan para Inicio, pie, Citas…).
--   * guardar_horario_atencion(p_dias jsonb): solo ADMINISTRADOR. Recibe los 7 días, valida con mensajes por día y
--     registra en auditoria un cambio por día modificado («Lunes — horario: 10:00-13:00 → Cerrado»).
--   * horarios_disponibles_cita() (citas web, la usan agendar_cita_web y reprogramar_mi_cita_web) y
--     confirmar_pedido_productos() (pedidos web) pasan a validar contra los turnos del día elegido. Cuerpos tomados de la
--     base local viva (idénticos a 20261001000075 / 20261009000005): SOLO cambia la lectura del horario.
--   * horario_atencion(): se conserva con la misma firma como COMPATIBILIDAD para versiones viejas de la web que el
--     navegador tenga en caché (PWA). Devuelve los días abiertos y los turnos del primer día abierto. Ya nada del repo
--     la usa; se puede borrar en una migración posterior.
--   * Se eliminan dias_atencion / bloque*_ de estado_negocio: una sola fuente de verdad (si quedara algo leyéndolas,
--     fallaría a la vista en vez de usar un horario viejo en silencio). En local solo las leían las 3 funciones de arriba.
--
-- ANTES DE APLICAR EN PRODUCCIÓN: confirmar que en producción las únicas funciones que leen esas columnas son las mismas
-- tres (select proname from pg_proc where prosrc ilike '%bloque1_inicio%' or prosrc ilike '%dias_atencion%') y que
-- confirmar_pedido_productos coincide con 20261009000005.

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------------------------------------------------------------
create table public.horario_semanal (
  dia            smallint primary key check (dia between 1 and 7),
  bloque1_inicio time,
  bloque1_fin    time,
  bloque2_inicio time,
  bloque2_fin    time,
  actualizado_en timestamptz not null default now(),
  constraint horario_semanal_turnos_validos check (
    (bloque1_inicio is null and bloque1_fin is null and bloque2_inicio is null and bloque2_fin is null)
    or (
      bloque1_inicio is not null and bloque1_fin is not null and bloque1_inicio < bloque1_fin
      and (
        (bloque2_inicio is null and bloque2_fin is null)
        or (bloque2_inicio is not null and bloque2_fin is not null
            and bloque1_fin < bloque2_inicio and bloque2_inicio < bloque2_fin)
      )
    )
  )
);

comment on table public.horario_semanal is
  'Horario de atención por día ISO (1=lunes … 7=domingo). Día cerrado = horas en null. Se edita con guardar_horario_atencion().';

alter table public.horario_semanal enable row level security;
revoke all on table public.horario_semanal from public, anon, authenticated;

-- Siembra: el horario que ya tenía el negocio (mismo turno para cada día de dias_atencion; el resto cerrado).
insert into public.horario_semanal (dia, bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin)
select
  d.dia,
  case when abre then e.bloque1_inicio end,
  case when abre then e.bloque1_fin end,
  case when abre and e.bloque2_inicio is not null and e.bloque2_fin is not null then e.bloque2_inicio end,
  case when abre and e.bloque2_inicio is not null and e.bloque2_fin is not null then e.bloque2_fin end
from generate_series(1, 7) as d(dia)
left join public.estado_negocio e on e.id = 1
cross join lateral (
  select coalesce(
    d.dia = any(e.dias_atencion) and e.bloque1_inicio is not null and e.bloque1_fin is not null
      and e.bloque1_inicio < e.bloque1_fin,
    false
  ) as abre
) x;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Lectura pública
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.horario_atencion_semanal()
returns table (
  dia            smallint,
  bloque1_inicio time,
  bloque1_fin    time,
  bloque2_inicio time,
  bloque2_fin    time
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.dia, h.bloque1_inicio, h.bloque1_fin, h.bloque2_inicio, h.bloque2_fin
  from public.horario_semanal h
  order by h.dia;
$$;

revoke execute on function public.horario_atencion_semanal() from public;
grant execute on function public.horario_atencion_semanal() to anon, authenticated;

-- Compatibilidad (ver cabecera): misma firma que 20261001000074.
create or replace function public.horario_atencion()
returns table (
  dias_atencion  int[],
  bloque1_inicio time,
  bloque1_fin    time,
  bloque2_inicio time,
  bloque2_fin    time
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(
      (select array_agg(a.dia::int order by a.dia) from public.horario_semanal a where a.bloque1_inicio is not null),
      '{}'::int[]
    ),
    p.bloque1_inicio, p.bloque1_fin, p.bloque2_inicio, p.bloque2_fin
  from (select 1) as uno
  left join lateral (
    select h.bloque1_inicio, h.bloque1_fin, h.bloque2_inicio, h.bloque2_fin
    from public.horario_semanal h
    where h.bloque1_inicio is not null
    order by h.dia
    limit 1
  ) p on true;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Guardado (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
-- p_dias: arreglo con los 7 días, p. ej.
--   [{"dia":1,"bloque1_inicio":"10:00","bloque1_fin":"13:00","bloque2_inicio":"15:00","bloque2_fin":"20:30"},
--    {"dia":7,"bloque1_inicio":null,…}, …]
create or replace function public.guardar_horario_atencion(p_dias jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombres  constant text[] := array['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  v_email    text;
  v_item     jsonb;
  v_dia      int;
  v_vistos   int[] := '{}';
  v_b1i      time;
  v_b1f      time;
  v_b2i      time;
  v_b2f      time;
  v_ant      public.horario_semanal%rowtype;
  v_txt_ant  text;
  v_txt_nue  text;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede cambiar el horario de atención.' using errcode = '42501';
  end if;

  if p_dias is null or jsonb_typeof(p_dias) <> 'array' or jsonb_array_length(p_dias) <> 7 then
    raise exception 'Envía el horario de los 7 días de la semana.' using errcode = 'P0001';
  end if;

  select email into v_email from public.usuarios where id = auth.uid();

  for v_item in select value from jsonb_array_elements(p_dias) loop
    begin
      v_dia := (v_item->>'dia')::int;
      v_b1i := nullif(v_item->>'bloque1_inicio', '')::time;
      v_b1f := nullif(v_item->>'bloque1_fin', '')::time;
      v_b2i := nullif(v_item->>'bloque2_inicio', '')::time;
      v_b2f := nullif(v_item->>'bloque2_fin', '')::time;
    exception when others then
      raise exception 'El horario enviado tiene una hora inválida.' using errcode = 'P0001';
    end;

    if v_dia is null or v_dia not between 1 and 7 or v_dia = any(v_vistos) then
      raise exception 'El horario enviado tiene un día inválido o repetido.' using errcode = 'P0001';
    end if;
    v_vistos := v_vistos || v_dia;

    -- Mensajes pensados para mostrarse tal cual en el modal (P0001).
    if v_b1i is null and v_b1f is null then
      if v_b2i is not null or v_b2f is not null then
        raise exception '%: falta el primer turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
    else
      if v_b1i is null or v_b1f is null then
        raise exception '%: completa el inicio y el fin del primer turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if v_b1i >= v_b1f then
        raise exception '%: el primer turno debe terminar después de empezar.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if (v_b2i is null) <> (v_b2f is null) then
        raise exception '%: completa el inicio y el fin del segundo turno.', v_nombres[v_dia] using errcode = 'P0001';
      end if;
      if v_b2i is not null then
        if v_b2i <= v_b1f then
          raise exception '%: el segundo turno debe empezar después de que termine el primero.', v_nombres[v_dia]
            using errcode = 'P0001';
        end if;
        if v_b2i >= v_b2f then
          raise exception '%: el segundo turno debe terminar después de empezar.', v_nombres[v_dia] using errcode = 'P0001';
        end if;
      end if;
    end if;

    select * into v_ant from public.horario_semanal where dia = v_dia for update;

    if not found
       or v_ant.bloque1_inicio is distinct from v_b1i or v_ant.bloque1_fin is distinct from v_b1f
       or v_ant.bloque2_inicio is distinct from v_b2i or v_ant.bloque2_fin is distinct from v_b2f then

      v_txt_ant := case
        when v_ant.bloque1_inicio is null then 'Cerrado'
        else to_char(v_ant.bloque1_inicio, 'HH24:MI') || '-' || to_char(v_ant.bloque1_fin, 'HH24:MI')
          || coalesce(' y ' || to_char(v_ant.bloque2_inicio, 'HH24:MI') || '-' || to_char(v_ant.bloque2_fin, 'HH24:MI'), '')
      end;
      v_txt_nue := case
        when v_b1i is null then 'Cerrado'
        else to_char(v_b1i, 'HH24:MI') || '-' || to_char(v_b1f, 'HH24:MI')
          || coalesce(' y ' || to_char(v_b2i, 'HH24:MI') || '-' || to_char(v_b2f, 'HH24:MI'), '')
      end;

      insert into public.horario_semanal (dia, bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin, actualizado_en)
      values (v_dia, v_b1i, v_b1f, v_b2i, v_b2f, now())
      on conflict (dia) do update
        set bloque1_inicio = excluded.bloque1_inicio,
            bloque1_fin    = excluded.bloque1_fin,
            bloque2_inicio = excluded.bloque2_inicio,
            bloque2_fin    = excluded.bloque2_fin,
            actualizado_en = excluded.actualizado_en;

      insert into public.auditoria (usuario_email, tabla, registro_id, descripcion, campo, valor_anterior, valor_nuevo)
      values (v_email, 'horario_semanal', v_dia::text, v_nombres[v_dia], 'horario', v_txt_ant, v_txt_nue);
    end if;
  end loop;
end;
$$;

revoke execute on function public.guardar_horario_atencion(jsonb) from public, anon;
grant execute on function public.guardar_horario_atencion(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Citas web: turnos del día elegido (cuerpo de 20261001000075; solo cambia la lectura del horario)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horarios_disponibles_cita(p_asistente_id uuid, p_fecha date, p_duracion_min integer, p_excluir_cita_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(inicio timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_b1_inicio    time;
  v_b1_fin       time;
  v_b2_inicio    time;
  v_b2_fin       time;
  v_paso         constant int := 15;
begin
  if p_asistente_id is null then
    raise exception 'Falta el asistente';
  end if;

  if p_duracion_min is null or p_duracion_min <= 0 then
    raise exception 'Duración inválida';
  end if;

  -- Turnos del día de la semana pedido (horario_semanal). Sin fila o sin turno 1 = ese día no se atiende.
  select bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin
  into v_b1_inicio, v_b1_fin, v_b2_inicio, v_b2_fin
  from public.horario_semanal
  where dia = extract(isodow from p_fecha)::int;

  if v_b1_inicio is null then
    return;
  end if;

  return query
  with bloques(inicio, fin) as (
    values (v_b1_inicio, v_b1_fin), (v_b2_inicio, v_b2_fin)
  ),
  candidatos as (
    -- p_fecha + b.inicio da un timestamp "naive" (sin zona) — "at time
    -- zone 'America/Lima'" lo interpreta como hora de pared de Lima y
    -- recién ahí lo convierte a timestamptz real. Sin esto, el resultado
    -- dependería de la zona horaria de sesión de Postgres (normalmente
    -- UTC), corriendo los horarios ~5 horas — mismo bug que ya se
    -- corrigió una vez en es_hoy() (12_fix_zona_horaria_es_hoy.sql).
    select
      (((p_fecha + b.inicio) at time zone 'America/Lima')
        + (n * v_paso || ' minutes')::interval) as inicio
    from bloques b
    cross join lateral generate_series(
      0,
      greatest(
        0,
        floor((extract(epoch from (b.fin - b.inicio)) / 60 - p_duracion_min) / v_paso)
      )::int
    ) as n
    where b.inicio is not null and b.fin is not null
  ),
  ocupados as (
    select
      c.fecha_hora as inicio,
      c.fecha_hora + (coalesce(sum(cs.duracion_min), 30) || ' minutes')::interval as fin
    from public.citas c
    left join public.cita_servicios cs on cs.cita_id = c.id
    where c.asistente_id = p_asistente_id
      and c.estado <> 'CANCELADA'
      -- mismo motivo: sacar el día calendario de un timestamptz también
      -- depende de la zona horaria de sesión si no se fija a Lima.
      and (c.fecha_hora at time zone 'America/Lima')::date = p_fecha
      and (p_excluir_cita_id is null or c.id <> p_excluir_cita_id)
    group by c.id, c.fecha_hora
  )
  select cand.inicio
  from candidatos cand
  where cand.inicio > now()
    and not exists (
      select 1 from ocupados o
      where cand.inicio < o.fin
        and o.inicio < cand.inicio + (p_duracion_min || ' minutes')::interval
    )
  order by cand.inicio;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Pedidos web: turnos del día de entrega (cuerpo de 20261009000005; solo cambia la lectura del horario)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pedido_productos(p_producto_ids uuid[], p_tipo_entrega text, p_fecha_entrega date, p_hora_entrega time without time zone, p_metodo_pago text, p_comprobante_url text, p_zona_delivery_id uuid DEFAULT NULL::uuid, p_direccion text DEFAULT NULL::text, p_celular_entrega text DEFAULT NULL::text, p_codigo_cupon text DEFAULT NULL::text, p_tipo_comprobante text DEFAULT 'BOLETA'::text, p_ruc text DEFAULT NULL::text, p_razon_social text DEFAULT NULL::text, p_cantidades jsonb DEFAULT NULL::jsonb, p_total_esperado numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cliente_id          uuid;
  v_costo_delivery      numeric(10, 2) := 0;
  v_subtotal            numeric(10, 2) := 0;
  v_descuento_cupon     numeric(10, 2) := 0;
  v_cupon_tipo_descuento text;
  v_pedido_id           uuid;
  v_horario             record;
  v_dow                 int;
  v_items               jsonb;
  v_eval                jsonb;
  v_msg                 text;
  v_hint                text;
  v_total               numeric(10, 2);
  v_distintas           int;
begin
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de confirmar un pedido.';
  end if;

  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    raise exception 'Selecciona al menos un producto.';
  end if;

  if p_tipo_entrega not in ('RECOJO_TIENDA', 'DELIVERY') then
    raise exception 'Tipo de entrega inválido.';
  end if;

  if p_fecha_entrega is null or p_hora_entrega is null then
    raise exception 'Elige el día y la hora de entrega.';
  end if;

  if p_fecha_entrega < (now() at time zone 'America/Lima')::date then
    raise exception 'Elige un día que no haya pasado.';
  end if;

  -- Horario del DÍA elegido (horario_semanal, migración 20261112000004): cada día tiene sus propios turnos; un día sin
  -- turno 1 está cerrado.
  v_dow := extract(isodow from p_fecha_entrega);
  select bloque1_inicio, bloque1_fin, bloque2_inicio, bloque2_fin
    into v_horario
  from public.horario_semanal
  where dia = v_dow;

  if not found then
    raise exception 'El negocio no atiende ese día.';
  end if;
  if v_horario.bloque1_inicio is null then
    raise exception 'El negocio no atiende ese día.';
  end if;

  if not (
    p_hora_entrega between v_horario.bloque1_inicio and v_horario.bloque1_fin
    or (
      v_horario.bloque2_inicio is not null
      and p_hora_entrega between v_horario.bloque2_inicio and v_horario.bloque2_fin
    )
  ) then
    raise exception 'Elige una hora dentro del horario de atención.';
  end if;

  if p_metodo_pago not in ('YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA') then
    raise exception 'Método de pago inválido.';
  end if;

  if p_metodo_pago <> 'TARJETA' and (p_comprobante_url is null or btrim(p_comprobante_url) = '') then
    raise exception 'Sube la captura de tu pago para confirmar el pedido.';
  end if;

  if p_tipo_comprobante not in ('BOLETA', 'FACTURA') then
    raise exception 'Tipo de comprobante inválido.';
  end if;

  if p_tipo_comprobante = 'FACTURA' then
    if p_ruc is null or p_ruc !~ '^\d{11}$' then
      raise exception 'Ingresa un RUC válido de 11 dígitos para la factura.';
    end if;
    if p_razon_social is null or btrim(p_razon_social) = '' then
      raise exception 'Ingresa la razón social para la factura.';
    end if;
  end if;

  if p_codigo_cupon is not null then
    p_codigo_cupon := upper(btrim(p_codigo_cupon));
    if p_codigo_cupon = '' then
      p_codigo_cupon := null;
    else
      select tipo_descuento into v_cupon_tipo_descuento
      from public.cupones
      where codigo = p_codigo_cupon
        and cliente_id = v_cliente_id
        and estado = 'DISPONIBLE';

      if v_cupon_tipo_descuento is null then
        raise exception 'Ese cupón no existe, no es tuyo, o ya fue usado.';
      end if;
    end if;
  end if;

  if p_tipo_entrega = 'DELIVERY' then
    if p_direccion is null or btrim(p_direccion) = '' then
      raise exception 'Ingresa una dirección de entrega.';
    end if;

    select z.costo into v_costo_delivery
    from public.zonas_delivery z
    where z.id = p_zona_delivery_id and z.activo = true;

    if v_costo_delivery is null then
      raise exception 'Zona de delivery inválida.';
    end if;
  end if;

  insert into public.pedidos_web (
    cliente_id, tipo_entrega, zona_delivery_id, direccion_entrega, celular_entrega,
    fecha_entrega, hora_entrega, metodo_pago, comprobante_url, cupon_codigo,
    tipo_comprobante, ruc, razon_social,
    costo_delivery, subtotal, total
  )
  values (
    v_cliente_id, p_tipo_entrega,
    case when p_tipo_entrega = 'DELIVERY' then p_zona_delivery_id end,
    case when p_tipo_entrega = 'DELIVERY' then p_direccion end,
    case when p_tipo_entrega = 'DELIVERY' then p_celular_entrega end,
    p_fecha_entrega, p_hora_entrega, p_metodo_pago, p_comprobante_url, p_codigo_cupon,
    p_tipo_comprobante,
    case when p_tipo_comprobante = 'FACTURA' then p_ruc end,
    case when p_tipo_comprobante = 'FACTURA' then btrim(p_razon_social) end,
    v_costo_delivery, 0, 0
  )
  returning id into v_pedido_id;

  insert into public.pedidos_web_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
  select v_pedido_id, p.id, p.nombre, cp.cantidad, p.precio, cp.cantidad * p.precio
  from public.carrito_productos cp
  join public.productos p on p.id = cp.producto_id
  where cp.cliente_web_id = auth.uid()
    and cp.producto_id = any (p_producto_ids);

  select coalesce(sum(subtotal), 0) into v_subtotal
  from public.pedidos_web_items
  where pedido_id = v_pedido_id;

  if v_subtotal = 0 then
    raise exception 'No se encontraron productos válidos en tu carrito.';
  end if;

  -- QA-057: lo guardado debe ser EXACTAMENTE lo que la clienta vio y confirmó (mismos productos y cantidades). Si una
  -- mutación del carrito no llegó al servidor, se rechaza: la excepción revierte el pedido recién insertado.
  if p_cantidades is not null then
    select count(*) into v_distintas
    from (select producto_id, cantidad from public.pedidos_web_items where pedido_id = v_pedido_id) g
    full join (select x.producto_id, x.cantidad from jsonb_to_recordset(p_cantidades) as x(producto_id uuid, cantidad int)) c
      on c.producto_id = g.producto_id
    where g.producto_id is null or c.producto_id is null or g.cantidad is distinct from c.cantidad;
    if v_distintas > 0 then
      raise exception 'Tu carrito cambió mientras confirmabas: las cantidades guardadas no coinciden con las que viste. Actualiza el carrito y vuelve a confirmar. No se creó ningún pedido.'
        using hint = 'CARRITO_DESFASADO';
    end if;
  end if;

  -- QA-054: el cupón se valida aquí, ANTES de aceptar el pedido (y de que la clienta pague), con la misma lógica
  -- que confirmar_venta: alcance, compra mínima, nivel, vigencia, tope, costo conocido y protección global.
  if p_codigo_cupon is not null then
    select jsonb_agg(jsonb_build_object('tipo', 'PRODUCTO', 'producto_id', i.producto_id, 'nombre', i.nombre_producto,
                                        'cantidad', i.cantidad, 'subtotal', i.subtotal))
      into v_items
    from public.pedidos_web_items i
    where i.pedido_id = v_pedido_id;
    begin
      v_eval := public.recompensas_validar_cupon_pedido(v_cliente_id, p_codigo_cupon, v_items);
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
      raise exception '%', public.recompensas_motivo_cliente(v_msg, v_hint);
    end;
    v_descuento_cupon := (v_eval->>'descuento')::numeric;
  end if;

  -- QA-057: el total que se cobra debe ser el anunciado. Precios, descuento y protección siguen siendo los del servidor
  -- (no se confía en precios del navegador): si no coinciden, se rechaza sin pedido y se pide actualizar.
  v_total := round(v_subtotal - v_descuento_cupon, 2) + v_costo_delivery;
  if p_total_esperado is not null and v_total <> round(p_total_esperado, 2) then
    raise exception 'El total cambió: ahora es S/ % y no S/ %. Actualiza el carrito y vuelve a confirmar. No se creó ningún pedido.', v_total, round(p_total_esperado, 2)
      using hint = 'TOTAL_DISTINTO';
  end if;

  update public.pedidos_web
  set subtotal = v_subtotal,
      descuento_cupon = v_descuento_cupon,
      total = round(v_subtotal - v_descuento_cupon, 2) + v_costo_delivery
  where id = v_pedido_id;

  -- Con tarjeta el carrito NO se vacía aquí: si la pasarela rechaza el cobro,
  -- la clienta conserva sus productos. Lo vacía el navegador cuando el pago
  -- se confirma.
  if p_metodo_pago <> 'TARJETA' then
    delete from public.carrito_productos
    where cliente_web_id = auth.uid()
      and producto_id = any (p_producto_ids);
  end if;

  return v_pedido_id;
end;
$function$;

-- create or replace conserva los permisos de ambas funciones (horarios_disponibles_cita: anon + authenticated;
-- confirmar_pedido_productos: solo authenticated, 20261008000001).

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Una sola fuente de verdad
-- ---------------------------------------------------------------------------------------------------------------
alter table public.estado_negocio
  drop column dias_atencion,
  drop column bloque1_inicio,
  drop column bloque1_fin,
  drop column bloque2_inicio,
  drop column bloque2_fin;

commit;
