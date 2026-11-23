-- =========================================================
-- Citas: registrar QUIÉN canceló una cita o la marcó como «no asistió»
--
-- Una cita cancelada o «no asistió» se puede reactivar, pero nadie sabía quién había hecho el cambio (para saberlo había que ir
-- a Auditoría, y solo la administradora puede). Ahora la propia cita lo guarda y el detalle lo muestra:
--   · estado_cambiado_por  → usuario (personal) que cambió el estado a CANCELADA / NO_ASISTIO.
--   · estado_cambiado_web  → true si lo hizo la clienta desde la web (cancelar_mi_cita_web); entonces no hay usuario de personal.
--   · estado_cambiado_en   → cuándo.
-- Se llenan SOLO en el servidor (trigger BEFORE UPDATE, con auth.uid()): el front no manda quién fue, así no se puede falsear. Si
-- la cita vuelve a otro estado (reactivarla), se limpian. Si se actualiza la cita sin cambiar su estado, se conservan tal cual.
--
-- Citas ya canceladas / «no asistió»: se rescata el autor desde la auditoría (último cambio de estado a ese valor), cuando existe.
-- =========================================================

begin;

alter table public.citas
  add column estado_cambiado_por uuid references public.usuarios(id) on delete set null,
  add column estado_cambiado_web boolean not null default false,
  add column estado_cambiado_en  timestamptz;

-- Relleno de las ya existentes (ANTES de crear el trigger, que protege estas columnas cuando el estado no cambia).
update public.citas c
   set estado_cambiado_por = case when u.rol <> 'CLIENTE' then u.id end,
       estado_cambiado_web = (u.rol = 'CLIENTE'),
       estado_cambiado_en  = x.fecha
  from (
    select distinct on (a.registro_id) a.registro_id, a.usuario_email, a.fecha, a.valor_nuevo
    from public.auditoria a
    where a.tabla = 'citas' and a.campo = 'estado' and a.valor_nuevo in ('CANCELADA', 'NO_ASISTIO')
    order by a.registro_id, a.fecha desc
  ) x
  join public.usuarios u on lower(u.email) = lower(x.usuario_email)
 where x.registro_id = c.id::text
   and c.estado = x.valor_nuevo
   and c.estado in ('CANCELADA', 'NO_ASISTIO');

create or replace function public.citas_registrar_quien_cambio_estado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado is not distinct from old.estado then
    -- Sin cambio de estado: nadie puede reescribir quién fue (ni siquiera con un update directo).
    new.estado_cambiado_por := old.estado_cambiado_por;
    new.estado_cambiado_web := old.estado_cambiado_web;
    new.estado_cambiado_en  := old.estado_cambiado_en;
  elsif new.estado in ('CANCELADA', 'NO_ASISTIO') then
    new.estado_cambiado_por := null;
    new.estado_cambiado_web := false;
    new.estado_cambiado_en  := now();
    if auth.uid() is not null then
      if exists (select 1 from public.usuarios where id = auth.uid() and rol <> 'CLIENTE') then
        new.estado_cambiado_por := auth.uid();
      else
        new.estado_cambiado_web := true;
      end if;
    end if;
  else
    -- Reactivada (o completada/confirmada): ya no hay nada que atribuir.
    new.estado_cambiado_por := null;
    new.estado_cambiado_web := false;
    new.estado_cambiado_en  := null;
  end if;
  return new;
end;
$$;

create trigger trg_citas_quien_cambio_estado
  before update on public.citas
  for each row execute function public.citas_registrar_quien_cambio_estado();

commit;
