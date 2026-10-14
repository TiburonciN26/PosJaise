-- =========================================================
-- BORRADOR · propuesta F10A-05 (revisión V1 de la Fase 10A). NO es una migración: no está en supabase/migrations/, no se
-- aplicó en ningún entorno y solo se ensaya dentro de una transacción que se revierte (scripts/fase10a/ensayar-compat-deudas.mjs).
-- Si el usuario lo aprueba, se convertiría en una migración que se aplica EN EL MISMO LOTE que 20261010000001 (deuda_pagos),
-- antes de que convivan el frontend de `main` y el nuevo.
--
-- Problema: tras 20261010000001, el estado de una deuda se DERIVA de sus pagos (recalcular_estado_deuda), pero el frontend de
-- `main` (y sus PWA instaladas) sigue escribiendo `estado` directamente (Deudas.jsx::alternarCobrada) y edita `monto` sin
-- recalcular (ModalDeuda.jsx). Sin compatibilidad:
--   · un cobro desde `main` deja una deuda COBRADA sin pagos; guardar luego SOLO una nota en la UI nueva llama a
--     recalcular_estado_deuda, suma 0 y la REABRE como PENDIENTE por el importe completo (con botones de cobro);
--   · una reapertura desde `main` de una deuda con pagos (p. ej. los del relleno) la deja PENDIENTE con saldo 0.
--
-- Mecanismo: el invariante «COBRADA ⇔ pagos ≥ monto (con algún pago)» se mantiene en la BASE para cualquier escritor:
--   1. La UI nueva nunca escribe `estado` directamente (solo las RPC, cuyo recálculo deja el estado coherente con los pagos).
--      Por eso un UPDATE que CAMBIA `estado` hacia un valor incoherente con los pagos solo puede venir del frontend anterior.
--   2. Cobro heredado (PENDIENTE → COBRADA con saldo > 0): se acepta y se registra un pago por el SALDO (respeta abonos
--      parciales previos), fechado con el `cobrado_en` que envía `main` en hora de Lima. Ya no hay COBRADAS sin pagos.
--   3. Reapertura heredada de una deuda pagada (COBRADA → PENDIENTE con pagos ≥ monto): se RECHAZA con un error explícito; no se
--      borran pagos en silencio. `main` muestra «No se pudo actualizar la deuda.»; la reapertura se hace en la UI nueva anulando
--      el pago (anular_pago_deuda). Mientras convivan, esa es la única operación que `main` pierde.
--   4. Edición de monto (cualquier UI, estado sin cambiar): el estado se recalcula con los pagos, como hace la RPC.
--   5. Alta de una deuda ya COBRADA (no la hace ninguna UI): mismo trato que el cobro heredado.
-- Cierre verificable: al final del lote, cero deudas incoherentes (consulta de §invariante); si hubiera alguna, el lote aborta.
-- =========================================================

create or replace function public.deudas_compat_antes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pagado numeric(10,2);
begin
  select coalesce(sum(monto), 0) into v_pagado from public.deuda_pagos where deuda_id = new.id;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    -- (3) reapertura heredada de una deuda pagada: se rechaza, los pagos se conservan.
    if new.estado = 'PENDIENTE' and v_pagado > 0 and v_pagado >= new.monto then
      raise exception 'La deuda tiene pagos registrados por el total; para reabrirla, anula el pago en la versión actual.'
        using errcode = 'P0001';
    end if;
    -- (2) cobro heredado con saldo: se acepta; el pago del saldo lo registra deudas_compat_despues.
    if new.estado = 'COBRADA' and new.cobrado_en is null then
      new.cobrado_en := now();
    end if;
    if new.estado = 'PENDIENTE' then
      new.cobrado_en := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- (4) estado sin cambiar (edición de concepto, nota, fecha o monto desde cualquier UI): se deriva de los pagos.
    if v_pagado > 0 and v_pagado >= new.monto then
      if new.estado <> 'COBRADA' then
        new.estado := 'COBRADA';
        new.cobrado_en := (select max(creado_en) from public.deuda_pagos where deuda_id = new.id);
      end if;
    elsif new.estado = 'COBRADA' and v_pagado > 0 then
      new.estado := 'PENDIENTE';
      new.cobrado_en := null;
    end if;
    return new;
  end if;

  -- INSERT: (5) una deuda que nace COBRADA recibe su pago en deudas_compat_despues.
  if new.estado = 'COBRADA' and new.cobrado_en is null then
    new.cobrado_en := now();
  end if;
  return new;
end;
$$;

create or replace function public.deudas_compat_despues()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pagado numeric(10,2);
begin
  if new.estado <> 'COBRADA' or (tg_op = 'UPDATE' and old.estado = 'COBRADA') then
    return null;
  end if;
  select coalesce(sum(monto), 0) into v_pagado from public.deuda_pagos where deuda_id = new.id;
  if v_pagado < new.monto then
    insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_por, creado_en)
    values (new.id, new.monto - v_pagado, (new.cobrado_en at time zone 'America/Lima')::date,
            'Cobro registrado desde la versión anterior del sistema', auth.uid(), new.cobrado_en);
  end if;
  return null;
end;
$$;

revoke execute on function public.deudas_compat_antes() from public;
revoke execute on function public.deudas_compat_despues() from public;

create trigger deudas_compat_antes
  before insert or update on public.deudas
  for each row execute function public.deudas_compat_antes();

create trigger deudas_compat_despues
  after insert or update on public.deudas
  for each row execute function public.deudas_compat_despues();

-- Relleno DIRIGIDO de cierre (idempotente): solo deudas COBRADAS cuyos pagos no cubren el monto, por el saldo exacto.
-- A diferencia del bloque de relleno de 20261010000001 (un pago por CADA COBRADA, lo tenga o no), ejecutarlo dos veces no
-- duplica nada.
insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_en)
select d.id, d.monto - coalesce(p.pagado, 0), (coalesce(d.cobrado_en, d.creado_en) at time zone 'America/Lima')::date,
       'Conciliación de cobro anterior', coalesce(d.cobrado_en, d.creado_en)
  from public.deudas d
  left join (select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id) p on p.deuda_id = d.id
 where d.estado = 'COBRADA' and coalesce(p.pagado, 0) < d.monto;

-- §invariante: condición de cierre. Si queda una deuda incoherente, el lote entero se revierte.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.deudas d
    left join (select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id) p on p.deuda_id = d.id
   where (d.estado = 'COBRADA' and coalesce(p.pagado, 0) < d.monto)
      or (d.estado = 'PENDIENTE' and coalesce(p.pagado, 0) > 0 and coalesce(p.pagado, 0) >= d.monto);
  if v_n > 0 then
    raise exception 'Quedan % deudas con estado incoherente con sus pagos', v_n;
  end if;
end;
$$;
