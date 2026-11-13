-- =========================================================
-- Deudas: consulta para Cajera/Encargada y «notas de cobro» que confirma la administradora
--
-- Por qué: la cajera y la encargada atienden en caja y son quienes reciben el dinero cuando una clienta paga lo que
-- debe, pero la pestaña Deudas era solo de la administradora (RLS es_admin()). A pedido de la dueña (2026-11-12):
--   · CAJERA y ENCARGADA pueden CONSULTAR las deudas y sus pagos (solo lectura).
--   · NO pueden crear, editar ni eliminar deudas, ni registrar o anular pagos: esas políticas siguen siendo es_admin(),
--     y registrar_pago_deuda / anular_pago_deuda son SECURITY INVOKER, así que la RLS las sigue frenando.
--   · Lo único que pueden hacer es dejar una NOTA DE COBRO («la clienta pagó S/ X el día tal»). La deuda NO cambia.
--   · La administradora revisa la nota y la CONFIRMA (con el monto que ella verifique: total o parcial; ahí recién se
--     registra el pago en deuda_pagos y baja el saldo) o la RECHAZA.
--
-- Escrituras SOLO por funciones (security definer, con su propia comprobación de rol): la tabla no tiene grants de
-- insert/update/delete para authenticated, así nadie puede marcar su propia nota como confirmada desde el navegador.
-- El nombre de quien anota se guarda en la nota porque la cajera no puede leer `usuarios` de otras personas (RLS).
-- =========================================================

begin;

-- 1) Lectura de deudas y pagos para CAJERA y ENCARGADA (las demás políticas no se tocan).
drop policy if exists deudas_select on public.deudas;
create policy deudas_select on public.deudas
  for select to authenticated
  using (public.rol_actual() in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA'));

drop policy if exists deuda_pagos_select on public.deuda_pagos;
create policy deuda_pagos_select on public.deuda_pagos
  for select to authenticated
  using (public.rol_actual() in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA'));

-- 2) Notas de cobro.
create table public.deuda_notas_cobro (
  id                 uuid primary key default gen_random_uuid(),
  deuda_id           uuid not null references public.deudas (id) on delete cascade,
  monto              numeric(10,2) not null check (monto > 0),   -- lo que la cajera dice que recibió
  fecha              date not null,                               -- cuándo dice que pagó la clienta
  nota               text,
  -- DESCARTADA: la deuda quedó cobrada por otra vía (la admin cobró directo u otra nota cubrió el saldo) y esta nota ya
  -- no tiene efecto; la cierra el trigger de abajo para que no quede pendiente ni se pueda confirmar.
  estado             text not null default 'PENDIENTE'
                     check (estado in ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA', 'DESCARTADA')),
  creado_por         uuid references public.usuarios (id) on delete set null,
  creado_por_nombre  text,
  creado_en          timestamptz not null default now(),
  revisado_por       uuid references public.usuarios (id) on delete set null,
  revisado_en        timestamptz,
  monto_confirmado   numeric(10,2),                              -- lo que la admin registró como pago (puede ser menos)
  pago_id            uuid references public.deuda_pagos (id) on delete set null
);

create index idx_deuda_notas_cobro_deuda_id on public.deuda_notas_cobro (deuda_id);
create index idx_deuda_notas_cobro_pendientes on public.deuda_notas_cobro (deuda_id) where estado = 'PENDIENTE';

alter table public.deuda_notas_cobro enable row level security;

-- Solo lectura directa; las escrituras pasan por las funciones de abajo. El revoke va primero porque el entorno
-- local otorga privilegios por defecto a anon/authenticated en tablas nuevas (prod no): así queda igual en ambos.
revoke all on public.deuda_notas_cobro from anon, authenticated;
grant select on public.deuda_notas_cobro to authenticated;

create policy deuda_notas_cobro_select on public.deuda_notas_cobro
  for select to authenticated
  using (public.rol_actual() in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA'));

-- 3) La cajera/encargada (o la admin) anota un cobro. No toca la deuda.
create or replace function public.crear_nota_cobro_deuda(
  p_deuda_id uuid,
  p_monto    numeric,
  p_fecha    date,
  p_nota     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    text := public.rol_actual();
  v_monto  numeric(10,2);
  v_pagado numeric(10,2);
  v_id     uuid;
begin
  if v_rol is null or v_rol not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'No tienes permiso para anotar cobros.' using errcode = '42501';
  end if;

  select monto into v_monto from public.deudas where id = p_deuda_id;
  if not found then
    raise exception 'La deuda no existe.' using errcode = 'P0001';
  end if;
  select coalesce(sum(monto), 0) into v_pagado from public.deuda_pagos where deuda_id = p_deuda_id;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if p_monto > v_monto - v_pagado then
    raise exception 'El monto supera lo que debe la clienta (S/ %).', v_monto - v_pagado using errcode = 'P0001';
  end if;
  if p_fecha is null then
    raise exception 'Indica la fecha del pago.' using errcode = 'P0001';
  end if;

  insert into public.deuda_notas_cobro (deuda_id, monto, fecha, nota, creado_por, creado_por_nombre)
  values (p_deuda_id, p_monto, p_fecha, nullif(btrim(p_nota), ''), auth.uid(),
          (select coalesce(nullif(btrim(nombre_completo), ''), email) from public.usuarios where id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- 4) La admin confirma: registra el pago (monto que ella verificó, total o parcial) y la nota queda CONFIRMADA.
create or replace function public.confirmar_nota_cobro_deuda(
  p_nota_id uuid,
  p_monto   numeric,
  p_fecha   date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nota   public.deuda_notas_cobro%rowtype;
  v_monto  numeric(10,2);
  v_pagado numeric(10,2);
  v_pago   uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede confirmar cobros.' using errcode = '42501';
  end if;

  select * into v_nota from public.deuda_notas_cobro where id = p_nota_id for update;
  if not found then
    raise exception 'La nota de cobro no existe.' using errcode = 'P0001';
  end if;
  if v_nota.estado <> 'PENDIENTE' then
    raise exception 'Esta nota de cobro ya fue revisada.' using errcode = 'P0001';
  end if;

  select monto into v_monto from public.deudas where id = v_nota.deuda_id for update;
  select coalesce(sum(monto), 0) into v_pagado from public.deuda_pagos where deuda_id = v_nota.deuda_id;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.' using errcode = 'P0001';
  end if;
  if p_monto > v_monto - v_pagado then
    raise exception 'El pago supera el saldo pendiente (S/ %).', v_monto - v_pagado using errcode = 'P0001';
  end if;
  if p_fecha is null then
    raise exception 'Indica la fecha del pago.' using errcode = 'P0001';
  end if;

  insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_por)
  values (v_nota.deuda_id, p_monto, p_fecha,
          concat_ws(' · ', 'Nota de cobro de ' || coalesce(v_nota.creado_por_nombre, 'personal'), v_nota.nota),
          auth.uid())
  returning id into v_pago;

  -- La nota se marca ANTES de recalcular: si este pago cubre el saldo, el trigger descarta las OTRAS pendientes y esta
  -- ya figura como confirmada.
  update public.deuda_notas_cobro
     set estado = 'CONFIRMADA', revisado_por = auth.uid(), revisado_en = now(),
         monto_confirmado = p_monto, pago_id = v_pago
   where id = p_nota_id;

  perform public.recalcular_estado_deuda(v_nota.deuda_id);
end;
$$;

-- 4b) Si la deuda pasa a COBRADA por cualquier vía (la admin usó «Cobrado»/«Pago parcial» directo, otra nota cubrió el
-- saldo, o el cobro heredado de deudas_compat), sus notas aún pendientes quedan DESCARTADAS: ya no hay saldo que
-- confirmar y no deben seguir apareciendo como «por confirmar». Security definer porque quien cobra (la admin vía las
-- RPC security invoker) no tiene UPDATE directo sobre deuda_notas_cobro.
create or replace function public.descartar_notas_cobro_al_cobrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.deuda_notas_cobro
     set estado = 'DESCARTADA', revisado_por = auth.uid(), revisado_en = now()
   where deuda_id = new.id and estado = 'PENDIENTE';
  return null;
end;
$$;

revoke execute on function public.descartar_notas_cobro_al_cobrar() from public, anon, authenticated;

create trigger deudas_descartar_notas_cobro
  after update of estado on public.deudas
  for each row
  when (new.estado = 'COBRADA' and old.estado is distinct from 'COBRADA')
  execute function public.descartar_notas_cobro_al_cobrar();

-- 5) La admin rechaza la nota (no se registra ningún pago).
create or replace function public.rechazar_nota_cobro_deuda(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede rechazar cobros.' using errcode = '42501';
  end if;
  update public.deuda_notas_cobro
     set estado = 'RECHAZADA', revisado_por = auth.uid(), revisado_en = now()
   where id = p_nota_id and estado = 'PENDIENTE';
  if not found then
    raise exception 'La nota de cobro no existe o ya fue revisada.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.crear_nota_cobro_deuda(uuid, numeric, date, text) from public, anon;
revoke execute on function public.confirmar_nota_cobro_deuda(uuid, numeric, date) from public, anon;
revoke execute on function public.rechazar_nota_cobro_deuda(uuid) from public, anon;
grant execute on function public.crear_nota_cobro_deuda(uuid, numeric, date, text) to authenticated;
grant execute on function public.confirmar_nota_cobro_deuda(uuid, numeric, date) to authenticated;
grant execute on function public.rechazar_nota_cobro_deuda(uuid) to authenticated;

commit;
