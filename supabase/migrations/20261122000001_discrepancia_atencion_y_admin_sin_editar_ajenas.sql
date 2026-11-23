-- =========================================================
-- Mi Panel: la administradora ya no edita/cancela/elimina atenciones de otras personas; si algo no cuadra, abre una
-- «discrepancia» y se resuelve hablando, con el acuerdo confirmado por las dos partes
--
-- ANTES: registro_servicios_update / registro_servicios_delete_admin dejaban a la admin tocar la atención de cualquiera
-- (cambiar el precio, cancelarla, borrarla), y con eso alterar lo que la trabajadora ve en sus totales y su pago.
--
-- AHORA:
--   1. Update/delete de la admin solo sobre SUS PROPIAS atenciones (usuario_id = auth.uid()). La dueña conserva lo suyo
--      (cancelar las de HOY). Los RPC de negocio (confirmar_venta, anular_venta, confirmar_atencion_pendiente,
--      asignar_cliente_atencion_pendiente…) son security definer y no pasan por estas políticas: no se ven afectados.
--   2. Tabla registro_discrepancias: «esta atención hay que conversarla». La abre solo la admin, no bloquea nada (ni ventas
--      ni totales: no es un riesgo, solo algo por aclarar) y se cierra cuando LAS DOS partes confirman el acuerdo (la manito):
--        · admin_acuerdo_en  → la admin confirmó.
--        · duena_acuerdo_en  → la dueña de la atención confirmó.
--        · resuelta_en       → ambas confirmaron (acuerdo exitoso).
--        · retirada_en       → la admin la retiró antes de resolverla (se abrió por error).
--      Solo una discrepancia activa por atención (índice único parcial); resuelta o retirada, se puede abrir otra después.
--   3. Todo se escribe por RPC (no hay políticas de insert/update/delete): el servidor decide quién puede qué.
-- =========================================================

begin;

-- 1) La admin solo modifica/borra sus propias atenciones ------------------------------------------------------------------
drop policy if exists registro_servicios_update on public.registro_servicios;
create policy registro_servicios_update on public.registro_servicios
  for update to authenticated
  using (
    (public.es_admin() and usuario_id = auth.uid() and estado <> 'PENDIENTE_PORCENTAJE')
    or (usuario_id = auth.uid() and public.es_hoy(fecha))
  )
  with check (
    (public.es_admin() and usuario_id = auth.uid() and estado <> 'PENDIENTE_PORCENTAJE')
    or (usuario_id = auth.uid() and public.es_hoy(fecha))
  );

drop policy if exists registro_servicios_delete_admin on public.registro_servicios;
create policy registro_servicios_delete_admin on public.registro_servicios
  for delete to authenticated
  using (public.es_admin() and usuario_id = auth.uid() and estado <> 'PENDIENTE_PORCENTAJE');

-- 2) Discrepancias ---------------------------------------------------------------------------------------------------------
create table public.registro_discrepancias (
  id               uuid primary key default gen_random_uuid(),
  registro_id      uuid not null references public.registro_servicios(id) on delete cascade,
  creada_por       uuid references public.usuarios(id) on delete set null,
  creada_en        timestamptz not null default now(),
  admin_acuerdo_en timestamptz,
  duena_acuerdo_en timestamptz,
  resuelta_en      timestamptz,
  retirada_en      timestamptz
);

create unique index registro_discrepancias_activa_uniq
  on public.registro_discrepancias (registro_id)
  where resuelta_en is null and retirada_en is null;

create index registro_discrepancias_registro_idx on public.registro_discrepancias (registro_id);

alter table public.registro_discrepancias enable row level security;

-- Lectura: la admin ve todas; cada persona solo las de sus propias atenciones. Sin políticas de escritura: solo los RPC.
create policy registro_discrepancias_select on public.registro_discrepancias
  for select to authenticated
  using (
    public.es_admin()
    or exists (
      select 1 from public.registro_servicios r
      where r.id = registro_discrepancias.registro_id and r.usuario_id = auth.uid()
    )
  );

grant select on public.registro_discrepancias to authenticated;

-- 3) RPC ---------------------------------------------------------------------------------------------------------------------

-- La admin abre una discrepancia sobre la atención de OTRA persona (las suyas las edita directamente).
create or replace function public.marcar_discrepancia_atencion(p_registro_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registro_servicios%rowtype;
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede marcar una discrepancia';
  end if;

  select * into v_registro from public.registro_servicios where id = p_registro_id;
  if not found then
    raise exception 'La atención no existe';
  end if;
  if v_registro.usuario_id = auth.uid() then
    raise exception 'Es tu propia atención: puedes editarla directamente';
  end if;
  if v_registro.estado = 'CANCELADO' then
    raise exception 'La atención ya está cancelada';
  end if;
  if exists (
    select 1 from public.registro_discrepancias
    where registro_id = p_registro_id and resuelta_en is null and retirada_en is null
  ) then
    raise exception 'Esta atención ya tiene una discrepancia abierta';
  end if;

  insert into public.registro_discrepancias (registro_id, creada_por)
  values (p_registro_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- La admin retira una discrepancia que aún no se resolvió (por ejemplo, la abrió por error).
create or replace function public.retirar_discrepancia_atencion(p_registro_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede retirar una discrepancia';
  end if;

  update public.registro_discrepancias
     set retirada_en = now()
   where registro_id = p_registro_id and resuelta_en is null and retirada_en is null;
  if not found then
    raise exception 'No hay una discrepancia abierta en esta atención';
  end if;
end;
$$;

-- «La manito»: cada parte confirma que llegaron a un acuerdo. Sirve en cualquier orden; cuando están las dos, queda resuelta.
-- Devuelve 'RESUELTA' si con esta confirmación se cerró, o 'ESPERANDO' si falta la otra parte.
create or replace function public.confirmar_acuerdo_atencion(p_registro_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dueno uuid;
  v_disc public.registro_discrepancias%rowtype;
begin
  select usuario_id into v_dueno from public.registro_servicios where id = p_registro_id;
  if not found then
    raise exception 'La atención no existe';
  end if;

  select * into v_disc
    from public.registro_discrepancias
   where registro_id = p_registro_id and resuelta_en is null and retirada_en is null
   for update;
  if not found then
    raise exception 'No hay una discrepancia abierta en esta atención';
  end if;

  if auth.uid() = v_dueno then
    update public.registro_discrepancias
       set duena_acuerdo_en = coalesce(duena_acuerdo_en, now())
     where id = v_disc.id
     returning * into v_disc;
  elsif public.es_admin() then
    update public.registro_discrepancias
       set admin_acuerdo_en = coalesce(admin_acuerdo_en, now())
     where id = v_disc.id
     returning * into v_disc;
  else
    raise exception 'No tienes permiso sobre esta atención';
  end if;

  if v_disc.admin_acuerdo_en is not null and v_disc.duena_acuerdo_en is not null then
    update public.registro_discrepancias set resuelta_en = now() where id = v_disc.id;
    return 'RESUELTA';
  end if;
  return 'ESPERANDO';
end;
$$;

revoke execute on function public.marcar_discrepancia_atencion(uuid) from public;
revoke execute on function public.retirar_discrepancia_atencion(uuid) from public;
revoke execute on function public.confirmar_acuerdo_atencion(uuid) from public;
grant execute on function public.marcar_discrepancia_atencion(uuid) to authenticated;
grant execute on function public.retirar_discrepancia_atencion(uuid) to authenticated;
grant execute on function public.confirmar_acuerdo_atencion(uuid) to authenticated;

commit;
