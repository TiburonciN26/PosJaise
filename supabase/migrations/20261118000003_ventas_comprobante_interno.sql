-- =========================================================
-- POS: comprobante (boleta / factura) interno por venta
--
-- Contexto: la integración automática con un proveedor SUNAT se canceló
-- (la rama wip/comprobantes nunca se subió). La clienta tiene una contadora
-- que emite los comprobantes legales a partir de lo que el POS le pase. Esta
-- migración NO emite nada ante SUNAT: solo deja guardado, en la propia venta,
-- que el comprador pidió boleta o factura y con qué datos, para
--   1) imprimir el documento en el ticket al cobrar,
--   2) exportar la lista a la contadora, y
--   3) marcar cuáles ya emitió ella (y con qué número legal).
--
-- Por qué columnas en `ventas` y no una tabla aparte: es 1 comprobante por
-- venta y la admin ya ve `ventas` en Historial. La tabla `comprobantes` que
-- existe en la base local viene de la rama wip/comprobantes (SUNAT real) y no
-- está en migrations/: no se usa ni se toca aquí.
--
-- Por qué una función aparte y no un parámetro nuevo en confirmar_venta:
-- confirmar_venta ya tiene decenas de versiones (cambiar su firma obliga a
-- drop function + recrear y es fácil romper pedidos web/cupones), y en
-- producción conserva 9 parámetros. Se llama justo después de cobrar; si
-- fallara, la venta ya está cobrada y la admin puede registrar el comprobante
-- desde Historial con la misma función.
--
-- Numeración: B-000001 / F-000001, correlativo interno. A propósito NO imita
-- una serie SUNAT (B001-…): la contadora emite con la suya y los números no
-- deben chocar. El número legal que ella devuelva se guarda en
-- comprobante_legal.
-- =========================================================

begin;

alter table public.ventas
  add column if not exists comprobante_tipo        text,
  add column if not exists comprobante_numero      text,
  add column if not exists comprobante_tipo_doc    text,
  -- Celular (9 dígitos, sin +51) al que se enviará el PDF oficial por WhatsApp.
  add column if not exists comprobante_celular     text,
  add column if not exists comprobante_documento   text,
  add column if not exists comprobante_nombre      text,
  add column if not exists comprobante_direccion   text,
  add column if not exists comprobante_estado      text,
  add column if not exists comprobante_legal       text,
  add column if not exists comprobante_emitido_en  timestamptz;

alter table public.ventas
  drop constraint if exists ventas_comprobante_tipo_check,
  drop constraint if exists ventas_comprobante_estado_check,
  drop constraint if exists ventas_comprobante_coherente,
  drop constraint if exists ventas_comprobante_factura_ruc,
  drop constraint if exists ventas_comprobante_tipo_doc_check,
  drop constraint if exists ventas_comprobante_doc_coherente,
  drop constraint if exists ventas_comprobante_celular_check;

-- Tipo de documento del comprador (DNI / RUC / CE / PASAPORTE). Las filas
-- anteriores a esta columna (pruebas locales) se completan: toda factura es RUC y
-- un documento de boleta sin tipo era un DNI.
update public.ventas
set comprobante_tipo_doc = case
      when comprobante_tipo = 'FACTURA' then 'RUC'
      when comprobante_documento is not null then 'DNI'
    end
where comprobante_tipo is not null
  and comprobante_tipo_doc is null;

alter table public.ventas
  add constraint ventas_comprobante_tipo_check
    check (comprobante_tipo is null or comprobante_tipo in ('BOLETA', 'FACTURA')),
  add constraint ventas_comprobante_estado_check
    check (comprobante_estado is null or comprobante_estado in ('PENDIENTE', 'EMITIDO')),
  -- Tipo, número y estado van juntos: o los tres o ninguno.
  add constraint ventas_comprobante_coherente
    check (
      (comprobante_tipo is null and comprobante_numero is null and comprobante_estado is null)
      or (comprobante_tipo is not null and comprobante_numero is not null and comprobante_estado is not null)
    ),
  -- Una factura siempre lleva RUC de 11 dígitos y razón social.
  add constraint ventas_comprobante_factura_ruc
    check (
      comprobante_tipo is distinct from 'FACTURA'
      or (
        comprobante_tipo_doc = 'RUC'
        and comprobante_documento ~ '^[0-9]{11}$'
        and nullif(btrim(comprobante_nombre), '') is not null
      )
    ),
  -- La boleta identifica al comprador con DNI, carné de extranjería o pasaporte.
  add constraint ventas_comprobante_tipo_doc_check
    check (
      comprobante_tipo_doc is null
      or comprobante_tipo_doc in ('DNI', 'CE', 'PASAPORTE')
      or (comprobante_tipo_doc = 'RUC' and comprobante_tipo = 'FACTURA')
    ),
  -- Documento y su tipo van juntos: o los dos o ninguno.
  add constraint ventas_comprobante_doc_coherente
    check ((comprobante_documento is null) = (comprobante_tipo_doc is null)),
  -- Celular peruano: 9 dígitos y empieza con 9.
  add constraint ventas_comprobante_celular_check
    check (comprobante_celular is null or comprobante_celular ~ '^9[0-9]{8}$');

create unique index if not exists ventas_comprobante_numero_uidx
  on public.ventas (comprobante_numero)
  where comprobante_numero is not null;

-- Para el filtro «pendientes de emitir» y la exportación a la contadora.
create index if not exists ventas_comprobante_pendiente_idx
  on public.ventas (fecha)
  where comprobante_estado = 'PENDIENTE';

create sequence if not exists public.ventas_comprobante_boleta_seq;
create sequence if not exists public.ventas_comprobante_factura_seq;

-- Versión anterior de la función (sin tipo de documento): se reemplaza por la de
-- abajo. En una base que nunca la tuvo, esto no hace nada.
drop function if exists public.registrar_comprobante_venta(uuid, text, text, text, text);
drop function if exists public.registrar_comprobante_venta(uuid, text, text, text, text, text);

-- Registra (o, la admin, corrige) el comprobante de una venta. Devuelve el
-- número interno (B-000001 / F-000001).
create or replace function public.registrar_comprobante_venta(
  p_venta_id       uuid,
  p_tipo           text,
  p_documento      text default null,
  p_nombre         text default null,
  p_direccion      text default null,
  p_tipo_documento text default null,
  p_celular        text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    text;
  v_venta  record;
  v_doc    text := nullif(btrim(p_documento), '');
  v_nombre text := nullif(btrim(p_nombre), '');
  v_dir    text := nullif(btrim(p_direccion), '');
  v_tdoc   text;
  v_numero text;
  -- Solo dígitos; se acepta con el 51 delante (+51 987 654 321).
  v_cel    text := nullif(regexp_replace(coalesce(p_celular, ''), '[^0-9]', '', 'g'), '');
begin
  if v_cel is not null and length(v_cel) = 11 and left(v_cel, 2) = '51' then
    v_cel := substr(v_cel, 3);
  end if;
  if v_cel is not null and v_cel !~ '^9[0-9]{8}$' then
    raise exception 'El celular debe tener 9 dígitos y empezar con 9.';
  end if;

  v_rol := public.rol_actual();
  if v_rol is null or v_rol not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'No tienes permiso para registrar comprobantes.';
  end if;

  if p_tipo is null or p_tipo not in ('BOLETA', 'FACTURA') then
    raise exception 'Tipo de comprobante inválido.';
  end if;

  select id, fecha, estado, total, vendedor_id, comprobante_tipo, comprobante_numero, comprobante_estado
    into v_venta
  from public.ventas
  where id = p_venta_id
  for update;

  if not found then
    raise exception 'Esa venta no existe.';
  end if;

  -- La cajera solo toca sus ventas de hoy (igual que lo que ve en Historial).
  if v_rol <> 'ADMINISTRADOR'
     and (v_venta.vendedor_id <> auth.uid() or not public.es_hoy(v_venta.fecha)) then
    raise exception 'Solo puedes registrar comprobantes de tus ventas de hoy.';
  end if;

  if v_venta.estado = 'ANULADA' then
    raise exception 'La venta está anulada: no lleva comprobante.';
  end if;

  if v_venta.comprobante_tipo is not null then
    if v_rol <> 'ADMINISTRADOR' then
      raise exception 'Esta venta ya tiene comprobante (%).', v_venta.comprobante_numero;
    end if;
    if v_venta.comprobante_estado <> 'PENDIENTE' then
      raise exception 'Ese comprobante ya figura como emitido: vuelve a pendiente para corregirlo.';
    end if;
    if v_venta.comprobante_tipo <> p_tipo then
      raise exception 'No se puede cambiar el tipo de un comprobante ya registrado (%).', v_venta.comprobante_numero;
    end if;
  end if;

  if p_tipo = 'FACTURA' then
    -- Solo el formato (11 dígitos), igual que pedidos_web. El dígito verificador
    -- del RUC se comprueba en el navegador de producción (rucValido en
    -- src/lib/comprobante.js), que en desarrollo lo omite para poder probar
    -- con números inventados; si la base lo exigiera, esas pruebas fallarían.
    if v_doc is null or v_doc !~ '^[0-9]{11}$' then
      raise exception 'Ingresa un RUC de 11 dígitos para la factura.';
    end if;
    if v_nombre is null then
      raise exception 'Ingresa la razón social para la factura.';
    end if;
    v_tdoc := 'RUC';
  else
    -- Boleta: el comprador se identifica con DNI (por defecto), carné de
    -- extranjería o pasaporte. Desde S/ 700 SUNAT pide documento y nombre; debajo
    -- son opcionales pero, si el documento va, debe ser válido.
    v_tdoc := upper(coalesce(nullif(btrim(p_tipo_documento), ''), 'DNI'));
    if v_tdoc not in ('DNI', 'CE', 'PASAPORTE') then
      raise exception 'Tipo de documento inválido para la boleta.';
    end if;
    if v_tdoc <> 'DNI' and v_doc is not null then
      v_doc := upper(v_doc);
    end if;

    if v_venta.total >= 700 then
      if v_doc is null then
        raise exception 'Las boletas desde S/ 700 piden el documento del comprador (DNI, carné de extranjería o pasaporte).';
      end if;
      if v_nombre is null then
        raise exception 'Las boletas desde S/ 700 piden también el nombre del comprador.';
      end if;
    end if;

    if v_doc is null then
      v_tdoc := null;
    elsif v_tdoc = 'DNI' and v_doc !~ '^[0-9]{8}$' then
      raise exception 'El DNI debe tener 8 dígitos.';
    elsif v_tdoc <> 'DNI' and v_doc !~ '^[A-Z0-9]{1,12}$' then
      raise exception 'El carné de extranjería o pasaporte admite hasta 12 letras o números.';
    end if;
  end if;

  if v_venta.comprobante_tipo is not null then
    update public.ventas
    set comprobante_tipo_doc  = v_tdoc,
        comprobante_documento = v_doc,
        comprobante_nombre    = v_nombre,
        comprobante_direccion = v_dir,
        -- Si no llega celular se conserva el que ya tenía (no se borra por un llamado viejo).
        comprobante_celular   = coalesce(v_cel, comprobante_celular)
    where id = p_venta_id;
    return v_venta.comprobante_numero;
  end if;

  if p_tipo = 'FACTURA' then
    v_numero := 'F-' || lpad(nextval('public.ventas_comprobante_factura_seq')::text, 6, '0');
  else
    v_numero := 'B-' || lpad(nextval('public.ventas_comprobante_boleta_seq')::text, 6, '0');
  end if;

  update public.ventas
  set comprobante_tipo      = p_tipo,
      comprobante_numero    = v_numero,
      comprobante_estado    = 'PENDIENTE',
      comprobante_tipo_doc  = v_tdoc,
      comprobante_documento = v_doc,
      comprobante_nombre    = v_nombre,
      comprobante_direccion = v_dir,
      comprobante_celular   = v_cel
  where id = p_venta_id;

  return v_numero;
end;
$$;

-- La admin marca un comprobante como emitido por la contadora (con el número
-- legal que ella devolvió, opcional) o lo devuelve a pendiente.
create or replace function public.actualizar_estado_comprobante(
  p_venta_id     uuid,
  p_emitido      boolean,
  p_numero_legal text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede cambiar el estado de un comprobante.';
  end if;

  select comprobante_tipo into v_tipo
  from public.ventas
  where id = p_venta_id
  for update;

  if not found then
    raise exception 'Esa venta no existe.';
  end if;
  if v_tipo is null then
    raise exception 'Esa venta no tiene comprobante registrado.';
  end if;

  if p_emitido then
    update public.ventas
    set comprobante_estado   = 'EMITIDO',
        comprobante_legal    = nullif(btrim(p_numero_legal), ''),
        comprobante_emitido_en = now()
    where id = p_venta_id;
  else
    update public.ventas
    set comprobante_estado   = 'PENDIENTE',
        comprobante_legal    = null,
        comprobante_emitido_en = null
    where id = p_venta_id;
  end if;
end;
$$;

revoke execute on function public.registrar_comprobante_venta(uuid, text, text, text, text, text, text) from public;
grant execute on function public.registrar_comprobante_venta(uuid, text, text, text, text, text, text) to authenticated;

revoke execute on function public.actualizar_estado_comprobante(uuid, boolean, text) from public;
grant execute on function public.actualizar_estado_comprobante(uuid, boolean, text) to authenticated;

commit;
