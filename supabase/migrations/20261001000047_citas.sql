-- =========================================================
-- POS Negocio 2 — Fase 8: Citas (agenda de reservas)
-- Ejecutar en Supabase → SQL Editor → New query
--
-- citas es la agenda: reservas futuras de un servicio con un
-- cliente y una asistente. Está separada de registro_servicios
-- (que es la atención YA realizada, la que suma en Mi Panel /
-- Estadísticas) — agendar o cancelar una cita nunca toca métricas.
--
-- asistente_id referencia asistentes(id), no usuarios(id): a
-- diferencia de registro_servicios (donde el dueño siempre es quien
-- está logueado registrando lo suyo), acá el admin necesita poder
-- agendarle una cita a cualquier asistente, incluso a una sin
-- cuenta vinculada todavía (asistentes.usuario_id nullable, ver
-- 18_asistentes_campos_adicionales.sql).
--
-- RLS: el administrador ve/gestiona todas las citas; cada asistente
-- ve/gestiona solo las suyas (asistente_id -> su propia ficha).
-- DELETE queda admin-only (mismo criterio que registro_servicios en
-- 23_registro_servicios_estado.sql) — una asistente cancela
-- (estado = 'CANCELADA'), no borra.
--
-- completar_cita(): une en un solo paso atómico lo que el frontend
-- pidió (registrar la atención + marcar la cita como completada),
-- mismo patrón que confirmar_venta()/agregar_stock() en
-- 45_negocio_cerrado_bloquea_escrituras.sql. El insert en
-- registro_servicios hereda gratis el trigger de comisión y el
-- bloqueo de "negocio cerrado" que ya existen ahí — no se duplica
-- nada de esa lógica acá.
-- =========================================================

begin;

create table public.citas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid references public.clientes (id) on delete set null,
  servicio_id         uuid references public.servicios (id) on delete set null,
  asistente_id        uuid references public.asistentes (id) on delete set null,
  creado_por          uuid not null references public.usuarios (id) on delete cascade,
  fecha_hora          timestamptz not null,
  duracion_min        int not null default 30,
  estado              text not null default 'PENDIENTE'
                        check (estado in ('PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO')),
  nota                text,
  registro_servicio_id uuid references public.registro_servicios (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index idx_citas_fecha_hora   on public.citas (fecha_hora);
create index idx_citas_asistente_id on public.citas (asistente_id);

alter table public.citas enable row level security;

grant select, insert, update, delete on public.citas to authenticated;

create policy citas_select on public.citas
  for select to authenticated
  using (
    public.es_admin()
    or asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
  );

create policy citas_insert on public.citas
  for insert to authenticated
  with check (
    public.es_admin()
    or asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
  );

create policy citas_update on public.citas
  for update to authenticated
  using (
    public.es_admin()
    or asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
  )
  with check (
    public.es_admin()
    or asistente_id in (select id from public.asistentes where usuario_id = auth.uid())
  );

create policy citas_delete_admin on public.citas
  for delete to authenticated
  using (public.es_admin());

-- ---------------------------------------------------------
-- completar_cita(): inserta la atención real (registro_servicios,
-- a nombre de quien completa) y liga la cita a ese registro, en un
-- solo paso. No se puede completar una cita ya completada/cancelada.
-- ---------------------------------------------------------
create or replace function public.completar_cita(
  p_cita_id    uuid,
  p_servicio_id uuid,
  p_cliente_id  uuid,
  p_precio      numeric,
  p_fecha       timestamptz,
  p_nota        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cita          record;
  v_registro_id   uuid;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  select * into v_cita from public.citas where id = p_cita_id for update;

  if v_cita.id is null then
    raise exception 'La cita no existe';
  end if;

  if not public.es_admin()
     and v_cita.asistente_id not in (select id from public.asistentes where usuario_id = auth.uid()) then
    raise exception 'No tienes permiso sobre esta cita';
  end if;

  if v_cita.estado in ('COMPLETADA', 'CANCELADA') then
    raise exception 'Esta cita ya está %', lower(v_cita.estado);
  end if;

  if p_precio is null or p_precio < 0 then
    raise exception 'Precio inválido';
  end if;

  insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio, fecha, nota)
  values (auth.uid(), p_servicio_id, p_cliente_id, p_precio, coalesce(p_fecha, v_cita.fecha_hora), p_nota)
  returning id into v_registro_id;

  update public.citas
  set estado = 'COMPLETADA', registro_servicio_id = v_registro_id
  where id = p_cita_id;

  return v_registro_id;
end;
$$;

grant execute on function public.completar_cita(uuid, uuid, uuid, numeric, timestamptz, text) to authenticated;

-- ---------------------------------------------------------
-- Descripción legible en Auditoría (se redefine completa: no se
-- puede agregar una rama nueva sin repetir las que ya existían,
-- mismo motivo que en 44_estado_negocio.sql).
-- ---------------------------------------------------------
create or replace function public.descripcion_de_fila(p_tabla text, p_fila jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado text;
begin
  if p_tabla = 'registro_servicios' then
    select s.nombre into v_resultado
    from public.servicios s
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Atención');
  end if;

  if p_tabla = 'porcentajes' then
    select s.nombre || ' — ' || a.nombres_completos into v_resultado
    from public.servicios s
    join public.asistentes a on a.id = (p_fila->>'asistente_id')::uuid
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Porcentaje');
  end if;

  if p_tabla = 'estado_negocio' then
    return 'Negocio';
  end if;

  if p_tabla = 'citas' then
    select c.nombre || ' — ' || s.nombre into v_resultado
    from public.servicios s
    join public.clientes c on c.id = (p_fila->>'cliente_id')::uuid
    where s.id = (p_fila->>'servicio_id')::uuid;
    return coalesce(v_resultado, 'Cita');
  end if;

  return coalesce(
    p_fila->>'nombre', p_fila->>'nombres_completos', p_fila->>'nombre_completo',
    p_fila->>'codigo', p_fila->>'id'
  );
end;
$$;

drop trigger if exists auditoria_citas on public.citas;
create trigger auditoria_citas
  after insert or update or delete on public.citas
  for each row execute function public.registrar_auditoria();

commit;
