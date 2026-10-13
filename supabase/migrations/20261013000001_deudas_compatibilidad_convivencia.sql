-- =========================================================
-- Deudas: compatibilidad con el frontend anterior durante la convivencia (Fase 10, F10A-05/05b, decisión D11-A)
--
-- Tras 20261010000001 el estado de una deuda se DERIVA de sus pagos (deuda_pagos + recalcular_estado_deuda), pero el frontend
-- de `main` (GitHub Pages y sus PWA instaladas) sigue escribiendo `estado` directamente (Deudas.jsx::alternarCobrada) y edita
-- `monto` sin recalcular (ModalDeuda.jsx). Sin esta migración, mientras convivan las dos versiones:
--   · un cobro desde `main` deja una deuda COBRADA sin pagos, y guardar luego solo una nota en la UI nueva la REABRE por el total;
--   · una reapertura desde `main` de una deuda con pagos la deja PENDIENTE con saldo 0;
--   · una edición de monto en `main` descuadra el estado.
--
-- Contrato (invariante «COBRADA ⇔ pagos ≥ monto, con algún pago», mantenido en la BASE para cualquier escritor):
--   · La UI nueva nunca escribe `estado` directamente (solo las RPC, cuyo recálculo es coherente con los pagos). Un UPDATE que
--     cambia `estado` a un valor incoherente con los pagos solo puede venir del frontend anterior.
--   · Contrato del IMPORTE: `main` no lee deuda_pagos; muestra y cobra siempre `monto`, y su cobro no envía importe.
--       - Cobro desde `main` de una deuda SIN pagos: se acepta y se registra UN pago por el monto completo (el importe visible).
--       - Cobro desde `main` de una deuda con pagos que no la cubren: se RECHAZA sin registrar nada (`main` muestra «No se pudo
--         actualizar la deuda.»); el cobro se hace en la UI nueva, que muestra el saldo.
--   · Reapertura desde `main` de una deuda pagada: se RECHAZA; los pagos no se borran (se anulan en la UI nueva).
--   · Edición de monto/nota/fecha desde cualquier UI: el estado se recalcula con los pagos.
--   · Regla operativa D11-A (decisión del usuario, 2026-10-13): «Las deudas con abonos se consultan y cobran únicamente en la
--     versión nueva». La base no puede corregir lo que `main` MUESTRA (monto original, total sin descontar abonos).
--
-- INSTALACIÓN ATÓMICA: en un entorno que todavía no tenga 20261010000001, ambas se aplican en UNA sola transacción
-- (scripts/fase10b/lote-deudas.sql), de modo que nunca exista deuda_pagos sin esta compatibilidad. El lote termina con un
-- relleno DIRIGIDO e idempotente y una comprobación del invariante que lo revierte entero si queda alguna deuda incoherente.
--
-- Ensayo: .codex/propuesta-f10a-05/ensayo-compat-deudas.sql (26/26 en Local dentro de un ROLLBACK, revisión V3 de Codex).
-- Reversión (solo si no hay operaciones en curso): drop trigger deudas_compat_antes on public.deudas;
--   drop trigger deudas_compat_despues on public.deudas; drop function public.deudas_compat_antes();
--   drop function public.deudas_compat_despues(); — no borra pagos (los registrados por cobros heredados son pagos reales).
-- Retirada: cuando `main` y sus PWA ya no se usen, puede retirarse igual; mientras tanto no estorba a la UI nueva.
-- =========================================================

begin;

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
    -- (2b) cobro heredado de una deuda con pagos previos que no la cubren: `main` muestra el monto, no el saldo → se rechaza, sin
    -- registrar nada. (Con pagos ≥ monto el cambio es coherente: es el recálculo de las RPC de la UI nueva, y se acepta.)
    if new.estado = 'COBRADA' and v_pagado > 0 and v_pagado < new.monto then
      raise exception 'La deuda tiene abonos registrados (S/ % de S/ %); cóbrala en la versión actual, que muestra el saldo.',
        v_pagado, new.monto using errcode = 'P0001';
    end if;
    -- (2a) cobro heredado sin pagos: se acepta; el pago por el monto completo lo registra deudas_compat_despues.
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

  -- INSERT: (5) una deuda que nace COBRADA (aún sin pagos) recibe su pago en deudas_compat_despues.
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
  -- Solo se llega aquí sin pagos previos (2a y 5; el caso con pagos se rechazó antes): el pago es el monto completo, el mismo
  -- importe que mostraba `main`.
  select coalesce(sum(monto), 0) into v_pagado from public.deuda_pagos where deuda_id = new.id;
  if v_pagado = 0 then
    insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_por, creado_en)
    values (new.id, new.monto, (new.cobrado_en at time zone 'America/Lima')::date,
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

commit;
