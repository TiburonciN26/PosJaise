-- 5.º rol de personal: PERSONAL_APOYO («Personal de apoyo»).
--
-- POR QUÉ (pedido de la dueña, 2026-11-12): a veces vienen chicas que NO trabajan en el salón, llamadas como apoyo
-- cuando hay mucho tráfico de clientas. Atienden y deben poder ANOTAR lo que hicieron en Mi Panel (para cobrar su
-- comisión), pero como no trabajan de forma permanente NO deben ver ninguna otra pestaña.
--
-- DECISIÓN: un valor más de `usuarios.rol`, igual que ENCARGADA (no «varios roles por usuario»). En el front solo
-- figura en Mi Panel (src/config/navegacion.js). Para la base de datos se comporta como una ASISTENTE en lo que Mi Panel
-- necesita, y se le cierra lo que una asistente sí tiene y ella no:
--
--   * CHECK usuarios_rol_check: se agrega 'PERSONAL_APOYO'.
--   * Citas (citas y cita_servicios): las políticas eran «cualquier personal» (rol_actual() is not null). Ahora excluyen
--     a PERSONAL_APOYO: sin pestaña Citas no tiene por qué leer la agenda (nombres y horarios de clientas) ni crear o
--     modificar citas desde la API. Las políticas «propio_web» de la clienta y citas_delete_admin no se tocan.
--   * Profesional seleccionable: asistentes_para_citas (selector del POS y de la web), agendar_cita_web y
--     reprogramar_mi_cita_web excluían cuentas CAJERA (no atienden); ahora también PERSONAL_APOYO, para que la clienta
--     no reserve con alguien que no está en el local. Cuerpos VIVOS (pg_get_functiondef) con solo ese filtro cambiado;
--     CREATE OR REPLACE conserva los grants.
--
-- QUÉ NO SE TOCA (ya funciona igual que para una ASISTENTE, por el VÍNCULO asistentes.usuario_id -> porcentajes y no por
-- el rol): registro_servicios (insertar/ver/editar lo propio), resumen_mi_panel, el trigger de comisión, porcentajes
-- (lee solo los suyos), y la lectura de clientes/servicios/asistentes que el formulario de Mi Panel necesita.
-- resumen_dashboard / resumen_estadisticas / resumen_asistentes_periodo filtran `<> 'ADMINISTRADOR'`: su comisión cuenta
-- como la de cualquier asistente. Ventas, gastos, deudas, inventario, etc. ya listan roles explícitos que no la incluyen.
--
-- Igual que una asistente, necesita su FICHA (la crea sola la pestaña Personal, Edge Function gestionar-personal) y sus
-- % en Porcentajes antes de registrar con comisión; sin % solo puede anotar como pendiente.
--
-- ANTES DE PRODUCCIÓN: los cuerpos de agendar_cita_web / reprogramar_mi_cita_web se tomaron del entorno local; comparar
-- con los de producción (pg_get_functiondef) antes de aplicar, por si allí hubiera una versión distinta.

begin;

alter table public.usuarios drop constraint usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
  check (rol in ('ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA', 'PERSONAL_APOYO'));

-- ---------------------------------------------------------------------------------------------------------
-- Citas: personal de planta sí, personal de apoyo no.
-- ---------------------------------------------------------------------------------------------------------

drop policy citas_select on public.citas;
create policy citas_select on public.citas for select to authenticated
  using (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy citas_insert on public.citas;
create policy citas_insert on public.citas for insert to authenticated
  with check (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy citas_update on public.citas;
create policy citas_update on public.citas for update to authenticated
  using (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO')
  with check (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy cita_servicios_select on public.cita_servicios;
create policy cita_servicios_select on public.cita_servicios for select to authenticated
  using (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy cita_servicios_insert on public.cita_servicios;
create policy cita_servicios_insert on public.cita_servicios for insert to authenticated
  with check (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy cita_servicios_update on public.cita_servicios;
create policy cita_servicios_update on public.cita_servicios for update to authenticated
  using (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO')
  with check (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

drop policy cita_servicios_delete on public.cita_servicios;
create policy cita_servicios_delete on public.cita_servicios for delete to authenticated
  using (public.rol_actual() is not null and public.rol_actual() <> 'PERSONAL_APOYO');

-- ---------------------------------------------------------------------------------------------------------
-- Profesional seleccionable en citas: ni CAJERA (no atiende) ni PERSONAL_APOYO (no está siempre en el local).
-- ---------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.asistentes_para_citas()
 RETURNS TABLE(id uuid, nombres_completos text, usuario_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id, a.nombres_completos, a.usuario_id
  from public.asistentes a
  where a.activo = true
    and (
      a.usuario_id is null
      or exists (
        select 1 from public.usuarios u
        where u.id = a.usuario_id and u.rol not in ('CAJERA', 'PERSONAL_APOYO')
      )
    )
  order by a.nombres_completos;
$function$;

-- agendar_cita_web
CREATE OR REPLACE FUNCTION public.agendar_cita_web(p_asistente_id uuid, p_fecha_hora timestamp with time zone, p_servicio_ids uuid[], p_metodo_pago text, p_comprobante_url text, p_adelanto numeric, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente_id      uuid;
  v_cita_id         uuid;
  v_duracion_total  int;
  v_precio_total    numeric(10, 2);
  v_adelanto_minimo numeric(10, 2);
  v_minimo_exigido  numeric(10, 2);
  v_disponible      boolean;
  v_servicio_id     uuid;
  v_duracion        int;
  v_precio          numeric;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'Completa tu perfil antes de agendar una cita';
  end if;

  if p_servicio_ids is null or array_length(p_servicio_ids, 1) is null then
    raise exception 'Elige al menos un servicio';
  end if;

  if not exists (
    select 1 from public.asistentes a
    where a.id = p_asistente_id
      and a.activo = true
      and (
        a.usuario_id is null
        or exists (select 1 from public.usuarios u where u.id = a.usuario_id and u.rol not in ('CAJERA', 'PERSONAL_APOYO'))
      )
  ) then
    raise exception 'Ese asistente no está disponible';
  end if;

  if p_fecha_hora is null or p_fecha_hora <= now() then
    raise exception 'La fecha debe ser futura';
  end if;

  select coalesce(sum(duracion_min), 0), coalesce(sum(precio), 0)
    into v_duracion_total, v_precio_total
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_duracion_total = 0 then
    raise exception 'Servicio inválido';
  end if;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      p_asistente_id, (p_fecha_hora at time zone 'America/Lima')::date, v_duracion_total
    ) h
    where h.inicio = p_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  if p_metodo_pago not in ('YAPE', 'PLIN', 'TRANSFERENCIA') then
    raise exception 'Método de pago inválido.';
  end if;

  if p_comprobante_url is null or btrim(p_comprobante_url) = '' then
    raise exception 'Sube la captura de tu adelanto para confirmar la reserva.';
  end if;

  select adelanto_minimo into v_adelanto_minimo from public.estado_negocio where id = 1;
  v_minimo_exigido := coalesce(v_adelanto_minimo, v_precio_total);

  if p_adelanto is null or p_adelanto < v_minimo_exigido then
    raise exception 'El adelanto debe ser de al menos S/ %.', v_minimo_exigido;
  end if;

  insert into public.citas (
    cliente_id, asistente_id, creado_por, creado_por_cliente_web_id, fecha_hora, nota, estado,
    metodo_pago, comprobante_url, adelanto
  )
  values (
    v_cliente_id, p_asistente_id, null, auth.uid(), p_fecha_hora, p_nota, 'PENDIENTE',
    p_metodo_pago, p_comprobante_url, p_adelanto
  )
  returning id into v_cita_id;

  foreach v_servicio_id in array p_servicio_ids loop
    select duracion_min, precio into v_duracion, v_precio
    from public.servicios
    where id = v_servicio_id and activo = true;

    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (v_cita_id, v_servicio_id, coalesce(v_duracion, 30), v_precio);
  end loop;

  return v_cita_id;
end;
$function$;

-- reprogramar_mi_cita_web
CREATE OR REPLACE FUNCTION public.reprogramar_mi_cita_web(p_cita_id uuid, p_asistente_id uuid, p_nueva_fecha_hora timestamp with time zone, p_servicio_ids uuid[], p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente_id     uuid;
  v_cita           record;
  v_duracion_total int;
  v_disponible     boolean;
  v_servicio_id    uuid;
  v_duracion       int;
  v_precio         numeric;
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select id into v_cliente_id from public.clientes where cliente_web_id = auth.uid();
  if v_cliente_id is null then
    raise exception 'No tienes un perfil vinculado';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null or v_cita.cliente_id is distinct from v_cliente_id then
    raise exception 'Esa cita no existe o no te pertenece';
  end if;

  if v_cita.estado in ('CANCELADA', 'COMPLETADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if v_cita.fecha_hora - now() < interval '3 hours' then
    raise exception 'Ya no puedes reprogramar esta cita — comunícate directamente con el negocio.';
  end if;

  if p_nueva_fecha_hora is null or p_nueva_fecha_hora <= now() then
    raise exception 'La nueva fecha debe ser futura';
  end if;

  if p_servicio_ids is null or array_length(p_servicio_ids, 1) is null then
    raise exception 'Elige al menos un servicio';
  end if;

  if not exists (
    select 1 from public.asistentes a
    where a.id = p_asistente_id
      and a.activo = true
      and (
        a.usuario_id is null
        or exists (select 1 from public.usuarios u where u.id = a.usuario_id and u.rol not in ('CAJERA', 'PERSONAL_APOYO'))
      )
  ) then
    raise exception 'Ese asistente no está disponible';
  end if;

  select coalesce(sum(duracion_min), 0) into v_duracion_total
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_duracion_total = 0 then
    raise exception 'Servicio inválido';
  end if;

  select exists (
    select 1
    from public.horarios_disponibles_cita(
      p_asistente_id,
      (p_nueva_fecha_hora at time zone 'America/Lima')::date,
      v_duracion_total,
      p_cita_id
    ) h
    where h.inicio = p_nueva_fecha_hora
  ) into v_disponible;

  if not v_disponible then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  update public.citas
  set asistente_id = p_asistente_id,
      fecha_hora    = p_nueva_fecha_hora,
      nota          = p_nota
  where id = p_cita_id;

  delete from public.cita_servicios where cita_id = p_cita_id;

  foreach v_servicio_id in array p_servicio_ids loop
    select duracion_min, precio into v_duracion, v_precio
    from public.servicios
    where id = v_servicio_id and activo = true;

    insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
    values (p_cita_id, v_servicio_id, coalesce(v_duracion, 30), v_precio);
  end loop;
end;
$function$;

commit;
