-- =========================================================
-- POS: PDF oficial del comprobante e importación de números emitidos
--
-- Sigue a 20261118000003_ventas_comprobante_interno (el POS no emite ante
-- SUNAT: guarda lo que el comprador pidió y la contadora emite el legal).
-- Esta migración cubre lo que pasa DESPUÉS de que ella emite:
--   1) la administradora adjunta a la venta el PDF oficial que la contadora
--      devolvió (bucket privado `comprobantes-emitidos`) y desde Historial se lo
--      manda al comprador por WhatsApp con un enlace firmado;
--   2) la contadora puede devolver el mismo CSV que se le exportó, con la columna
--      `numero_emitido` llena, y la administradora lo importa para marcar de una
--      vez todas esas ventas como emitidas (importar_numeros_comprobantes). Así la
--      contadora no necesita una cuenta en el POS.
--
-- El PDF contiene el DNI/RUC del comprador: el bucket es privado, solo la
-- administradora lo lee o escribe, solo admite PDF y no pasa de 5 MB (a
-- diferencia de otros buckets del proyecto, que no tienen límite).
-- =========================================================

begin;

alter table public.ventas
  add column if not exists comprobante_pdf    text,
  add column if not exists comprobante_pdf_en timestamptz;

alter table public.ventas
  drop constraint if exists ventas_comprobante_pdf_coherente;

alter table public.ventas
  add constraint ventas_comprobante_pdf_coherente
    check (
      (comprobante_pdf is null) = (comprobante_pdf_en is null)
      and (comprobante_pdf is null or comprobante_tipo is not null)
    );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-emitidos', 'comprobantes-emitidos', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['application/pdf'];

drop policy if exists comprobantes_emitidos_select on storage.objects;
drop policy if exists comprobantes_emitidos_insert on storage.objects;
drop policy if exists comprobantes_emitidos_update on storage.objects;
drop policy if exists comprobantes_emitidos_delete on storage.objects;

create policy comprobantes_emitidos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes-emitidos' and public.es_admin());

create policy comprobantes_emitidos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes-emitidos' and public.es_admin());

create policy comprobantes_emitidos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'comprobantes-emitidos' and public.es_admin())
  with check (bucket_id = 'comprobantes-emitidos' and public.es_admin());

create policy comprobantes_emitidos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes-emitidos' and public.es_admin());

-- Guarda en la venta la ruta del PDF ya subido a Storage. Devuelve la ruta del PDF
-- anterior (o null) para que el cliente la borre DESPUÉS de este paso: así no queda un
-- archivo huérfano si algo falla a medias (mismo orden que las fotos, lib/imagenes.js).
create or replace function public.adjuntar_pdf_comprobante(
  p_venta_id uuid,
  p_ruta     text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo     text;
  v_anterior text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede adjuntar el PDF de un comprobante.';
  end if;

  if p_ruta is null or p_ruta !~ ('^' || p_venta_id::text || '/[^/]+\.pdf$') then
    raise exception 'Ruta de PDF inválida para esta venta.';
  end if;

  select comprobante_tipo, comprobante_pdf
    into v_tipo, v_anterior
  from public.ventas
  where id = p_venta_id
  for update;

  if not found then
    raise exception 'Esa venta no existe.';
  end if;
  if v_tipo is null then
    raise exception 'Esa venta no tiene comprobante registrado.';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'comprobantes-emitidos' and name = p_ruta
  ) then
    raise exception 'El PDF no está en el almacenamiento: vuelve a subirlo.';
  end if;

  update public.ventas
  set comprobante_pdf = p_ruta,
      comprobante_pdf_en = now()
  where id = p_venta_id;

  -- Si se reemplazó por la misma ruta no hay nada que borrar.
  return case when v_anterior is distinct from p_ruta then v_anterior end;
end;
$$;

-- Importa lo que devuelve la contadora: una lista de { codigo, numero_legal }. Marca
-- como EMITIDAS las ventas con comprobante PENDIENTE y guarda su número legal. No toca
-- las ya emitidas (para no pisar un número legal). Devuelve el resultado por categoría
-- para mostrárselo a la administradora.
create or replace function public.importar_numeros_comprobantes(p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fila        jsonb;
  v_codigo      text;
  v_numero      text;
  v_venta       record;
  v_actualizadas int := 0;
  v_ya          text[] := '{}';
  v_no_existe   text[] := '{}';
  v_sin_comp    text[] := '{}';
  v_anuladas    text[] := '{}';
  v_invalidas   text[] := '{}';
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede importar números de comprobantes.';
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'El archivo no tiene el formato esperado.';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'El archivo tiene más de 2000 filas: divídelo en partes.';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas)
  loop
    v_codigo := upper(btrim(coalesce(v_fila ->> 'codigo', '')));
    v_numero := btrim(coalesce(v_fila ->> 'numero_legal', ''));

    -- Fila sin número: la contadora aún no la emitió, no se toca.
    if v_codigo = '' or v_numero = '' then
      continue;
    end if;

    if v_numero !~ '^[A-Za-z0-9-]{1,30}$' then
      v_invalidas := v_invalidas || v_codigo;
      continue;
    end if;

    select id, estado, comprobante_tipo, comprobante_estado
      into v_venta
    from public.ventas
    where codigo = v_codigo
    for update;

    if not found then
      v_no_existe := v_no_existe || v_codigo;
    elsif v_venta.estado = 'ANULADA' then
      v_anuladas := v_anuladas || v_codigo;
    elsif v_venta.comprobante_tipo is null then
      v_sin_comp := v_sin_comp || v_codigo;
    elsif v_venta.comprobante_estado = 'EMITIDO' then
      v_ya := v_ya || v_codigo;
    else
      update public.ventas
      set comprobante_estado = 'EMITIDO',
          comprobante_legal = v_numero,
          comprobante_emitido_en = now()
      where id = v_venta.id;
      v_actualizadas := v_actualizadas + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'actualizadas', v_actualizadas,
    'ya_emitidas', to_jsonb(v_ya),
    'no_encontradas', to_jsonb(v_no_existe),
    'sin_comprobante', to_jsonb(v_sin_comp),
    'anuladas', to_jsonb(v_anuladas),
    'invalidas', to_jsonb(v_invalidas)
  );
end;
$$;

revoke execute on function public.adjuntar_pdf_comprobante(uuid, text) from public;
grant execute on function public.adjuntar_pdf_comprobante(uuid, text) to authenticated;

revoke execute on function public.importar_numeros_comprobantes(jsonb) from public;
grant execute on function public.importar_numeros_comprobantes(jsonb) to authenticated;

commit;
