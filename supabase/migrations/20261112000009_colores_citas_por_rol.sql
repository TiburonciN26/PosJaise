-- Citas POS: color de cada tarjeta de cita según el ROL de quien la registró ("Agendado por" = citas.creado_por), y un color
-- propio para las citas que agenda la clienta desde la Web (citas.creado_por_cliente_web_id). La administradora edita todos
-- los colores desde la pestaña Citas; los demás roles solo los ven aplicados.
--
-- POR QUÉ UNA TABLA Y NO localStorage: el color es una convención del negocio, tiene que verse igual en todos los dispositivos
-- y para todas las cuentas del personal.
--
-- POR QUÉ UNA FUNCIÓN APARTE PARA EL ROL DE QUIEN AGENDÓ (autores_citas_rol) Y NO AMPLIAR usuarios_para_citas(): esa función
-- también la llama el portal de clientas (HistorialCliente.jsx) y a propósito expone solo id + nombre, sin el rol. Esta nueva
-- solo devuelve filas a una cuenta del personal (rol_actual() no es null: las clientas no tienen fila en usuarios), y además
-- incluye usuarios inactivos para que una cita vieja de alguien dado de baja conserve su color.
--
-- Escritura solo vía guardar_colores_citas() (security definer, solo ADMINISTRADOR, valida #RRGGBB y la clave), igual que
-- guardar_horario_atencion(): la tabla no tiene políticas de insert/update/delete para authenticated.

begin;

create table public.colores_citas_rol (
  clave text primary key
    check (clave in ('ADMINISTRADOR', 'ENCARGADA', 'CAJERA', 'ASISTENTE', 'PERSONAL_APOYO', 'CLIENTE_WEB')),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  actualizado_en timestamptz not null default now()
);

comment on table public.colores_citas_rol is
  'Color de las tarjetas de cita (pestaña Citas del POS) según el rol de quien la agendó; CLIENTE_WEB = agendada desde la Web.';

-- Valores iniciales pedidos por la dueña: admin verde jade, encargada rosa palo; el resto, distinguibles entre sí y editables.
insert into public.colores_citas_rol (clave, color) values
  ('ADMINISTRADOR',  '#00A86B'),  -- verde jade
  ('ENCARGADA',      '#E8B4B8'),  -- rosa palo
  ('CAJERA',         '#5B8DEF'),
  ('ASISTENTE',      '#A78BFA'),
  ('PERSONAL_APOYO', '#F2C14E'),
  ('CLIENTE_WEB',    '#4DD0E1');

alter table public.colores_citas_rol enable row level security;

-- Solo el personal (cualquier rol con fila en usuarios) lee los colores; las clientas no los necesitan.
create policy colores_citas_rol_select on public.colores_citas_rol for select to authenticated
  using ((select public.rol_actual()) is not null);

-- En este proyecto authenticated NO recibe privilegios por defecto: sin este GRANT la lectura daría 403 aunque la RLS deje pasar.
grant select on public.colores_citas_rol to authenticated;

create or replace function public.autores_citas_rol()
returns table (id uuid, rol text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.rol
  from public.usuarios u
  where public.rol_actual() is not null;
$$;

revoke execute on function public.autores_citas_rol() from public, anon;
grant execute on function public.autores_citas_rol() to authenticated;

-- p_colores: {"ADMINISTRADOR": "#00A86B", "ENCARGADA": "#E8B4B8", ...}. Claves ausentes se dejan como están.
create or replace function public.guardar_colores_citas(p_colores jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clave text;
  v_color text;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede cambiar los colores de las citas' using errcode = '42501';
  end if;

  if p_colores is null or jsonb_typeof(p_colores) <> 'object' then
    raise exception 'Formato de colores inválido' using errcode = 'P0001';
  end if;

  for v_clave, v_color in select key, value #>> '{}' from jsonb_each(p_colores) loop
    if v_clave not in ('ADMINISTRADOR', 'ENCARGADA', 'CAJERA', 'ASISTENTE', 'PERSONAL_APOYO', 'CLIENTE_WEB') then
      raise exception 'Rol desconocido: %', v_clave using errcode = 'P0001';
    end if;
    if v_color is null or v_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Color inválido para %: usa el formato #RRGGBB', v_clave using errcode = 'P0001';
    end if;

    update public.colores_citas_rol
    set color = upper(v_color), actualizado_en = now()
    where clave = v_clave;
  end loop;
end;
$$;

revoke execute on function public.guardar_colores_citas(jsonb) from public, anon;
grant execute on function public.guardar_colores_citas(jsonb) to authenticated;

commit;
