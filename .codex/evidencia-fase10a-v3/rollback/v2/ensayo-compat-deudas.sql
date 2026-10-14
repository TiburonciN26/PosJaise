-- Ensayo de la propuesta F10A-05 en Supabase LOCAL, TODO dentro de una transacción que termina en ROLLBACK (no queda nada).
-- Lo ejecuta scripts/fase10a/ensayar-compat-deudas.mjs, que inyecta :'admin_id' (administradora QA ficticia) y :'cliente_id'
-- (una clienta existente, solo como referencia de las deudas de prueba) y comprueba los conteos antes y después.
-- Cada caso emite «RESULTADO|<caso>|<ok>|<detalle>» como NOTICE; los escritores se simulan con las MISMAS sentencias que usan:
--   · `main`  (frontend anterior): Deudas.jsx::alternarCobrada  → update deudas set estado, cobrado_en
--                                   ModalDeuda.jsx (edición)     → update deudas set cliente_id, concepto, monto, fecha, nota
--   · actual  (frontend nuevo):    ModalDeuda.jsx (edición)     → el mismo update + rpc recalcular_estado_deuda
--                                   cobros/anulaciones           → rpc registrar_pago_deuda / anular_pago_deuda
-- como rol `authenticated` con los claims de la administradora (RLS y GRANT reales).
\set ON_ERROR_STOP on
begin;
select set_config('ensayo.admin', :'admin_id', true), set_config('ensayo.cliente', :'cliente_id', true);

create function pg_temp.como_admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('ensayo.admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.resultado(p_caso text, p_ok boolean, p_detalle text) returns void language plpgsql as $$
begin raise notice 'RESULTADO|%|%|%', p_caso, case when p_ok then 'ok' else 'FALLA' end, p_detalle; end $$;
create function pg_temp.nueva_deuda(p_concepto text, p_monto numeric) returns uuid language sql as $$
  insert into public.deudas (cliente_id, concepto, monto, fecha, creado_por)
  values (current_setting('ensayo.cliente')::uuid, 'TEST QA F10A-05 ' || p_concepto, p_monto, current_date, current_setting('ensayo.admin')::uuid)
  returning id $$;
create function pg_temp.estado(p_id uuid) returns text language sql as $$
  select d.estado || ' pagado=' || coalesce((select sum(monto) from public.deuda_pagos where deuda_id = d.id), 0) || ' monto=' || d.monto
    || ' pagos=' || (select count(*) from public.deuda_pagos where deuda_id = d.id) from public.deudas d where d.id = p_id $$;
create function pg_temp.incoherentes() returns int language sql as $$
  select count(*)::int from public.deudas d
    left join (select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id) p on p.deuda_id = d.id
   where (d.estado = 'COBRADA' and coalesce(p.pagado, 0) < d.monto)
      or (d.estado = 'PENDIENTE' and coalesce(p.pagado, 0) > 0 and coalesce(p.pagado, 0) >= d.monto) $$;

-- ======================= ANTES: sin compatibilidad (reproduce F10A-05) =======================
select pg_temp.como_admin();
do $$
declare v uuid; e text;
begin
  -- A1: cobro desde `main` y luego SOLO una nota en la UI nueva → la deuda se reabre por el total.
  v := pg_temp.nueva_deuda('A1', 100);
  update public.deudas set estado = 'COBRADA', cobrado_en = now() where id = v;                       -- main: alternarCobrada
  update public.deudas set concepto = concepto, monto = 100, nota = 'solo una nota' where id = v;     -- actual: ModalDeuda
  perform public.recalcular_estado_deuda(v);
  e := pg_temp.estado(v);
  perform pg_temp.resultado('antes-A1 cobro en main + nota en la UI nueva reabre la deuda (defecto reproducido)', e like 'PENDIENTE pagado=0%', e);
  -- A2: deuda pagada (pago como el del relleno) y reapertura desde `main` → PENDIENTE con saldo 0.
  v := pg_temp.nueva_deuda('A2', 80);
  perform public.registrar_pago_deuda(v, 80, current_date, null);
  update public.deudas set estado = 'PENDIENTE', cobrado_en = null where id = v;                      -- main: alternarCobrada
  e := pg_temp.estado(v);
  perform pg_temp.resultado('antes-A2 reapertura en main de una deuda pagada deja PENDIENTE con saldo 0 (defecto reproducido)', e like 'PENDIENTE pagado=80.00%', e);
  delete from public.deudas where concepto like 'TEST QA F10A-05 A%';                                -- el borrador exige invariante limpio
end $$;

-- ======================= Se instala el BORRADOR (como postgres, igual que una migración) =======================
reset role;
-- @@BORRADOR@@ (el ejecutor inserta aquí compat-deudas-borrador.sql; `\i` no ve archivos fuera del contenedor)
select pg_temp.resultado('instalacion: borrador aplicado; relleno dirigido e invariante de cierre sin incoherencias', pg_temp.incoherentes() = 0, 'incoherentes=' || pg_temp.incoherentes());

-- ======================= DESPUÉS: cada escritor con el mecanismo =======================
select pg_temp.como_admin();
do $$
declare v uuid; e text; err text;
begin
  -- S1: el caso de Codex con compatibilidad: el cobro de main registra el pago y la nota posterior ya no reabre.
  v := pg_temp.nueva_deuda('S1', 100);
  update public.deudas set estado = 'COBRADA', cobrado_en = now() where id = v;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S1a cobro en main registra un pago por el total', e = 'COBRADA pagado=100.00 monto=100.00 pagos=1', e);
  update public.deudas set concepto = concepto, monto = 100, nota = 'solo una nota' where id = v;
  perform public.recalcular_estado_deuda(v);
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S1b guardar solo una nota en la UI nueva NO reabre la deuda', e = 'COBRADA pagado=100.00 monto=100.00 pagos=1', e);
  perform pg_temp.resultado('S1c el pago heredado lleva fecha de Lima, nota y autora',
    exists (select 1 from public.deuda_pagos where deuda_id = v and fecha = (now() at time zone 'America/Lima')::date
            and nota like 'Cobro registrado desde la versión anterior%' and creado_por = current_setting('ensayo.admin')::uuid), '');

  -- S2: abono parcial en la UI nueva y cobro en main → el pago heredado es solo el SALDO.
  v := pg_temp.nueva_deuda('S2', 100);
  perform public.registrar_pago_deuda(v, 30, current_date, 'abono');
  update public.deudas set estado = 'COBRADA', cobrado_en = now() where id = v;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S2 abono de 30 + cobro en main → pago heredado de 70 (sin duplicar)', e = 'COBRADA pagado=100.00 monto=100.00 pagos=2', e);

  -- S3: reapertura desde main de una deuda pagada → rechazada, pagos intactos.
  v := pg_temp.nueva_deuda('S3', 80);
  perform public.registrar_pago_deuda(v, 80, current_date, null);
  begin
    update public.deudas set estado = 'PENDIENTE', cobrado_en = null where id = v;
    err := 'no se rechazó';
  exception when others then err := sqlerrm;
  end;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S3 reapertura en main de una deuda pagada se RECHAZA y conserva sus pagos', err like 'La deuda tiene pagos registrados%' and e = 'COBRADA pagado=80.00 monto=80.00 pagos=1', err || ' · ' || e);

  -- S4: la reapertura correcta en la UI nueva (anular el pago) sigue funcionando; después main puede volver a cobrar.
  perform public.anular_pago_deuda((select id from public.deuda_pagos where deuda_id = v));
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S4a anular el pago en la UI nueva la reabre', e = 'PENDIENTE pagado=0 monto=80.00 pagos=0', e);
  update public.deudas set estado = 'COBRADA', cobrado_en = now() where id = v;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S4b main vuelve a cobrarla con su pago', e = 'COBRADA pagado=80.00 monto=80.00 pagos=1', e);

  -- S5: main sube el monto de una cobrada (sin recalcular) → queda PENDIENTE por la diferencia; main la cobra → pago del saldo.
  v := pg_temp.nueva_deuda('S5', 100);
  perform public.registrar_pago_deuda(v, 100, current_date, null);
  update public.deudas set concepto = concepto, monto = 150, nota = null where id = v;                -- main: ModalDeuda
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S5a main sube el monto de una cobrada → PENDIENTE por la diferencia', e = 'PENDIENTE pagado=100.00 monto=150.00 pagos=1', e);
  update public.deudas set estado = 'COBRADA', cobrado_en = now() where id = v;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S5b main la cobra → pago heredado de 50', e = 'COBRADA pagado=150.00 monto=150.00 pagos=2', e);

  -- S6: main BAJA el monto de una deuda con abono hasta cubrirlo → COBRADA sin pago nuevo.
  v := pg_temp.nueva_deuda('S6', 100);
  perform public.registrar_pago_deuda(v, 60, current_date, null);
  update public.deudas set concepto = concepto, monto = 60, nota = null where id = v;
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S6 main baja el monto hasta lo pagado → COBRADA sin pago nuevo', e = 'COBRADA pagado=60.00 monto=60.00 pagos=1', e);

  -- S7: flujo normal de la UI nueva sin cambios: abono parcial, resto, anulación.
  v := pg_temp.nueva_deuda('S7', 90);
  perform public.registrar_pago_deuda(v, 40, current_date, null);
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S7a UI nueva: abono parcial → PENDIENTE', e = 'PENDIENTE pagado=40.00 monto=90.00 pagos=1', e);
  perform public.registrar_pago_deuda(v, 50, current_date, null);
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S7b UI nueva: resto → COBRADA', e = 'COBRADA pagado=90.00 monto=90.00 pagos=2', e);
  perform public.anular_pago_deuda((select id from public.deuda_pagos where deuda_id = v and monto = 50));
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S7c UI nueva: anular un pago → PENDIENTE', e = 'PENDIENTE pagado=40.00 monto=90.00 pagos=1', e);

  -- S8: main desmarca una deuda pendiente con abono parcial (ya estaba PENDIENTE: no cambia nada) y la UI nueva edita la nota.
  update public.deudas set estado = 'PENDIENTE', cobrado_en = null where id = v;
  update public.deudas set concepto = concepto, monto = 90, nota = 'nota' where id = v;
  perform public.recalcular_estado_deuda(v);
  e := pg_temp.estado(v);
  perform pg_temp.resultado('S8 ediciones sin cambio de estado conservan el abono y el saldo', e = 'PENDIENTE pagado=40.00 monto=90.00 pagos=1', e);

  perform pg_temp.resultado('S9 invariante tras todos los escritores: cero deudas incoherentes', pg_temp.incoherentes() = 0, 'incoherentes=' || pg_temp.incoherentes());
end $$;

-- ======================= Relleno: dirigido (idempotente) frente al bloque original =======================
reset role;
alter table public.deudas disable trigger deudas_compat_antes;
alter table public.deudas disable trigger deudas_compat_despues;
insert into public.deudas (cliente_id, concepto, monto, fecha, estado, cobrado_en, creado_por)
values (current_setting('ensayo.cliente')::uuid, 'TEST QA F10A-05 R1', 70, current_date, 'COBRADA', now() - interval '2 days', current_setting('ensayo.admin')::uuid);
alter table public.deudas enable trigger deudas_compat_antes;
alter table public.deudas enable trigger deudas_compat_despues;
do $$
declare v uuid := (select id from public.deudas where concepto = 'TEST QA F10A-05 R1'); n1 int; n2 int; n3 int;
begin
  perform pg_temp.resultado('R0 una COBRADA sin pagos anterior al mecanismo rompe el invariante', pg_temp.incoherentes() = 1, 'incoherentes=' || pg_temp.incoherentes());
  insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_en)
  select d.id, d.monto - coalesce(p.pagado, 0), (coalesce(d.cobrado_en, d.creado_en) at time zone 'America/Lima')::date, 'Conciliación de cobro anterior', coalesce(d.cobrado_en, d.creado_en)
    from public.deudas d left join (select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id) p on p.deuda_id = d.id
   where d.estado = 'COBRADA' and coalesce(p.pagado, 0) < d.monto;
  get diagnostics n1 = row_count;
  insert into public.deuda_pagos (deuda_id, monto, fecha, nota, creado_en)
  select d.id, d.monto - coalesce(p.pagado, 0), (coalesce(d.cobrado_en, d.creado_en) at time zone 'America/Lima')::date, 'Conciliación de cobro anterior', coalesce(d.cobrado_en, d.creado_en)
    from public.deudas d left join (select deuda_id, sum(monto) as pagado from public.deuda_pagos group by deuda_id) p on p.deuda_id = d.id
   where d.estado = 'COBRADA' and coalesce(p.pagado, 0) < d.monto;
  get diagnostics n2 = row_count;
  perform pg_temp.resultado('R1 el relleno dirigido inserta 1 pago y repetido inserta 0 (idempotente); invariante limpio', n1 = 1 and n2 = 0 and pg_temp.incoherentes() = 0, format('primera=%s segunda=%s', n1, n2));
  -- Bloque de relleno ORIGINAL de 20261010000001 ejecutado otra vez (aislado): duplica el pago de cada COBRADA.
  insert into public.deuda_pagos (deuda_id, monto, fecha, creado_en)
  select id, monto, (coalesce(cobrado_en, creado_en) at time zone 'America/Lima')::date, coalesce(cobrado_en, creado_en)
    from public.deudas where estado = 'COBRADA' and id = v;
  get diagnostics n3 = row_count;
  perform pg_temp.resultado('R2 el bloque de relleno original repetido SÍ duplica (por eso nunca se re-ejecuta aislado)', n3 = 1 and (select sum(monto) from public.deuda_pagos where deuda_id = v) = 140, pg_temp.estado(v));
end $$;

rollback;
