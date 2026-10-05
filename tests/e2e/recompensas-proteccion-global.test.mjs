// Protección económica de cupones: REGLA GLOBAL del carrito (capa SQL, solo Supabase Local TEST; datos ficticios "TEST F2").
//
//   node --test --test-concurrency=1 tests/e2e/recompensas-proteccion-global.test.mjs
//
// Regla aprobada: subtotal (productos + servicios, SIN envío) - descuento del cupón >= suma de las protecciones.
//  * servicios: materiales + precio efectivo de la atención x % protegido de asistente / 100 + otros
//    (o el importe fijo antiguo mientras la fila no se actualice; o el respaldo del 50 % si no hay configuración);
//  * productos: (costo de compra de productos.costo + transporte + otros) x cantidad; costo desconocido => cupón bloqueado.
// Las ventas sin cupón y el descuento manual no cambian. Esta capa no usa HTTP/UI (pendientes: ver el informe).
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

async function servicioConAtencion(c, precioCatalogo, prot, precioAtencion = precioCatalogo) {
  const serv = await h.nuevoServicio(precioCatalogo, prot);
  const at = await h.nuevaAtencion(c.clienteId, serv, precioAtencion);
  return { serv, at };
}

// Huella de todo lo que un rechazo NO debe tocar.
async function huella(c, { productos = [], atenciones = [], cupones = [] } = {}) {
  const l = (xs) => (xs.length ? xs.map((x) => `'${x}'`).join(',') : "'00000000-0000-0000-0000-000000000000'");
  return h.json(`select jsonb_build_object(
    'ventas', (select count(*) from public.ventas where cliente_id='${c.clienteId}'),
    'items', (select count(*) from public.venta_items vi join public.ventas v on v.id=vi.venta_id where v.cliente_id='${c.clienteId}'),
    'stock', (select coalesce(sum(stock_actual),0) from public.productos where id in (${l(productos)})),
    'atenciones', (select count(*) from public.registro_servicios where id in (${l(atenciones)}) and venta_id is not null),
    'cupones', (select coalesce(string_agg(estado||coalesce(venta_id::text,''), ',' order by id),'') from public.cupones where id in (${l(cupones)})),
    'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${c.clienteId}'),
    'sellos', (select count(*) from public.recompensas_sellos_movs where cliente_id='${c.clienteId}'),
    'detalle', (select count(*) from public.recompensas_venta_detalle d join public.ventas v on v.id=d.venta_id where v.cliente_id='${c.clienteId}'),
    'proteccion_venta', (select count(*) from public.recompensas_venta_proteccion p join public.ventas v on v.id=p.venta_id where v.cliente_id='${c.clienteId}')
  );`);
}

describe('Solo producto: costo + transporte + otros', () => {
  test('producto S50, costo S20 y extras S5: cupón S25 permitido; S25,01 rechazado', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 20, transporte: 3, otros: 2 });
    const ok = await cupon(c, { valor: 25 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: ok.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 25);
    const sobra = await cupon(c, { valor: 25.01 });
    const antes = await huella(c, { productos: [p], cupones: [sobra.id] });
    const r2 = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: sobra.codigo });
    assert.equal(r2.ok, false);
    assert.match(r2.err, MSG_GLOBAL);
    assert.deepEqual(await huella(c, { productos: [p], cupones: [sobra.id] }), antes, 'rechazo sin ningún cambio');
    assert.equal((await h.estadoCupon(sobra.id)).estado, 'DISPONIBLE');
  });

  test('sin extras configurados se protege igualmente el costo de compra registrado', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 20 });
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 30 })).codigo })).ok);
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 30.01 })).codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, MSG_GLOBAL);
  });

  test('no se suman reserva, diezmo ni gastos generales: solo costo + transporte + otros configurados', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(100, 10, { costo: 40 });
    // Si se sumara un 10 % de reserva (S10) el máximo sería S50; debe ser S60.
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 60 })).codigo });
    assert.ok(r.ok, r.err);
  });

  test('varias unidades multiplican la protección: 3 x (4 + 1 + 0,50) = 16,50 sobre S30 → máximo S13,50', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(10, 10, { costo: 4, transporte: 1, otros: 0.5 });
    const ok = await cupon(c, { valor: 13.5 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p, 3)], cupon: ok.codigo });
    assert.ok(r.ok, r.err);
    assert.equal(await h.stock(p), 7);
    const sobra = await cupon(c, { valor: 13.51 });
    const r2 = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p, 3)], cupon: sobra.codigo });
    assert.equal(r2.ok, false);
    assert.match(r2.err, MSG_GLOBAL);
    assert.equal(await h.stock(p), 7, 'el rechazo no descuenta stock');
    // una unidad: 5,50 sobre S10 → máximo S4,50
    const uno = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p, 1)], cupon: (await cupon(c, { valor: 4.5 })).codigo });
    assert.ok(uno.ok, uno.err);
    const uno2 = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p, 1)], cupon: (await cupon(c, { valor: 4.51 })).codigo });
    assert.equal(uno2.ok, false);
  });
});

describe('Carrito mixto del ejemplo aprobado', () => {
  // Subtotal S100: servicio S60 con protección S25 y producto S40 con protección S15 → protección total S40, máximo S60.
  async function carrito(c) {
    const { at } = await servicioConAtencion(c, 60, { materiales: 25, asistentePct: 0 });
    const p = await h.nuevoProducto(40, 10, { costo: 15 });
    return { at, p, items: [h.itemServicio(at), h.itemProducto(p)] };
  }

  test('cupón S20 permitido (cobro S80), S60 permitido (cobro S40) y S60,01 rechazado', async () => {
    for (const [valor, total] of [[20, 80], [60, 40]]) {
      const c = await h.nuevaClienta();
      const k = await carrito(c);
      const r = await h.vender({ clienteId: c.clienteId, items: k.items, cupon: (await cupon(c, { valor })).codigo });
      assert.ok(r.ok, r.err);
      casi(r.venta.total, total);
    }
    const c = await h.nuevaClienta();
    const k = await carrito(c);
    const sobra = await cupon(c, { valor: 60.01 });
    const antes = await huella(c, { productos: [k.p], atenciones: [k.at], cupones: [sobra.id] });
    const r = await h.vender({ clienteId: c.clienteId, items: k.items, cupon: sobra.codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, MSG_GLOBAL);
    assert.deepEqual(await huella(c, { productos: [k.p], atenciones: [k.at], cupones: [sobra.id] }), antes);
  });

  test('queda registrada la protección usada: por partida (detalle) y por venta (subtotal, descuento, protección, máximo)', async () => {
    const c = await h.nuevaClienta();
    const k = await carrito(c);
    const r = await h.vender({ clienteId: c.clienteId, items: k.items, cupon: (await cupon(c, { valor: 20 })).codigo });
    assert.ok(r.ok, r.err);
    const v = await h.json(`select to_json(p) from public.recompensas_venta_proteccion p where venta_id='${r.venta.venta_id}'`);
    casi(v.subtotal, 100); casi(v.descuento, 20); casi(v.proteccion_total, 40); casi(v.descuento_maximo, 60);
    const det = await h.json(`select jsonb_agg(proteccion order by linea) from public.recompensas_venta_detalle where venta_id='${r.venta.venta_id}'`);
    assert.equal(det[0].modo, 'PORCENTAJE');
    casi(det[0].total, 25);
    assert.equal(det[1].costo_conocido, true);
    casi(det[1].total, 15);
  });

  test('el envío cobrado a la clienta no entra en el subtotal: producto S50 costo S20 + envío S15 → máximo S30', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 20 });
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 30 })).codigo, delivery: 15 });
    assert.ok(ok.ok, ok.err);
    casi(ok.venta.total, 35, '20 + 15 de envío');
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 30.01 })).codigo, delivery: 15 });
    assert.equal(r.ok, false, 'el envío no amplía el descuento permitido');
    assert.match(r.err, MSG_GLOBAL);
  });
});

describe('La protección es global: una partida puede quedar bajo su protección individual', () => {
  test('servicio S30 (protección S25) + producto S70 (costo S10): cupón S50 da S15 al servicio y se permite', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 30, { materiales: 25 });
    const p = await h.nuevoProducto(70, 10, { costo: 10 });
    const items = [h.itemServicio(at), h.itemProducto(p)];
    const r = await h.vender({ clienteId: c.clienteId, items, cupon: (await cupon(c, { valor: 50 })).codigo });
    assert.ok(r.ok, r.err);
    const det = await h.json(`select jsonb_agg(d order by linea) from public.recompensas_venta_detalle d where venta_id='${r.venta.venta_id}'`);
    assert.ok(Number(det[0].neto) < 25, `el servicio quedó bajo su piso individual (neto ${det[0].neto})`);
    // y el máximo global es S65 (100 - 35): S65,01 se rechaza
    const c2 = await h.nuevaClienta();
    const s2 = await servicioConAtencion(c2, 30, { materiales: 25 });
    const p2 = await h.nuevoProducto(70, 10, { costo: 10 });
    const r2 = await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(s2.at), h.itemProducto(p2)], cupon: (await cupon(c2, { valor: 65.01 })).codigo });
    assert.equal(r2.ok, false);
    assert.match(r2.err, MSG_GLOBAL);
  });

  test('monedas por partida sobre el neto (reparto proporcional conservado)', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 60, { materiales: 25, asistentePct: 0 });
    const p = await h.nuevoProducto(40, 10, { costo: 15 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p)], cupon: (await cupon(c, { valor: 20 })).codigo });
    assert.ok(r.ok, r.err);
    const det = await h.json(`select jsonb_agg(d order by linea) from public.recompensas_venta_detalle d where venta_id='${r.venta.venta_id}'`);
    casi(det[0].descuento, 12); casi(det[1].descuento, 8);
    casi(det[0].neto, 48); casi(det[1].neto, 32);
    casi((await h.saldos(c.clienteId)).monedas, 48 * 5 / 20 + 32 * 5 / 40, 'S48 de servicio + S32 de producto');
  });
});

describe('Alcances y tipos de cupón', () => {
  test('PRODUCTOS, SERVICIOS y TODO: el alcance limita la base y la protección sigue siendo del carrito completo', async () => {
    // servicio S30 (materiales 5, 0 %) y producto S50 costo 48 → protección 53, subtotal 80, descuento máximo 27.
    const armar = async () => {
      const c = await h.nuevaClienta();
      const { at } = await servicioConAtencion(c, 30, { materiales: 5, asistentePct: 0 });
      const p = await h.nuevoProducto(50, 10, { costo: 48 });
      return { c, items: [h.itemServicio(at), h.itemProducto(p)] };
    };
    for (const [alcance, valor, esperado] of [
      ['PRODUCTOS', 27, true], ['PRODUCTOS', 27.01, false],
      ['SERVICIOS', 27, true], ['SERVICIOS', 28, false],   // 28 <= 30 (base del servicio) pero > 27: lo para la protección global
      ['TODO', 27, true], ['TODO', 27.01, false],
    ]) {
      const { c, items } = await armar();
      const cup = await cupon(c, { valor, alcance });
      const r = await h.vender({ clienteId: c.clienteId, items, cupon: cup.codigo });
      assert.equal(r.ok, esperado, `${alcance} S${valor}: ${r.err ?? 'ok'}`);
      if (!esperado) {
        assert.match(r.err, MSG_GLOBAL, `${alcance} S${valor}`);
        assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
      }
    }
  });

  test('porcentaje con tope: aplica el tope y luego la protección global (sin recortar)', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(100, 10, { costo: 70 }); // máximo S30
    // 50 % con tope 20 → S20 (permitido)
    const a = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 50, tipo: 'PORCENTAJE', tope: 20 })).codigo });
    assert.ok(a.ok, a.err);
    casi(a.venta.total, 80);
    // 50 % con tope 40 → S40 > S30: se rechaza completo (no se recorta a S30)
    const sobra = await cupon(c, { valor: 50, tipo: 'PORCENTAJE', tope: 40 });
    const b = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: sobra.codigo });
    assert.equal(b.ok, false);
    assert.match(b.err, MSG_GLOBAL);
    assert.equal((await h.estadoCupon(sobra.id)).estado, 'DISPONIBLE');
  });

  test('premio de servicio: cubre el precio menos la protección efectiva y respeta la protección de los demás productos', async () => {
    // servicio S50 con 45 % → protección 22,50 → premio S27,50
    const c = await h.nuevaClienta();
    const { serv, at } = await servicioConAtencion(c, 50, { asistentePct: 45 });
    const premio = await cupon(c, { tipo: 'SERVICIO', valor: 0, servicioId: serv });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: premio.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 22.5);
    // con un producto S20 de costo S18 (protección total 40,50 sobre subtotal 70 → máximo 29,50): premio 27,50 permitido
    const c2 = await h.nuevaClienta();
    const s2 = await servicioConAtencion(c2, 50, { asistentePct: 45 });
    const p2 = await h.nuevoProducto(20, 10, { costo: 18 });
    const ok = await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(s2.at), h.itemProducto(p2)], cupon: (await cupon(c2, { tipo: 'SERVICIO', valor: 0, servicioId: s2.serv })).codigo });
    assert.ok(ok.ok, ok.err);
    // con producto de costo S25 (> su precio S20): protección 47,50 → máximo 22,50 < 27,50 → el premio se rechaza
    const c3 = await h.nuevaClienta();
    const s3 = await servicioConAtencion(c3, 50, { asistentePct: 45 });
    const p3 = await h.nuevoProducto(20, 10, { costo: 25 });
    const prem3 = await cupon(c3, { tipo: 'SERVICIO', valor: 0, servicioId: s3.serv });
    const no = await h.vender({ clienteId: c3.clienteId, items: [h.itemServicio(s3.at), h.itemProducto(p3)], cupon: prem3.codigo });
    assert.equal(no.ok, false);
    assert.match(no.err, MSG_GLOBAL);
    assert.equal((await h.estadoCupon(prem3.id)).estado, 'DISPONIBLE');
  });
});

describe('Servicios: porcentaje protegido de asistente', () => {
  test('precio variable: se usa el precio REGISTRADO en la atención (catálogo S50, atención S80, 45 % → protección S36)', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 50, { asistentePct: 45 }, 80);
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 44 })).codigo });
    assert.ok(ok.ok, ok.err);
    casi(ok.venta.total, 36);
    const c2 = await h.nuevaClienta();
    const s2 = await servicioConAtencion(c2, 50, { asistentePct: 45 }, 80);
    const r = await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(s2.at)], cupon: (await cupon(c2, { valor: 44.01 })).codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, MSG_GLOBAL);
  });

  test('porcentaje 0 (explícito), 45 y 100', async () => {
    const caso = async (pct, valor, esperado) => {
      const c = await h.nuevaClienta();
      const { at } = await servicioConAtencion(c, 40, { materiales: 4, asistentePct: pct });
      const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor })).codigo });
      assert.equal(r.ok, esperado, `pct ${pct} cupón S${valor}: ${r.err ?? 'ok'}`);
    };
    await caso(0, 36, true);      // protección 4 → máximo 36
    await caso(0, 36.01, false);
    await caso(45, 18, true);     // 4 + 18 = 22 → máximo 18
    await caso(45, 18.01, false);
    await caso(100, 0.01, false); // 4 + 40 = 44 > precio: ningún cupón
  });

  test('redondeo conservador al centavo: S33,33 al 45 % = 14,9985 → 15,00 (máximo S18,33)', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 33.33, { asistentePct: 45 });
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: (await cupon(c, { valor: 18.33 })).codigo });
    assert.ok(ok.ok, ok.err);
    const c2 = await h.nuevaClienta();
    const s2 = await servicioConAtencion(c2, 33.33, { asistentePct: 45 });
    assert.equal((await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(s2.at)], cupon: (await cupon(c2, { valor: 18.34 })).codigo })).ok, false);
  });

  test('entradas inválidas se rechazan en la base (CHECK 0-100), también desde ADMINISTRADOR con sesión', async () => {
    const serv = await h.nuevoServicio(40);
    for (const v of ['101', '-1', '100.01']) {
      const r = await h.paso(h.ADMIN, `insert into public.servicios_proteccion (servicio_id, asistente_pct) values ('${serv}', ${v});`, { rol: true });
      assert.equal(r.ok, false, `pct ${v} debe rechazarse`);
      assert.match(r.err, /asistente_pct|check/i);
    }
    const no = await h.paso(h.ADMIN, `insert into public.servicios_proteccion (servicio_id, asistente_pct) values ('${serv}', 'abc');`, { rol: true });
    assert.equal(no.ok, false);
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_proteccion where servicio_id='${serv}'`), 0, 'nada se escribió');
  });

  test('configuración ANTIGUA (importe fijo): se conserva su importe; ausente: respaldo del 50 %; cero explícito: protege 0', async () => {
    // antigua: materiales 5 + asistente 5 (S/) sobre S30 → protección 10 → máximo 20; pct nulo = pendiente de actualizar
    const c = await h.nuevaClienta();
    const vieja = await servicioConAtencion(c, 30, { materiales: 5, asistente: 5 });
    assert.equal(await h.json(`select to_json(asistente_pct is null) from public.servicios_proteccion where servicio_id='${vieja.serv}'`), true);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(vieja.at)], cupon: (await cupon(c, { valor: 20 })).codigo })).ok);
    const v2 = await servicioConAtencion(c, 30, { materiales: 5, asistente: 5 });
    assert.equal((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(v2.at)], cupon: (await cupon(c, { valor: 20.01 })).codigo })).ok, false);
    // el importe antiguo NO se convierte en porcentaje (S/5 sobre S30 no es 5 %): al actualizar a 45 % sí cambia
    await h.admin(`update public.servicios_proteccion set asistente_pct = 45 where servicio_id='${v2.serv}';`);
    const v3 = await h.nuevaAtencion(c.clienteId, v2.serv, 30);
    // protección 5 + 13,50 = 18,50 → máximo 11,50
    assert.equal((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(v3)], cupon: (await cupon(c, { valor: 11.51 })).codigo })).ok, false);
    assert.equal(await h.json(`select to_json(asistente) from public.servicios_proteccion where servicio_id='${v2.serv}'`), 5, 'el importe antiguo se conserva');
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(v3)], cupon: (await cupon(c, { valor: 11.5 })).codigo })).ok);
    // ausente: 50 % (S10 → máximo 5), incluso en la suma global
    const aus = await servicioConAtencion(c, 10);
    assert.equal((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(aus.at)], cupon: (await cupon(c, { valor: 5.01 })).codigo })).ok, false);
    const aus2 = await servicioConAtencion(c, 10);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(aus2.at)], cupon: (await cupon(c, { valor: 5 })).codigo })).ok);
    // cero explícito: fila con todo en 0 → el servicio admite cobro 0
    const cero = await servicioConAtencion(c, 10, { materiales: 0, asistentePct: 0, otros: 0 });
    const rc = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(cero.at)], cupon: (await cupon(c, { valor: 10 })).codigo });
    assert.ok(rc.ok, rc.err);
    casi(rc.venta.total, 0);
  });

  test('servicio sin configurar dentro de un carrito: conserva el límite del 50 % por partida y aporta su mínimo a la suma', async () => {
    const c = await h.nuevaClienta();
    const sin = await servicioConAtencion(c, 40);                        // respaldo: protege 20
    const p = await h.nuevoProducto(60, 10, { costo: 10 });               // protege 10; subtotal 100 → máximo global 70
    // S45 cumple el global (100 - 45 >= 30) pero el reparto da S18 al servicio (< 20) → permitido
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(sin.at), h.itemProducto(p)], cupon: (await cupon(c, { valor: 45 })).codigo });
    assert.ok(ok.ok, ok.err);
    // S60 cumple el global pero el reparto da S24 al servicio sin configurar (> 20): límite por partida
    const c2 = await h.nuevaClienta();
    const s2 = await servicioConAtencion(c2, 40);
    const p2 = await h.nuevoProducto(60, 10, { costo: 10 });
    const r = await h.vender({ clienteId: c2.clienteId, items: [h.itemServicio(s2.at), h.itemProducto(p2)], cupon: (await cupon(c2, { valor: 60 })).codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /sin protección configurada.*50 %/);
  });
});

describe('Costo de compra desconocido y descuentos manuales', () => {
  test('costo 0 sin confirmar = DESCONOCIDO: el cupón se bloquea (no se inventa un cero); la venta sin cupón sigue permitida', async () => {
    const c = await h.nuevaClienta();
    const raw = '00000000-0000-4000-8000-0000000000aa';
    // producto con costo 0 y SIN confirmar (insert directo: el helper confirma los costos 0 por omisión)
    const id = (await h.json(`with p as (insert into public.productos (nombre, precio, costo, stock_actual)
        values ('TEST F2 prod sin costo ${h.runId}-${Math.random().toString(36).slice(2, 6)}', 40, 0, 10) returning id) select to_json(id) from p`));
    assert.ok(id && raw);
    const cup = await cupon(c, { valor: 1 });
    const antes = await huella(c, { productos: [id], cupones: [cup.id] });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(id)], cupon: cup.codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /falta registrar el costo de compra/);
    assert.match(r.err, /Pide a un administrador/);
    assert.deepEqual(await huella(c, { productos: [id], cupones: [cup.id] }), antes);
    // sin cupón: permitido; con descuento manual: permitido (no cambia)
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(id)] })).ok);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(id)], pct: 90 })).ok);
    // el administrador confirma el costo (cero explícito) → el cupón ya se acepta y protege S0
    await h.admin(`insert into public.productos_proteccion (producto_id, costo_confirmado) values ('${id}', true);`);
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(id)], cupon: cup.codigo });
    assert.ok(ok.ok, ok.err);
    casi(ok.venta.total, 39);
  });

  test('un producto desconocido bloquea el cupón de todo el carrito aunque el cupón solo aplique a servicios', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 40, { materiales: 0, asistentePct: 0 });
    const id = await h.json(`with p as (insert into public.productos (nombre, precio, costo, stock_actual)
        values ('TEST F2 prod sin costo ${h.runId}-${Math.random().toString(36).slice(2, 6)}', 40, 0, 10) returning id) select to_json(id) from p`);
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(id)], cupon: (await cupon(c, { valor: 5, alcance: 'SERVICIOS' })).codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /falta registrar el costo de compra/);
  });

  test('el descuento manual conserva su comportamiento (piso del servicio configurado; productos sin protección)', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 30, { materiales: 5, asistente: 5 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], pct: 80 });
    assert.equal(r.ok, false);
    assert.match(r.err, /cobro mínimo/);
    const p = await h.nuevoProducto(50, 10, { costo: 45 });
    const ok = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], pct: 90 });
    assert.ok(ok.ok, 'el descuento manual no se ve limitado por la protección de productos');
    casi(ok.venta.total, 5);
  });
});

describe('Rechazo atómico, anulación y combinaciones', () => {
  test('rechazo sin cambios: venta, ítems, stock, cupón, atención, detalle y libros intactos (carrito mixto)', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 60, { materiales: 25, asistentePct: 0 });
    const p = await h.nuevoProducto(40, 5, { costo: 15 });
    // subtotal 60 + 2 x 40 = 140; protección 25 + 2 x 15 = 55 → máximo S85
    const cup = await cupon(c, { valor: 85.01 });
    const antes = await huella(c, { productos: [p], atenciones: [at], cupones: [cup.id] });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p, 2)], cupon: cup.codigo });
    assert.equal(r.ok, false);
    assert.deepEqual(await huella(c, { productos: [p], atenciones: [at], cupones: [cup.id] }), antes);
    assert.equal(await h.stock(p), 5);
  });

  test('anulación: revierte una sola vez; la segunda no duplica efectos y el cupón vuelve a estar disponible', async () => {
    const c = await h.nuevaClienta();
    const { at } = await servicioConAtencion(c, 60, { materiales: 25, asistentePct: 0 });
    const p = await h.nuevoProducto(40, 5, { costo: 15 });
    const cup = await cupon(c, { valor: 20 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p)], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    const id = r.venta.venta_id;
    assert.ok((await h.anular(id)).ok);
    const tras1 = await h.json(`select jsonb_build_object(
      'rev', (select count(*) from public.recompensas_movimientos where venta_id='${id}' and tipo='VENTA_REVERSION'),
      'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${c.clienteId}'),
      'stock', (select stock_actual from public.productos where id='${p}'),
      'cupon', (select estado from public.cupones where id='${cup.id}'))`);
    assert.equal(tras1.rev, 1);
    assert.equal(tras1.stock, 5);
    assert.equal(tras1.cupon, 'DISPONIBLE');
    casi((await h.saldos(c.clienteId)).monedas, 0);
    const segunda = await h.anular(id);
    assert.equal(segunda.ok, false, 'la segunda anulación se rechaza');
    const tras2 = await h.json(`select jsonb_build_object(
      'rev', (select count(*) from public.recompensas_movimientos where venta_id='${id}' and tipo='VENTA_REVERSION'),
      'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${c.clienteId}'),
      'stock', (select stock_actual from public.productos where id='${p}'),
      'cupon', (select estado from public.cupones where id='${cup.id}'))`);
    assert.deepEqual(tras2, tras1, 'nada cambió con la segunda anulación');
    // el mismo cupón se puede reutilizar en otra compra que respete la protección
    const p2 = await h.nuevoProducto(40, 5, { costo: 15 });
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p2)], cupon: cup.codigo })).ok);
  });

  test('no se pueden combinar cupón y descuento manual (restricción existente intacta)', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 5 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 5 })).codigo, pct: 10 });
    assert.equal(r.ok, false);
    assert.match(r.err, /No puedes combinar un cupón con otro descuento/);
  });
});

describe('Pedido web (verificar_pago_pedido_web → confirmar_venta)', () => {
  async function pedido(c, p, cantidad, codigo) {
    const r = await h.json(`with pw as (
        insert into public.pedidos_web (cliente_id, tipo_entrega, subtotal, total, fecha_entrega, hora_entrega, metodo_pago, comprobante_url, cupon_codigo, costo_delivery)
        values ('${c.clienteId}', 'RECOJO_TIENDA', 1, 1, (now() at time zone 'America/Lima')::date + 1, '10:00', 'YAPE', 'x', '${codigo}', 0) returning id),
      it as (insert into public.pedidos_web_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
        select id, '${p}', 'TEST F2', ${cantidad}, 1, ${cantidad} from pw returning 1)
      select to_json(id) from pw`);
    return r;
  }
  const verificar = (id) => h.paso(h.ADMIN, `select public.verificar_pago_pedido_web('${id}');`, { rol: true });

  test('pedido con cupón dentro del límite: se vende, monedas por neto; fuera del límite: se rechaza sin cambios', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 20 });
    const bueno = await cupon(c, { valor: 30 }); // producto S50, costo S20 → máximo S30
    const pid = await pedido(c, p, 1, bueno.codigo);
    const ok = await verificar(pid);
    assert.ok(ok.ok, ok.err);
    const v = await h.json(`select to_json(v) from (select ventas.total, ventas.cupon_id is not null as con_cupon from public.pedidos_web pw join public.ventas on ventas.id = pw.venta_id where pw.id='${pid}') v`);
    casi(v.total, 20);
    casi((await h.saldos(c.clienteId)).monedas, 20 * 5 / 40, 'monedas sobre el neto');

    const c2 = await h.nuevaClienta();
    const p2 = await h.nuevoProducto(50, 10, { costo: 20 });
    const malo = await cupon(c2, { valor: 30.01 });
    const pid2 = await pedido(c2, p2, 1, malo.codigo);
    const antes = await huella(c2, { productos: [p2], cupones: [malo.id] });
    const no = await verificar(pid2);
    assert.equal(no.ok, false);
    assert.match(no.err, MSG_GLOBAL);
    assert.deepEqual(await huella(c2, { productos: [p2], cupones: [malo.id] }), antes);
    assert.equal(await h.json(`select to_json(pago_verificado or venta_id is not null) from public.pedidos_web where id='${pid2}'`), false, 'el pedido sigue sin verificar');
  });
});

describe('Persistencia y permisos por rol', () => {
  test('ADMINISTRADOR guarda y relee el porcentaje y la protección de productos; persisten', async () => {
    const serv = await h.nuevoServicio(40);
    const prod = await h.nuevoProducto(40, 10, { costo: 12 });
    const a = await h.paso(h.ADMIN, `insert into public.servicios_proteccion (servicio_id, materiales, asistente_pct, otros) values ('${serv}', 3, 45, 1)
      on conflict (servicio_id) do update set asistente_pct = excluded.asistente_pct;
      insert into public.productos_proteccion (producto_id, transporte, otros, costo_confirmado) values ('${prod}', 2.5, 1, false);`, { rol: true });
    assert.ok(a.ok, a.err);
    const s = await h.json(`select to_json(p) from public.servicios_proteccion p where servicio_id='${serv}'`);
    casi(s.asistente_pct, 45); casi(s.materiales, 3); casi(s.otros, 1);
    const pp = await h.json(`select to_json(p) from public.productos_proteccion p where producto_id='${prod}'`);
    casi(pp.transporte, 2.5); casi(pp.otros, 1);
    // protección unitaria efectiva = costo registrado (12, no copiado) + 2,5 + 1
    const total = await h.json(`select to_json((public.recompensas_proteccion_producto('${prod}', 2)->>'total')::numeric)`);
    casi(total, 2 * (12 + 2.5 + 1));
    assert.equal(await h.json(`select to_json(count(*)) from information_schema.columns where table_name='productos_proteccion' and column_name like 'costo%' and column_name <> 'costo_confirmado'`), 0, 'no hay una segunda copia del costo');
  });

  test('CAJERA, ASISTENTE y CLIENTA no leen ni escriben la protección ni el costo; las funciones internas no son ejecutables', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(40, { materiales: 7, asistentePct: 45 });
    const prod = await h.nuevoProducto(40, 10, { costo: 12, transporte: 3 });
    for (const [rol, uid] of [['CAJERA', h.CAJERA], ['ASISTENTE', h.ASISTENTE], ['CLIENTA', c.uid]]) {
      for (const t of ['servicios_proteccion', 'productos_proteccion', 'recompensas_venta_proteccion', 'recompensas_venta_detalle']) {
        const r = await h.paso(uid, `select count(*) from public.${t};`, { rol: true });
        assert.equal(r.out, '0', `${rol} no ve ${t}`);
      }
      const w1 = await h.paso(uid, `insert into public.productos_proteccion (producto_id, transporte) values ('${prod}', 1) on conflict (producto_id) do update set transporte = 1;`, { rol: true });
      assert.equal(w1.ok, false, `${rol} no escribe productos_proteccion`);
      const w2 = await h.paso(uid, `update public.servicios_proteccion set asistente_pct = 1 where servicio_id='${serv}';`, { rol: true });
      assert.equal(w2.out, '', `${rol} no actualiza servicios_proteccion`);
      const costo = await h.paso(uid, `select costo from public.productos where id='${prod}';`, { rol: true });
      assert.equal(costo.ok, false, `${rol} no puede leer productos.costo`);
      assert.match(costo.err, /permission denied/i);
      const vista = await h.paso(uid, `select costo from public.productos_vista where id='${prod}';`, { rol: true });
      assert.ok(vista.out === '' || vista.out === 'null' || vista.out === undefined || !/^\d/.test(vista.out), `${rol} recibe costo nulo en la vista (${vista.out})`);
      for (const fn of [`public.recompensas_proteccion_producto('${prod}', 1)`, `public.recompensas_proteccion_servicio('${serv}', 40)`]) {
        const f = await h.paso(uid, `select ${fn};`, { rol: true });
        assert.equal(f.ok, false, `${rol} no ejecuta ${fn.split('(')[0]}`);
      }
    }
    assert.equal(await h.json(`select to_json(asistente_pct) from public.servicios_proteccion where servicio_id='${serv}'`) , 45, 'nada cambió');
    // ADMINISTRADOR sí ve el costo en la vista
    const adm = await h.paso(h.ADMIN, `select costo from public.productos_vista where id='${prod}';`, { rol: true });
    assert.equal(adm.out, '12.00');
  });

  test('CAJERA aplica la regla mediante el backend sin recibir costo ni desglose; el mensaje de rechazo no los revela', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(50, 10, { costo: 20, transporte: 3 });
    const r = await h.vender({ uid: h.CAJERA, clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 40 })).codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, MSG_GLOBAL);
    assert.doesNotMatch(r.err, /20|23|costo|transporte/i, 'el rechazo no muestra importes protegidos');
    // lo que devuelve la venta aceptada a CAJERA tampoco incluye protección
    const ok = await h.vender({ uid: h.CAJERA, clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: (await cupon(c, { valor: 5 })).codigo });
    assert.ok(ok.ok, ok.err);
    assert.doesNotMatch(JSON.stringify(ok.venta), /proteccion|costo|transporte/i);
    // sin permiso para consultar el estado de protección de productos (no existe un lector para Caja)
    const est = await h.paso(h.CAJERA, `select * from public.proteccion_servicios_estado(array[]::uuid[]);`, { rol: true });
    assert.ok(est.ok);
  });
});
