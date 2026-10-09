-- =========================================================
-- Deudas: pagos parciales (abonos) con fecha y monto
--
-- Antes una deuda solo tenía PENDIENTE/COBRADA y "cobrado_en". Ahora cada
-- cobro (total o parcial) es una fila en deuda_pagos; el saldo es
-- monto - sum(pagos). La deuda pasa a COBRADA (con cobrado_en = momento del
-- último pago) cuando el saldo llega a 0, y vuelve a PENDIENTE si se anula
-- un pago o se edita el monto. "monto" de deudas sigue siendo el original.
-- Las funciones son SECURITY INVOKER: RLS (solo admin) sigue aplicando.
-- =========================================================

begin;

create table public.deuda_pagos (
  id          uuid primary key default gen_random_uuid(),
  deuda_id    uuid not null references public.deudas (id) on delete cascade,
  monto       numeric(10,2) not null check (monto > 0),
  fecha       date not null,
  nota        text,
  creado_por  uuid references public.usuarios (id) on delete set null,
  creado_en   timestamptz not null default now()
);

create index idx_deuda_pagos_deuda_id on public.deuda_pagos (deuda_id);

alter table public.deuda_pagos enable row level security;

-- Grants explícitos: authenticated no recibe permisos por defecto (además de RLS).
grant select, insert, update, delete on public.deuda_pagos to authenticated;

create policy deuda_pagos_select on public.deuda_pagos
  for select to authenticated using (public.es_admin());
create policy deuda_pagos_insert on public.deuda_pagos
  for insert to authenticated with check (public.es_admin());
create policy deuda_pagos_update on public.deuda_pagos
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy deuda_pagos_delete on public.deuda_pagos
  for delete to authenticated using (public.es_admin());

-- Recalcula estado/cobrado_en de una deuda a partir de sus pagos.
create or replace function public.recalcular_estado_deuda(p_deuda_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_monto  numeric(10,2);
  v_pagado numeric(10,2);
begin
  select monto into v_monto from public.deudas where id = p_deuda_id for update;
  if not found then
    raise exception 'La deuda no existe.';
  end if;

  select coalesce(sum(monto), 0) into v_pagado
    from public.deuda_pagos where deuda_id = p_deuda_id;

  if v_pagado >= v_monto then
    update public.deudas
       set estado = 'COBRADA',
           cobrado_en = coalesce(
             (select max(creado_en) from public.deuda_pagos where deuda_id = p_deuda_id),
             now())
     where id = p_deuda_id;
  else
    update public.deudas
       set estado = 'PENDIENTE', cobrado_en = null
     where id = p_deuda_id;
  end if;
end;
$$;

create or replace function public.registrar_pago_deuda(
  p_deuda_id uuid,
  p_monto    numeric,
  p_fecha    date,
  p_nota     text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_monto  numeric(10,2);
  v_pagado numeric(10,2);
begin
  select monto into v_monto from public.deudas where id = p_deuda_id for update;
  if not found then
    raise exception 'La deuda no existe.';
  end if;

  select coalesce(sum(monto), 0) into v_pagado
    from public.deuda_pagos where deuda_id = p_deuda_id;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.';
  end if;
  if p_monto > v_monto - v_pagado then
    raise exception 'El pago supera el saldo pendiente.';
  end if;

  insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_por)
  values (p_deuda_id, p_monto, p_fecha, nullif(trim(p_nota), ''), auth.uid());

  perform public.recalcular_estado_deuda(p_deuda_id);
end;
$$;

create or replace function public.anular_pago_deuda(p_pago_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deuda_id uuid;
begin
  delete from public.deuda_pagos where id = p_pago_id returning deuda_id into v_deuda_id;
  if v_deuda_id is null then
    raise exception 'El pago no existe.';
  end if;
  perform public.recalcular_estado_deuda(v_deuda_id);
end;
$$;

revoke execute on function public.recalcular_estado_deuda(uuid) from public;
revoke execute on function public.registrar_pago_deuda(uuid, numeric, date, text) from public;
revoke execute on function public.anular_pago_deuda(uuid) from public;
grant execute on function public.recalcular_estado_deuda(uuid) to authenticated;
grant execute on function public.registrar_pago_deuda(uuid, numeric, date, text) to authenticated;
grant execute on function public.anular_pago_deuda(uuid) to authenticated;

-- Las deudas ya cobradas se registran como un pago total en la fecha en que
-- se cobraron (hora de Lima), para que su saldo calce con el nuevo modelo.
insert into public.deuda_pagos (deuda_id, monto, fecha, creado_en)
select id, monto, (coalesce(cobrado_en, creado_en) at time zone 'America/Lima')::date,
       coalesce(cobrado_en, creado_en)
  from public.deudas
 where estado = 'COBRADA';

commit;
