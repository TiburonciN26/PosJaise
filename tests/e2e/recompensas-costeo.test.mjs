// Comisión REAL de la asistente (migración 20261124000001), costeo detallado (20261124000002), reporte de rentabilidad
// (20261124000003) y tope de cupón PAREJO por servicio (20261124000005). Capa SQL, solo Supabase Local TEST; datos ficticios "TEST F2".
//
//   node --test --test-concurrency=1 tests/e2e/recompensas-costeo.test.mjs
//
// Reglas confirmadas por la dueña (2026-11-24): a la asistente se le paga su comisión sobre el PRECIO REAL del servicio; una promoción
// o un cupón del salón NO la reduce. El tope del cupón, en cambio, es PAREJO por servicio (se calcula con el % más alto entre las
// asistentes activas) para que dos clientas con el mismo servicio tengan el mismo tope sin importar quién las atendió; el costo REAL de
// cada venta (comisión de quien atendió) se guarda aparte ('asistente_real' / 'total_real') y es lo que mide el reporte de rentabilidad.
// Esta suite exige la rama `testing` y una base solo con cuentas @test.local (ver tests/e2e/README.md); no usa HTTP ni UI.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

const MSG_GLOBAL = /Este cupón supera el descuento permitido para esta compra\. Puedes utilizarlo en otra compra\./;
let cfg0;
before(async () => {
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  await h.activar(true); // el arnés lo restaura al terminar (Recompensas queda como estaba: apagado)
});
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const casi = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 1e-9, `${msg ?? ''} esperado ${b}, obtenido ${a}`);
const cupon = (c, o) => h.nuevoCupon(c.clienteId, o);
const lineas = (arr) => `$j$${JSON.stringify(arr)}$j$::jsonb`;
const protDeVenta = (ventaId) =>
  h.json(`select to_json(proteccion) from public.recompensas_venta_detalle where venta_id='${ventaId}' and tipo='SERVICIO' limit 1`);

describe('Comisión real de la asistente en el piso del cupón', () => {
  test('atiende una asistente al 40 %: piso = materiales + comisión real + otros; el cupón no baja su pago', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(100, { materiales: 10, otros: 5 });
    const at = await h.nuevaAtencionConComision(c.clienteId, serv, 100, 40);
    // piso 10 + 40 + 5 = 55 → máximo 45
    const no = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 45.01 })).codigo });
    assert.equal(no.ok, false);
    assert.match(no.err, MSG_GLOBAL);
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 45 })).codigo });
    assert.ok(ok.ok, ok.err);
    casi(ok.venta.total, 55);
    const prot = await protDeVenta(ok.venta.venta_id);
    assert.equal(prot.modo, 'COMISION_MAX'); // el piso del cupón usa el % más alto (aquí la única asistente, 40 %)
    casi(prot.asistente, 40);
    casi(prot.total, 55);
    assert.equal(prot.modo_real, 'COMISION_REAL'); // …y la foto guarda aparte lo que realmente se paga
    casi(prot.asistente_real, 40);
    casi(prot.total_real, 55);
    // La comisión sigue siendo la del precio REAL (40 sobre 100), no la del precio con descuento (40 % de 55 = 22).
    casi(await h.json(`select to_json(pago_asistente) from public.registro_servicios where id='${at}'`), 40);
  });

  test('atiende la dueña (ADMINISTRADOR al 100 %): no hay pago en efectivo, la mano de obra protege 0', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(100, { materiales: 10, otros: 5 });
    const at = await h.nuevaAtencion(c.clienteId, serv, 100);
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 85 })).codigo });
    assert.ok(ok.ok, ok.err);
    const prot = await protDeVenta(ok.venta.venta_id);
    // Atendió la dueña: su costo REAL de mano de obra es 0 (lo que mide la rentabilidad)…
    assert.equal(prot.modo_real, 'DUENA');
    casi(prot.asistente_real, 0);
    casi(prot.total_real, 15);
    // …y como ninguna asistente tiene % en este servicio el piso del cupón no tiene mano de obra que proteger
    casi(prot.total, 15);
    const c2 = await h.nuevaClienta();
    const at2 = await h.nuevaAtencion(c2.clienteId, serv, 100);
    assert.equal((await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(at2)], cupon: (await cupon(c2, { valor: 85.01 })).codigo })).ok, false);
  });

  test('TOPE PAREJO: dos clientas con el mismo servicio tienen el mismo tope, atienda la asistente al 40 % o la dueña', async () => {
    const serv = await h.nuevoServicio(100, { materiales: 10, otros: 5 });
    const c1 = await h.nuevaClienta();
    const atAsistente = await h.nuevaAtencionConComision(c1.clienteId, serv, 100, 40); // deja el % de la asistente en 40
    const c2 = await h.nuevaClienta();
    const atDuena = await h.nuevaAtencion(c2.clienteId, serv, 100);
    // Piso = 10 + 5 + 40 (el % más alto) = 55 → tope 45 para AMBAS; 45,01 se rechaza para ambas
    for (const [c, at] of [[c1, atAsistente], [c2, atDuena]]) {
      const no = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 45.01 })).codigo });
      assert.equal(no.ok, false);
      assert.match(no.err, MSG_GLOBAL);
    }
    const c3 = await h.nuevaClienta();
    const at3 = await h.nuevaAtencion(c3.clienteId, serv, 100);
    const ok = await h.vender({ clienteId: c3.clienteId, items: [h.itemServicio(at3)], cupon: (await cupon(c3, { valor: 45 })).codigo });
    assert.ok(ok.ok, ok.err);
    // La venta de la dueña conserva SU costo real (15) aunque el piso del cupón haya sido 55: así la rentabilidad no se distorsiona
    const prot = await protDeVenta(ok.venta.venta_id);
    casi(prot.total, 55);
    casi(prot.total_real, 15);
    assert.equal(prot.modo_real, 'DUENA');
  });

  test('sin atención conocida (catálogo): se usa el % MÁS ALTO entre las asistentes activas con porcentaje (caso conservador)', async () => {
    const serv = await h.nuevoServicio(100, { materiales: 10, otros: 5 });
    await h.admin(`insert into public.porcentajes (servicio_id, asistente_id, porcentaje)
      select '${serv}', a.id, 55 from public.asistentes a where a.usuario_id = '${h.ASISTENTE}';`);
    assert.equal(await h.json(`select to_json(public.recompensas_proteccion_servicio('${serv}', 100)->>'modo')`), 'COMISION_MAX');
    casi(await h.json(`select to_json((public.recompensas_proteccion_servicio('${serv}', 100)->>'total')::numeric)`), 70);
  });

  test('servicio sin configurar: el respaldo del 50 % no cambia aunque se conozca la comisión', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(100);
    const at = await h.nuevaAtencionConComision(c.clienteId, serv, 100, 10);
    assert.equal(await h.json(`select to_json(public.recompensas_proteccion_servicio('${serv}', 100, '${at}')->>'modo')`), 'RESPALDO_50');
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 50 })).codigo });
    assert.ok(ok.ok, ok.err);
  });
});

describe('Costeo detallado por líneas (solo ADMINISTRADOR)', () => {
  test('guardar_costeo_servicio: totales hacia arriba al centavo, LOCAL informativo, reemplazo y quitar', async () => {
    const serv = await h.nuevoServicio(100);
    const r = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([
      { categoria: 'INSUMO', descripcion: 'Gel constructor', cantidad: 0.05, costo_unitario: 80 },
      { categoria: 'DESCARTABLE', descripcion: 'Guantes', cantidad: 2, costo_unitario: 0.35 },
      { categoria: 'TARJETA_POS', descripcion: 'Comisión POS', cantidad: 1, costo_unitario: 1.5 },
      { categoria: 'LOCAL', descripcion: 'Uso del local 60 min', cantidad: 60, costo_unitario: 0.12 },
    ])});`, { rol: true });
    assert.ok(r.ok, r.err);
    const fila = await h.json(`select to_json(sp) from public.servicios_proteccion sp where servicio_id='${serv}'`);
    casi(fila.materiales, 4.7);
    casi(fila.otros, 1.5);
    const desglose = await h.json(`select to_json(public.recompensas_proteccion_servicio('${serv}', 100, null)->'desglose')`);
    casi(desglose.LOCAL, 7.2); // informativo: no suma al piso
    casi(await h.json(`select to_json((public.recompensas_proteccion_servicio('${serv}', 100, null)->>'total')::numeric)`), 6.2);
    // Reemplazo con redondeo hacia arriba: 3 x 0,333 = 0,999 → 1,00
    const r2 = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Algodón', cantidad: 3, costo_unitario: 0.333 }])});`, { rol: true });
    assert.ok(r2.ok, r2.err);
    casi(await h.json(`select to_json(materiales) from public.servicios_proteccion where servicio_id='${serv}'`), 1);
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_costos_detalle where servicio_id='${serv}'`), 1);
    const q = await h.paso(h.ADMIN, `select public.quitar_costeo_servicio('${serv}');`, { rol: true });
    assert.ok(q.ok, q.err);
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_proteccion where servicio_id='${serv}'`), 0);
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_costos_detalle where servicio_id='${serv}'`), 0);
  });

  test('validaciones: categoría, cantidad, descripción y costo; un error no deja líneas a medias', async () => {
    const serv = await h.nuevoServicio(100);
    await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Gel', cantidad: 1, costo_unitario: 2 }])});`, { rol: true });
    for (const mala of [
      [{ categoria: 'XX', descripcion: 'a', cantidad: 1, costo_unitario: 1 }],
      [{ categoria: 'INSUMO', descripcion: 'a', cantidad: -1, costo_unitario: 1 }],
      [{ categoria: 'INSUMO', descripcion: '', cantidad: 1, costo_unitario: 1 }],
      [{ categoria: 'INSUMO', descripcion: 'a', cantidad: 1, costo_unitario: -1 }],
    ]) {
      const r = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas(mala)});`, { rol: true });
      assert.equal(r.ok, false, JSON.stringify(mala));
    }
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_costos_detalle where servicio_id='${serv}'`), 1, 'la línea guardada sigue intacta');
  });

  test('guardar_costeo_producto: transporte aparte, empaque y comisión suman a otros; protege por unidad', async () => {
    const prod = await h.nuevoProducto(50, 10, { costo: 20 });
    const r = await h.paso(h.ADMIN, `select public.guardar_costeo_producto('${prod}', ${lineas([
      { categoria: 'TRANSPORTE', descripcion: 'Flete', monto: 3 },
      { categoria: 'EMPAQUE', descripcion: 'Bolsa de regalo', monto: 0.5 },
      { categoria: 'TARJETA_POS', descripcion: 'Comisión', monto: 1.2 },
    ])}, false);`, { rol: true });
    assert.ok(r.ok, r.err);
    const pp = await h.json(`select to_json(pp) from public.productos_proteccion pp where producto_id='${prod}'`);
    casi(pp.transporte, 3);
    casi(pp.otros, 1.7);
    casi(await h.json(`select to_json((public.recompensas_proteccion_producto('${prod}', 2)->>'total')::numeric)`), 2 * (20 + 3 + 1.7));
  });

  test('CAJERA, ASISTENTE y CLIENTA no leen ni guardan costeo, ni ven los costos del almacén ni la rentabilidad', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(100);
    const prod = await h.nuevoProducto(40, 10, { costo: 12 });
    for (const [rol, uid] of [['CAJERA', h.CAJERA], ['ASISTENTE', h.ASISTENTE], ['CLIENTA', c.uid]]) {
      for (const t of ['servicios_costos_detalle', 'productos_costos_detalle']) {
        const r = await h.paso(uid, `select count(*) from public.${t};`, { rol: true });
        assert.equal(r.out, '0', `${rol} no ve ${t}`);
      }
      assert.equal((await h.paso(uid, `select public.guardar_costeo_servicio('${serv}', '[]'::jsonb);`, { rol: true })).ok, false, `${rol} no guarda costeo de servicios`);
      assert.equal((await h.paso(uid, `select public.guardar_costeo_producto('${prod}', '[]'::jsonb, false);`, { rol: true })).ok, false, `${rol} no guarda costeo de productos`);
      assert.equal((await h.paso(uid, `select count(*) from public.almacen_costos_sugeridos();`, { rol: true })).out, '0', `${rol} no ve costos del almacén`);
      assert.equal((await h.paso(uid, `select public.recompensas_rentabilidad(current_date, current_date);`, { rol: true })).ok, false, `${rol} no ve la rentabilidad`);
    }
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_proteccion where servicio_id='${serv}'`), 0, 'nada se escribió');
  });
});

describe('Rentabilidad: margen con la comisión real y la foto del costo de cada venta', () => {
  test('una venta con cupón: cobrado neto − (materiales + otros + comisión real) = margen; la venta conserva su desglose', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(100);
    const g = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([
      { categoria: 'INSUMO', descripcion: 'Gel', cantidad: 1, costo_unitario: 10 },
      { categoria: 'OTRO', descripcion: 'Otro', cantidad: 1, costo_unitario: 5 },
    ])});`, { rol: true });
    assert.ok(g.ok, g.err);
    const at = await h.nuevaAtencionConComision(c.clienteId, serv, 100, 40);
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 30 })).codigo });
    assert.ok(ok.ok, ok.err);
    // Cambiar la receta DESPUÉS no reescribe el historial: la venta conserva la foto de su momento.
    await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Gel', cantidad: 1, costo_unitario: 99 }])});`, { rol: true });
    const prot = await protDeVenta(ok.venta.venta_id);
    casi(prot.materiales, 10);
    casi(prot.otros, 5);
    casi(prot.asistente, 40);
    casi(prot.total, 55);
    casi(prot.total_real, 55);
    // El reporte (solo administradora) calcula con esa foto: cobrado neto 70, costo 55, margen 15 para esta venta.
    const rep = await h.paso(h.ADMIN, `select public.recompensas_rentabilidad(current_date, current_date);`, { rol: true });
    assert.ok(rep.ok, rep.err);
    const j = JSON.parse(rep.out.split('\n').pop());
    assert.ok(j.margen.lineas_con_costo >= 1, 'hay líneas con costo conocido');
    assert.ok(Number(j.ventas.descuentos) >= 30, 'el descuento del cupón entra en el periodo');
    const unaLinea = await h.json(`select to_json(d) from public.recompensas_venta_detalle d where venta_id='${ok.venta.venta_id}'`);
    casi(unaLinea.neto, 70);
  });
});

describe('Costeo: costo de compra y usos (migración 20261124000004)', () => {
  test('la base calcula el costo por uso: frasco de S/ 10 que rinde 100 usos = S/ 0,10; rinde vacío = 1 uso; se redondea a 4 decimales', async () => {
    const serv = await h.nuevoServicio(10);
    const r = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([
      { categoria: 'INSUMO', descripcion: 'Alcohol 70', cantidad: 1, unidad: 'uso', costo_compra: 10, rinde: 100 },
      { categoria: 'DESCARTABLE', descripcion: 'Lima', cantidad: 1, costo_compra: 2, rinde: 8 },
    ])});`, { rol: true });
    assert.ok(r.ok, r.err);
    const filas = await h.json(`select json_agg(json_build_object('d', descripcion, 'por_uso', costo_unitario, 'compra', costo_compra, 'rinde', rinde) order by orden)
      from public.servicios_costos_detalle where servicio_id='${serv}'`);
    casi(filas[0].por_uso, 0.1);
    casi(filas[1].por_uso, 0.25);
    casi(await h.json(`select to_json(materiales) from public.servicios_proteccion where servicio_id='${serv}'`), 0.35);
    // rinde vacío = 1 uso (el mismo costo de antes); 11 ÷ 3 = 3,6667 por uso y el total sube al centavo (3,67)
    await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Pegamento', cantidad: 1, costo_compra: 3 }])});`, { rol: true });
    casi(await h.json(`select to_json(rinde) from public.servicios_costos_detalle where servicio_id='${serv}'`), 1);
    await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Tres', cantidad: 1, costo_compra: 11, rinde: 3 }])});`, { rol: true });
    casi(await h.json(`select to_json(costo_unitario) from public.servicios_costos_detalle where servicio_id='${serv}'`), 3.6667);
    casi(await h.json(`select to_json(materiales) from public.servicios_proteccion where servicio_id='${serv}'`), 3.67);
  });

  test('compatibilidad: una línea solo con costo_unitario (como antes) sigue aceptándose; sin costo de compra no se admite «rinde»', async () => {
    const serv = await h.nuevoServicio(10);
    const ok = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas([{ categoria: 'INSUMO', descripcion: 'Antigua', cantidad: 2, costo_unitario: 0.5 }])});`, { rol: true });
    assert.ok(ok.ok, ok.err);
    assert.equal(await h.json(`select to_json(costo_compra is null and rinde is null) from public.servicios_costos_detalle where servicio_id='${serv}'`), true);
    for (const mala of [
      [{ categoria: 'INSUMO', descripcion: 'x', cantidad: 1, rinde: 5 }],
      [{ categoria: 'INSUMO', descripcion: 'x', cantidad: 1, costo_compra: 5, rinde: 0 }],
      [{ categoria: 'INSUMO', descripcion: 'x', cantidad: 1, costo_compra: -1, rinde: 5 }],
    ]) {
      const r = await h.paso(h.ADMIN, `select public.guardar_costeo_servicio('${serv}', ${lineas(mala)});`, { rol: true });
      assert.equal(r.ok, false, JSON.stringify(mala));
    }
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_costos_detalle where servicio_id='${serv}'`), 1, 'la línea buena sigue intacta');
  });
});
