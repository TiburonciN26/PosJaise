-- =========================================================
-- Costeo de servicios — costo de COMPRA y USOS por línea (el sistema calcula el costo por uso).
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte.
--
-- Por qué: un envase (alcohol, gel, esmalte…) rinde para muchos servicios. Pedir el «costo unitario» obligaba a la dueña a dividir a
-- mano el precio del envase entre sus usos. Ahora cada línea guarda lo que se COMPRÓ (costo_compra) y para cuántos usos RINDE
-- (rinde); la base calcula el costo por uso = costo_compra ÷ rinde (redondeado a 4 decimales) y lo guarda en costo_unitario, que
-- sigue siendo lo que multiplica a la cantidad usada. Así nada más cambia: los totales, el desglose y las funciones de protección
-- siguen leyendo cantidad × costo_unitario.
--
-- Compatibilidad: las líneas guardadas antes de esta migración quedan con costo_compra y rinde en NULL (se siguen leyendo con su
-- costo_unitario) y guardar_costeo_servicio sigue aceptando líneas con solo costo_unitario. costo_compra y rinde van juntos o
-- ninguno. No cambia ninguna venta, comisión ni dato existente.
-- =========================================================

begin;

alter table public.servicios_costos_detalle
  add column costo_compra numeric(12, 4) check (costo_compra is null or costo_compra >= 0),
  add column rinde numeric(12, 4) check (rinde is null or rinde > 0),
  add constraint servicios_costos_detalle_compra_y_rinde check ((costo_compra is null) = (rinde is null));

create or replace function public.guardar_costeo_servicio(p_servicio_id uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l jsonb;
  v_i int := 0;
  v_cat text;
  v_desc text;
  v_cant numeric;
  v_cu numeric;
  v_compra numeric;
  v_rinde numeric;
  v_art uuid;
  v_mat numeric;
  v_otros numeric;
  v_local numeric;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede guardar el costeo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.servicios where id = p_servicio_id) then
    raise exception 'El servicio no existe.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de costo no son válidas.';
  end if;
  if jsonb_array_length(p_lineas) > 60 then
    raise exception 'Máximo 60 líneas de costo por servicio.';
  end if;

  delete from public.servicios_costos_detalle where servicio_id = p_servicio_id;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_i := v_i + 1;
    v_cat := v_l ->> 'categoria';
    v_desc := btrim(coalesce(v_l ->> 'descripcion', ''));
    begin
      v_cant := (v_l ->> 'cantidad')::numeric;
      v_cu := nullif(v_l ->> 'costo_unitario', '')::numeric;
      v_compra := nullif(v_l ->> 'costo_compra', '')::numeric;
      v_rinde := nullif(v_l ->> 'rinde', '')::numeric;
    exception when others then
      raise exception 'Línea %: la cantidad, el costo o los usos no son números válidos.', v_i;
    end;
    if v_cat is null or v_cat not in ('INSUMO', 'DESCARTABLE', 'HERRAMIENTA', 'TARJETA_POS', 'OTRO', 'LOCAL') then
      raise exception 'Línea %: categoría no válida.', v_i;
    end if;
    if v_desc = '' or length(v_desc) > 120 then
      raise exception 'Línea %: escribe una descripción (hasta 120 caracteres).', v_i;
    end if;
    if v_cant is null or v_cant <= 0 or v_cant > 100000 then
      raise exception 'Línea %: la cantidad debe ser mayor a 0.', v_i;
    end if;
    -- Costo por USO calculado por la base: lo que se compró ÷ para cuántos usos rinde. «rinde» vacío con costo de compra = 1 uso
    -- (el mismo costo de antes). Sin costo de compra se usa el costo unitario tal cual (líneas guardadas antes de esta migración).
    if v_compra is not null then
      if v_compra < 0 or v_compra > 1000000 then
        raise exception 'Línea %: el costo de lo que compraste no es válido.', v_i;
      end if;
      v_rinde := coalesce(v_rinde, 1);
      if v_rinde <= 0 or v_rinde > 1000000 then
        raise exception 'Línea %: «rinde» debe ser un número de usos mayor a 0.', v_i;
      end if;
      v_cu := round(v_compra / v_rinde, 4);
    elsif v_rinde is not null then
      raise exception 'Línea %: indica el costo de lo que compraste.', v_i;
    end if;
    if v_cu is null or v_cu < 0 or v_cu > 1000000 then
      raise exception 'Línea %: el costo unitario no es válido.', v_i;
    end if;
    v_art := null;
    if nullif(v_l ->> 'almacen_articulo_id', '') is not null then
      select id into v_art from public.almacen_articulos where id = (v_l ->> 'almacen_articulo_id')::uuid;
    end if;
    insert into public.servicios_costos_detalle
      (servicio_id, categoria, descripcion, almacen_articulo_id, cantidad, unidad, costo_unitario, costo_compra, rinde, orden)
    values
      (p_servicio_id, v_cat, v_desc, v_art, v_cant, nullif(btrim(coalesce(v_l ->> 'unidad', '')), ''), v_cu, v_compra,
       case when v_compra is null then null else v_rinde end, v_i);
  end loop;

  select ceil(coalesce(sum(subtotal) filter (where categoria in ('INSUMO', 'DESCARTABLE', 'HERRAMIENTA')), 0) * 100) / 100,
         ceil(coalesce(sum(subtotal) filter (where categoria in ('TARJETA_POS', 'OTRO')), 0) * 100) / 100,
         ceil(coalesce(sum(subtotal) filter (where categoria = 'LOCAL'), 0) * 100) / 100
    into v_mat, v_otros, v_local
  from public.servicios_costos_detalle where servicio_id = p_servicio_id;

  -- Fila presente = configurado (aunque todo sea 0: decisión explícita). La estimación antigua de asistente no se usa
  -- (la mano de obra sale de la comisión real); en una fila nueva queda en 0 y en una existente no se toca.
  insert into public.servicios_proteccion (servicio_id, materiales, otros, asistente_pct)
  values (p_servicio_id, v_mat, v_otros, 0)
  on conflict (servicio_id) do update
    set materiales = excluded.materiales, otros = excluded.otros, actualizado_en = now();

  return jsonb_build_object('materiales', v_mat, 'otros', v_otros, 'local', v_local, 'lineas', v_i);
end;
$$;;

commit;
