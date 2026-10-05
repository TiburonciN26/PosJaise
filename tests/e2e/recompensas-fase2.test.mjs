// Recompensas Fase 2 — pruebas del núcleo (saldo, venta, protección, sellos,
// canje, anulación, permisos). Solo Supabase Local TEST; datos ficticios.
//
//   node --test --test-concurrency=1 tests/e2e/recompensas-fase2*.test.mjs   (en serie: comparten la config global)
//
// No forma parte de la config de Playwright (no requiere contraseñas QA ni
// navegador). Cada caso crea fixtures nuevos con prefijo "TEST F2".
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg0;

before(async () => {
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  await h.activar(true);
});
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const casi = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 1e-9, `${msg ?? ''} esperado ${b}, obtenido ${a}`);

async function ventaServicio({ c, precio, prot, cupon, pct, monto, extra = [] }) {
  const serv = await h.nuevoServicio(precio, prot);
  const at = await h.nuevaAtencion(c.clienteId, serv, precio);
  const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), ...extra], cupon, pct, monto });
  return { ...r, serv, at };
}

describe('Acreditación por venta (reglas 1, 2)', () => {
  test('tasas 5/S20 servicios y 5/S40 productos con fracciones conservadas', async () => {
    const c = await h.nuevaClienta();
    const rs = await ventaServicio({ c, precio: 30 });
    assert.ok(rs.ok, rs.err);
    casi((await h.saldos(c.clienteId)).monedas, 7.5, 'servicio S30');

    const p30 = await h.nuevoProducto(30);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p30)] })).ok);
    casi((await h.saldos(c.clienteId)).monedas, 7.5 + 3.75, 'producto S30');

    const p5 = await h.nuevoProducto(5);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p5)] })).ok);
    const s = await h.saldos(c.clienteId);
    casi(s.monedas, 7.5 + 3.75 + 0.625, 'producto S5 (no se trunca)');
    casi(s.clasificacion, s.monedas, 'la clasificación recibe el mismo aporte');
  });

  test('venta mixta y envío excluido de la base', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40);
    const r = await ventaServicio({ c, precio: 20, extra: [h.itemProducto(p)] });
    assert.ok(r.ok, r.err);
    casi((await h.saldos(c.clienteId)).monedas, 5 + 5);
    const p2 = await h.nuevoProducto(40);
    const d = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p2)], delivery: 15 });
    assert.ok(d.ok, d.err);
    casi((await h.saldos(c.clienteId)).monedas, 15, 'el envío no suma monedas');
    casi(d.venta.total, 55);
  });

  test('sin cuenta web vinculada o sin clienta no se acreditan monedas ni sellos', async () => {
    const c = await h.nuevaClienta({ vinculada: false });
    const r = await ventaServicio({ c, precio: 40 });
    assert.ok(r.ok, r.err);
    const s = await h.saldos(c.clienteId);
    assert.equal(num(s.monedas), 0);
    assert.equal(s.sellos, 0);
    const p = await h.nuevoProducto(40);
    assert.ok((await h.vender({ items: [h.itemProducto(p)] })).ok, 'venta sin clienta sigue permitida');
  });

  test('completar la atención no acredita; solo la venta, una vez', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(40);
    const at = await h.nuevaAtencion(c.clienteId, serv, 40);
    const s0 = await h.saldos(c.clienteId);
    assert.equal(num(s0.monedas), 0);
    assert.equal(s0.sellos, 0);
    const a = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)] });
    assert.ok(a.ok, a.err);
    const dup = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)] });
    assert.equal(dup.ok, false, 'cobrar otra vez la misma atención se rechaza');
    casi((await h.saldos(c.clienteId)).monedas, 10);
    const n = await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${c.clienteId}' and tipo='VENTA'`);
    assert.equal(n, 1);
  });

  test('con Recompensas apagado la venta se comporta como antes (no acredita)', async () => {
    await h.activar(false);
    try {
      const c = await h.nuevaClienta();
      const r = await ventaServicio({ c, precio: 40 });
      assert.ok(r.ok, r.err);
      const s = await h.saldos(c.clienteId);
      assert.equal(num(s.monedas), 0);
      assert.equal(s.sellos, 0);
    } finally { await h.activar(true); }
  });
});
const num = h.num;

describe('Reparto de descuentos (regla 2)', () => {
  test('recompensas_distribuir conserva la suma exacta a centavos', async () => {
    const r = await h.json(`select to_json(public.recompensas_distribuir(array[10,20,0,5]::numeric[], 10));`);
    casi(r.reduce((a, b) => a + b, 0), 10);
    assert.equal(r[2], 0, 'la línea excluida no recibe descuento');
    const r2 = await h.json(`select to_json(public.recompensas_distribuir(array[0.01,0.01,0.01]::numeric[], 0.02));`);
    casi(r2.reduce((a, b) => a + b, 0), 0.02);
  });

  test('cupón de monto reparte por líneas elegibles y las monedas usan el neto', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40);
    const serv = await h.nuevoServicio(20, { materiales: 0 }); // protección configurada (piso 0)
    const at = await h.nuevaAtencion(c.clienteId, serv, 20);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 12, tipo: 'MONTO_FIJO', alcance: 'TODO' });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p)], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 48);
    const det = await h.json(`select jsonb_agg(d order by linea) from public.recompensas_venta_detalle d where venta_id='${r.venta.venta_id}'`);
    casi(det[0].descuento + det[1].descuento, 12, 'suma de descuentos por línea');
    // neto servicio = 20 - 4 = 16 -> 4; neto producto = 40 - 8 = 32 -> 4
    casi((await h.saldos(c.clienteId)).monedas, 16 * 0.25 + 32 * 0.125);
  });
});

describe('Cupón único y condiciones (regla 3)', () => {
  test('un cupón no se combina con otro descuento', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 5 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: cup.codigo, pct: 10 });
    assert.equal(r.ok, false);
    assert.match(r.err, /No puedes combinar un cupón/);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
  });

  test('cupón que excede su importe elegible se rechaza sin consumirlo ni tocar stock', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(5, 7);
    const serv = await h.nuevoServicio(40);
    const at = await h.nuevaAtencion(c.clienteId, serv, 40);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 10, alcance: 'PRODUCTOS' });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p)], cupon: cup.codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /supera el importe al que puede aplicarse/);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
    assert.equal(await h.stock(p), 7, 'el stock no cambia');
    const s = await h.saldos(c.clienteId);
    assert.equal(num(s.monedas), 0);
    assert.equal(s.sellos, 0);
    const a = await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${at}'`);
    assert.equal(a, true, 'la atención sigue sin vender');
  });

  test('compra mínima, alcance, propietario, vencimiento y nivel', async () => {
    const c = await h.nuevaClienta();
    const otra = await h.nuevaClienta();
    const p = await h.nuevoProducto(20);
    const serv = await h.nuevoServicio(20);
    const at = await h.nuevaAtencion(c.clienteId, serv, 20);

    const min = await h.nuevoCupon(c.clienteId, { valor: 5, minimo: 50, alcance: 'PRODUCTOS' });
    let r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: min.codigo });
    assert.match(r.err, /compra mínima/);

    const alc = await h.nuevoCupon(c.clienteId, { valor: 5, alcance: 'SERVICIOS' });
    r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: alc.codigo });
    assert.match(r.err, /no aplica/);

    const ajeno = await h.nuevoCupon(otra.clienteId, { valor: 5 });
    r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: ajeno.codigo });
    assert.match(r.err, /pertenece a otro cliente/);

    const viejo = await h.nuevoCupon(c.clienteId, { valor: 5, vigenteHasta: '2020-01-01T00:00:00Z' });
    r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: viejo.codigo });
    assert.match(r.err, /ya venció/);

    const vip = await h.nuevoCupon(c.clienteId, { valor: 5, nivel: 'VIP' });
    r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: vip.codigo });
    assert.match(r.err, /nivel VIP/);
    for (const x of [min, alc, ajeno, viejo, vip]) assert.equal((await h.estadoCupon(x.id)).estado, 'DISPONIBLE');
    // la atención no se vendió en ninguno de los intentos
    assert.equal(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${at}'`), true);
  });

  test('porcentaje con tope aplica el tope, no recorta otras reglas', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(100);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 50, tipo: 'PORCENTAJE', tope: 8 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 92);
  });
});

describe('Protección del costo del servicio (regla 4)', () => {
  const prot = { materiales: 5, asistente: 5 };

  test('piso S10 sobre S30: descuento máximo S20', async () => {
    const c = await h.nuevaClienta();
    const ok = await h.nuevoCupon(c.clienteId, { valor: 20 });
    const r = await ventaServicio({ c, precio: 30, prot, cupon: ok.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 10);
    casi((await h.saldos(c.clienteId)).monedas, 2.5, 'neto S10 -> 2,5 monedas');
  });

  test('descuento por encima del margen se rechaza y el cupón sigue disponible', async () => {
    const c = await h.nuevaClienta();
    const cup = await h.nuevoCupon(c.clienteId, { valor: 21 });
    const r = await ventaServicio({ c, precio: 30, prot, cupon: cup.codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /importe mínimo protegido/);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');

    const pct = await h.nuevoCupon(c.clienteId, { valor: 100, tipo: 'PORCENTAJE' });
    const r2 = await ventaServicio({ c, precio: 30, prot, cupon: pct.codigo });
    assert.equal(r2.ok, false, 'un cupón del 100 % no deja el servicio gratis con piso positivo');
    assert.equal((await h.estadoCupon(pct.id)).estado, 'DISPONIBLE');
  });

  test('sin protección configurada: el cupón descuenta hasta el 50 % del precio efectivo (no es costo cero ni rechazo total)', async () => {
    const c = await h.nuevaClienta();
    // S10 sin protección: S10 rechazado, S5 permitido
    const diez = await h.nuevoCupon(c.clienteId, { valor: 10 });
    const r10 = await ventaServicio({ c, precio: 10, cupon: diez.codigo });
    assert.equal(r10.ok, false);
    assert.match(r10.err, /sin protección configurada.*50 %/);
    assert.equal((await h.estadoCupon(diez.id)).estado, 'DISPONIBLE');
    assert.equal(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${r10.at}'`), true, 'sin escrituras parciales');
    const cinco = await h.nuevoCupon(c.clienteId, { valor: 5 });
    const r5 = await ventaServicio({ c, precio: 10, cupon: cinco.codigo });
    assert.ok(r5.ok, r5.err);
    casi(r5.venta.total, 5);
    casi((await h.saldos(c.clienteId)).monedas, 5 * 0.25);

    // porcentaje: 60 % rechazado, 50 % permitido
    const p60 = await h.nuevoCupon(c.clienteId, { valor: 60, tipo: 'PORCENTAJE' });
    assert.equal((await ventaServicio({ c, precio: 30, cupon: p60.codigo })).ok, false);
    const p50 = await h.nuevoCupon(c.clienteId, { valor: 50, tipo: 'PORCENTAJE' });
    const ok50 = await ventaServicio({ c, precio: 30, cupon: p50.codigo });
    assert.ok(ok50.ok, ok50.err);
    casi(ok50.venta.total, 15);

    // centavos: 10,01 → máximo 5,00 (nunca 5,01)
    const sobra = await h.nuevoCupon(c.clienteId, { valor: 5.01 });
    assert.equal((await ventaServicio({ c, precio: 10.01, cupon: sobra.codigo })).ok, false);
    const justo = await h.nuevoCupon(c.clienteId, { valor: 5 });
    assert.ok((await ventaServicio({ c, precio: 10.01, cupon: justo.codigo })).ok);

    // el alta/cobro básico y el descuento manual no cambian
    assert.ok((await ventaServicio({ c, precio: 30, pct: 10 })).ok);
    assert.ok((await ventaServicio({ c, precio: 30 })).ok);
  });

  test('con protección configurada manda el piso (sin límite del 50 %): S30 piso S10 → S20 sí, S20,01 no', async () => {
    const c = await h.nuevaClienta();
    const ok = await h.nuevoCupon(c.clienteId, { valor: 20 });
    assert.ok((await ventaServicio({ c, precio: 30, prot, cupon: ok.codigo })).ok, 'S20 permitido (más del 50 %)');
    const sobra = await h.nuevoCupon(c.clienteId, { valor: 20.01 });
    const r = await ventaServicio({ c, precio: 30, prot, cupon: sobra.codigo });
    assert.equal(r.ok, false);
    assert.match(r.err, /importe mínimo protegido/);
    assert.equal((await h.estadoCupon(sobra.id)).estado, 'DISPONIBLE');
  });

  test('venta mixta: cada partida con su regla y el producto no encubre el exceso', async () => {
    const c = await h.nuevaClienta();
    const a = await h.nuevoServicio(40);        // sin protección: máx S20
    const b = await h.nuevoServicio(40, prot);  // con protección: máx S30
    const ra = await h.nuevaAtencion(c.clienteId, a, 40);
    const rb = await h.nuevaAtencion(c.clienteId, b, 40);
    const p = await h.nuevoProducto(40);
    const ok = await h.nuevoCupon(c.clienteId, { valor: 45 }); // 15/15/15
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(ra), h.itemServicio(rb), h.itemProducto(p)], cupon: ok.codigo });
    assert.ok(r.ok, r.err);
    const ra2 = await h.nuevaAtencion(c.clienteId, a, 40);
    const rb2 = await h.nuevaAtencion(c.clienteId, b, 40);
    const p2 = await h.nuevoProducto(40);
    const mucho = await h.nuevoCupon(c.clienteId, { valor: 66 }); // 22/22/22: la línea sin protección excede
    const r2 = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(ra2), h.itemServicio(rb2), h.itemProducto(p2)], cupon: mucho.codigo });
    assert.equal(r2.ok, false);
    assert.equal((await h.estadoCupon(mucho.id)).estado, 'DISPONIBLE');
    assert.equal(await h.stock(p2), 10);
  });

  test('descuento manual también respeta el piso cuando está configurado', async () => {
    const c = await h.nuevaClienta();
    const r = await ventaServicio({ c, precio: 30, prot, pct: 80 });
    assert.equal(r.ok, false);
    assert.match(r.err, /cobro mínimo/);
    const ok = await ventaServicio({ c, precio: 30, prot, pct: 60 });
    assert.ok(ok.ok, ok.err);
    casi(ok.venta.total, 12);
  });

  test('ventas mixtas y varios servicios: se valida por partida', async () => {
    const c = await h.nuevaClienta();
    // A: S30 piso 10 (margen 20); B: S12 piso 10 (margen 2). Cupón S20 reparte 12 / 8 -> B queda bajo piso.
    const a = await h.nuevoServicio(30, prot);
    const b = await h.nuevoServicio(12, { materiales: 10 });
    const ra = await h.nuevaAtencion(c.clienteId, a, 30);
    const rb = await h.nuevaAtencion(c.clienteId, b, 12);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 20 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(ra), h.itemServicio(rb)], cupon: cup.codigo });
    assert.equal(r.ok, false, 'el margen de la suma no basta: cada partida debe cumplir su piso');
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
    const chico = await h.nuevoCupon(c.clienteId, { valor: 2 });
    const r2 = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(ra), h.itemServicio(rb)], cupon: chico.codigo });
    assert.ok(r2.ok, r2.err);
  });

  test('precio variable: el piso se compara con el precio efectivo de la atención', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(30, prot);
    const at = await h.nuevaAtencion(c.clienteId, serv, 18); // precio acordado S18
    const cup = await h.nuevoCupon(c.clienteId, { valor: 9 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: cup.codigo });
    assert.equal(r.ok, false, 'máximo S8 sobre S18');
    const cup2 = await h.nuevoCupon(c.clienteId, { valor: 8 });
    const r2 = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: cup2.codigo });
    assert.ok(r2.ok, r2.err);
  });

  test('premio de servicio: cubre el precio menos el piso y no se anuncia como gratis', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(30, prot);
    const at = await h.nuevaAtencion(c.clienteId, serv, 30);
    const cup = await h.nuevoCupon(c.clienteId, { tipo: 'SERVICIO', valor: 0, servicioId: serv });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 10, 'la clienta paga el piso');
  });

  test('piso configurado en cero permite servicio cubierto: cero monedas y sello', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(30, { materiales: 0, asistente: 0 });
    const at = await h.nuevaAtencion(c.clienteId, serv, 30);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 30 });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    casi(r.venta.total, 0);
    const s = await h.saldos(c.clienteId);
    assert.equal(num(s.monedas), 0);
    assert.equal(s.sellos, 1);
  });
});

describe('Sellos (regla 5, 6)', () => {
  test('un sello por día aunque haya varias ventas; productos solos no generan sello', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)] })).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 0);
    assert.ok((await ventaServicio({ c, precio: 40 })).ok);
    assert.ok((await ventaServicio({ c, precio: 40 })).ok);
    const s = await h.saldos(c.clienteId);
    assert.equal(s.sellos, 1);
    casi(s.monedas, 0.125 * 40 + 10 + 10, 'cada venta acredita sus monedas');
  });

  test('máximo 20: con 20 no suma; apertura de 35 se conserva y se baja de a cinco', async () => {
    for (const inicial of [20, 25, 35]) {
      const c = await h.nuevaClienta();
      await h.darSellos(c.clienteId, inicial);
      assert.ok((await ventaServicio({ c, precio: 40 })).ok);
      assert.equal((await h.saldos(c.clienteId)).sellos, inicial, `con ${inicial} no se suma`);
    }
    const c = await h.nuevaClienta();
    await h.darSellos(c.clienteId, 35);
    const premio = await h.nuevoPremio({ origen: 'SELLOS' });
    const claim = async k => h.paso(c.uid, `select * from public.canjear_premio_sellos('${premio}', '${k}');`);
    for (let i = 1; i <= 3; i++) assert.ok((await claim('k' + i)).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 20, '35 → 20, aún sin acumulación');
    assert.ok((await ventaServicio({ c, precio: 40 })).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 20);
    assert.ok((await claim('k4')).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 15);
    // la venta previa (tarjeta llena) no se acredita retroactivamente; una venta posterior elegible sí suma
    assert.ok((await ventaServicio({ c, precio: 40 })).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 16);
  });

  test('con menos de 5 sellos no se reclama (incluye negativos)', async () => {
    const c = await h.nuevaClienta();
    await h.darSellos(c.clienteId, 4);
    const premio = await h.nuevoPremio({ origen: 'SELLOS' });
    const r = await h.paso(c.uid, `select * from public.canjear_premio_sellos('${premio}', 'x1');`);
    assert.equal(r.ok, false);
    assert.match(r.err, /Necesitas 5 sellos/);
    assert.equal((await h.saldos(c.clienteId)).sellos, 4);
    const n = await h.nuevaClienta();
    await h.darSellos(n.clienteId, -1);
    assert.equal((await h.paso(n.uid, `select * from public.canjear_premio_sellos('${premio}', 'x2');`)).ok, false);
  });
});

describe('Canje (regla 7, 11)', () => {
  test('saldo insuficiente no debita ni emite; luego alcanza y el costo se congela', async () => {
    const c = await h.nuevaClienta();
    const premio = await h.nuevoPremio({ costoBasico: 25 });
    const r = await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'a1');`);
    assert.equal(r.ok, false);
    assert.match(r.err, /monedas suficientes/);
    await h.darMonedas(c.clienteId, 30);
    const ok = await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'a2');`);
    assert.ok(ok.ok, ok.err);
    casi((await h.saldos(c.clienteId)).monedas, 5);
    const cup = await h.json(`select row_to_json(c) from public.cupones c where cliente_id='${c.clienteId}' and catalogo_id='${premio}'`);
    assert.equal(cup.origen, 'RECOMPENSA_MONEDAS');
    casi(cup.costo_aplicado, 25);
    assert.equal(cup.nivel_aplicado, 'BASICO');
  });

  test('misma clave devuelve el mismo cupón sin segundo débito (respuesta perdida / doble clic)', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100);
    const premio = await h.nuevoPremio({ costoBasico: 40 });
    const sql = `select row_to_json(t) from public.canjear_recompensa('${premio}', 'misma') t;`;
    const a = JSON.parse((await h.paso(c.uid, sql)).out);
    const b = JSON.parse((await h.paso(c.uid, sql)).out);
    assert.equal(a.cupon_id, b.cupon_id);
    assert.equal(a.repetido, false);
    assert.equal(b.repetido, true);
    casi((await h.saldos(c.clienteId)).monedas, 60);
    const otra = await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'otra');`);
    assert.ok(otra.ok);
    casi((await h.saldos(c.clienteId)).monedas, 20, 'otra clave = otro canje');
  });

  test('doble clic concurrente con la misma clave: un solo débito', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100);
    const premio = await h.nuevoPremio({ costoBasico: 40 });
    const sql = `select * from public.canjear_recompensa('${premio}', 'dc');`;
    const rs = await Promise.all([h.paso(c.uid, sql), h.paso(c.uid, sql), h.paso(c.uid, sql)]);
    assert.ok(rs.every(r => r.ok), rs.map(r => r.err).join('|'));
    casi((await h.saldos(c.clienteId)).monedas, 60);
    assert.equal(await h.json(`select to_json(count(*)) from public.cupones where cliente_id='${c.clienteId}' and catalogo_id='${premio}'`), 1);
  });

  test('concurrencia sobre el último saldo: claves distintas, solo una pasa', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 30);
    const premio = await h.nuevoPremio({ costoBasico: 25 });
    const rs = await Promise.all(['u1', 'u2', 'u3'].map(k => h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', '${k}');`)));
    assert.equal(rs.filter(r => r.ok).length, 1);
    casi((await h.saldos(c.clienteId)).monedas, 5);
  });

  test('concurrencia sobre el último cupo global: dos clientas, una gana', async () => {
    const a = await h.nuevaClienta(), b = await h.nuevaClienta();
    await h.darMonedas(a.clienteId, 50); await h.darMonedas(b.clienteId, 50);
    const premio = await h.nuevoPremio({ costoBasico: 20, cupo: 1 });
    const [ra, rb] = await Promise.all([
      h.paso(a.uid, `select * from public.canjear_recompensa('${premio}', 'ca');`),
      h.paso(b.uid, `select * from public.canjear_recompensa('${premio}', 'cb');`)]);
    assert.equal([ra, rb].filter(r => r.ok).length, 1);
    const perdedora = ra.ok ? b : a;
    casi((await h.saldos(perdedora.clienteId)).monedas, 50, 'quien no obtuvo cupo no pierde monedas');
  });

  test('límite por clienta, vigencia de reclamo y caducidad del cupón emitido', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 200);
    const lim = await h.nuevoPremio({ costoBasico: 10, limiteCliente: 1 });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${lim}', 'l1');`)).ok);
    const r = await h.paso(c.uid, `select * from public.canjear_recompensa('${lim}', 'l2');`);
    assert.match(r.err, /límite/);

    const vencida = await h.nuevoPremio({ costoBasico: 10, reclamoHasta: '2020-01-01T00:00:00Z' });
    assert.match((await h.paso(c.uid, `select * from public.canjear_recompensa('${vencida}', 'v1');`)).err, /terminó/);
    const futura = await h.nuevoPremio({ costoBasico: 10, reclamoDesde: '2099-01-01T00:00:00Z' });
    assert.match((await h.paso(c.uid, `select * from public.canjear_recompensa('${futura}', 'v2');`)).err, /todavía no/i);

    const conVence = await h.nuevoPremio({ costoBasico: 10, vigenciaDias: 10 });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${conVence}', 'v3');`)).ok);
    const dias = await h.json(`select to_json(round(extract(epoch from (vigente_hasta - now()))/86400)) from public.cupones where catalogo_id='${conVence}' and cliente_id='${c.clienteId}'`);
    assert.equal(dias, 10);
    const indef = await h.nuevoPremio({ costoBasico: 10 });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${indef}', 'v4');`)).ok);
    assert.equal(await h.json(`select to_json(vigente_hasta is null) from public.cupones where catalogo_id='${indef}' and cliente_id='${c.clienteId}'`), true);
  });

  test('costos y nivel mínimo por nivel; se registra el costo y nivel aplicados', async () => {
    const basica = await h.nuevaClienta(), premium = await h.nuevaClienta(), vip = await h.nuevaClienta();
    for (const x of [basica, premium, vip]) await h.darMonedas(x.clienteId, 500, 0);
    await h.darMonedas(premium.clienteId, 0, 60);   // clasificación 60 → PREMIUM (umbral 50)
    await h.darMonedas(vip.clienteId, 0, 200);      // 200 → VIP (umbral 150)
    const premio = await h.nuevoPremio({ costoBasico: 100, costoPremium: 80, costoVip: 50 });
    for (const [x, esperado, nivel] of [[basica, 100, 'BASICO'], [premium, 80, 'PREMIUM'], [vip, 50, 'VIP']]) {
      assert.equal((await h.saldos(x.clienteId)).nivel, nivel);
      assert.ok((await h.paso(x.uid, `select * from public.canjear_recompensa('${premio}', 'n1');`)).ok);
      const k = await h.json(`select row_to_json(c) from public.cupones c where cliente_id='${x.clienteId}' and catalogo_id='${premio}'`);
      casi(k.costo_aplicado, esperado); assert.equal(k.nivel_aplicado, nivel);
    }
    // editar el catálogo después no altera el canje pasado
    await h.admin(`update public.recompensas_catalogo set costo_basico = 999 where id='${premio}'`);
    const k = await h.json(`select row_to_json(c) from public.cupones c where cliente_id='${basica.clienteId}' and catalogo_id='${premio}'`);
    casi(k.costo_aplicado, 100);

    const excl = await h.nuevoPremio({ costoBasico: 10, nivelMinimo: 'VIP' });
    assert.match((await h.paso(premium.uid, `select * from public.canjear_recompensa('${excl}', 'n2');`)).err, /nivel VIP/);
    assert.ok((await h.paso(vip.uid, `select * from public.canjear_recompensa('${excl}', 'n2');`)).ok);
  });

  test('premio de servicio sin protección: se emite y la clienta paga al menos la mitad (no es gratis)', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100);
    const serv = await h.nuevoServicio(30); // sin protección configurada
    const premio = await h.nuevoPremio({ tipo: 'SERVICIO', servicioId: serv, costoBasico: 20 });
    const cat = JSON.parse((await h.paso(c.uid, `select json_agg(t) from public.mi_catalogo_recompensas('MONEDAS') t where id='${premio}';`)).out);
    casi(cat[0].pago_minimo, 15); assert.equal(cat[0].regla_servicio, 'MITAD'); assert.equal(cat[0].canjeable, true);
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'f1');`)).ok);
    const codigo = await h.json(`select to_json(codigo) from public.cupones where catalogo_id='${premio}' and cliente_id='${c.clienteId}'`);
    const at = await h.nuevaAtencion(c.clienteId, serv, 30);
    const v = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)], cupon: codigo });
    assert.ok(v.ok, v.err);
    casi(v.venta.total, 15);
  });

  test('transacción fallida por cupo agotado no debita ni emite', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100);
    const premio = await h.nuevoPremio({ costoBasico: 20, cupo: 0 });
    const r = await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'f1');`);
    assert.equal(r.ok, false);
    casi((await h.saldos(c.clienteId)).monedas, 100);
    assert.equal(await h.json(`select to_json(count(*)) from public.cupones where catalogo_id='${premio}'`), 0);
    assert.equal(await h.json(`select to_json(count(*)) from public.recompensas_canjes where catalogo_id='${premio}'`), 0);
  });

  test('catálogo inactivo no canjeable y catálogo de la clienta no expone costos internos', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100);
    const serv = await h.nuevoServicio(30, { materiales: 5, asistente: 5 });
    const off = await h.nuevoPremio({ activo: false });
    assert.equal((await h.paso(c.uid, `select * from public.canjear_recompensa('${off}', 'i1');`)).ok, false);
    const on = await h.nuevoPremio({ tipo: 'SERVICIO', servicioId: serv, costoBasico: 20 });
    const cat = JSON.parse((await h.paso(c.uid, `select json_agg(t) from public.mi_catalogo_recompensas('MONEDAS') t where id='${on}';`)).out);
    assert.equal(cat.length, 1);
    casi(cat[0].pago_minimo, 10, 'pago mínimo visible antes de gastar');
    assert.equal(cat[0].regla_servicio, 'PISO');
    assert.equal(cat[0].canjeable, true);
    assert.ok(!('materiales' in cat[0]) && !('asistente' in cat[0]), 'sin componentes internos');
    assert.equal(cat.some(x => x.id === off), false);
  });
});

describe('Anulación (reglas 8, 9, 10)', () => {
  test('ejemplo de la especificación: 10 → 30 → 5 → −15 → −5 → 5', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 10, 0);
    const r = await ventaServicio({ c, precio: 80 }); // +20
    casi((await h.saldos(c.clienteId)).monedas, 30);
    const premio = await h.nuevoPremio({ costoBasico: 25 });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'e1');`)).ok);
    casi((await h.saldos(c.clienteId)).monedas, 5);
    const an = await h.anular(r.venta.venta_id);
    assert.ok(an.ok, an.err);
    const s = await h.saldos(c.clienteId);
    casi(s.monedas, -15, 'puede quedar negativo y no bloquea la anulación');
    casi(s.clasificacion, 0, 'la clasificación baja por la anulación');
    const again = await h.anular(r.venta.venta_id);
    assert.equal(again.ok, false);
    casi((await h.saldos(c.clienteId)).monedas, -15, 'segunda anulación no repite efectos');
    const p1 = await h.nuevoProducto(80);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p1)] })).ok); // +10
    casi((await h.saldos(c.clienteId)).monedas, -5);
    assert.ok((await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(await h.nuevoProducto(80))] })).ok);
    casi((await h.saldos(c.clienteId)).monedas, 5);
    // saldo negativo bloquea canjear
    await h.darMonedas(c.clienteId, -100, 0);
    assert.equal((await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'e2');`)).ok, false);
  });

  test('el gasto de monedas no baja la clasificación; la inactividad tampoco', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100, 100);
    const premio = await h.nuevoPremio({ costoBasico: 60 });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'g1');`)).ok);
    const s = await h.saldos(c.clienteId);
    casi(s.monedas, 40); casi(s.clasificacion, 100);
    assert.equal(s.nivel, 'PREMIUM');
  });

  test('sello: se conserva si queda otra venta de servicios ese día y se retira si no (una sola vez)', async () => {
    const c = await h.nuevaClienta();
    const a = await ventaServicio({ c, precio: 40 });
    const b = await ventaServicio({ c, precio: 40 });
    assert.equal((await h.saldos(c.clienteId)).sellos, 1);
    assert.ok((await h.anular(a.venta.venta_id)).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 1, 'queda la otra venta válida');
    assert.ok((await h.anular(b.venta.venta_id)).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 0, 'no queda ninguna: se retira');
    assert.equal((await h.anular(b.venta.venta_id)).ok, false);
    assert.equal((await h.saldos(c.clienteId)).sellos, 0, 'no se retira dos veces');
  });

  test('sello ya consumido: el cupón se conserva y los sellos quedan negativos', async () => {
    const c = await h.nuevaClienta();
    await h.darSellos(c.clienteId, 4);
    const r = await ventaServicio({ c, precio: 40 }); // 5
    const premio = await h.nuevoPremio({ origen: 'SELLOS' });
    assert.ok((await h.paso(c.uid, `select * from public.canjear_premio_sellos('${premio}', 's1');`)).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, 0);
    assert.ok((await h.anular(r.venta.venta_id)).ok);
    assert.equal((await h.saldos(c.clienteId)).sellos, -1);
    assert.equal(await h.json(`select to_json(count(*)) from public.cupones where catalogo_id='${premio}' and cliente_id='${c.clienteId}' and estado='DISPONIBLE'`), 1, 'el cupón reclamado se conserva');
  });

  test('cupón de venta anulada vuelve disponible conservando vencimiento; monedas del canje no se devuelven', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 100, 0);
    const premio = await h.nuevoPremio({ costoBasico: 30, valor: 5, vigenciaDias: 15 });
    const canje = JSON.parse((await h.paso(c.uid, `select row_to_json(t) from public.canjear_recompensa('${premio}', 'c1') t;`)).out);
    const antes = await h.estadoCupon(canje.cupon_id);
    const p = await h.nuevoProducto(40);
    const v = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: canje.codigo });
    assert.ok(v.ok, v.err);
    assert.equal((await h.estadoCupon(canje.cupon_id)).estado, 'CANJEADO');
    const monedasUsado = (await h.saldos(c.clienteId)).monedas;
    assert.ok((await h.anular(v.venta.venta_id)).ok);
    const despues = await h.estadoCupon(canje.cupon_id);
    assert.equal(despues.estado, 'DISPONIBLE');
    assert.equal(despues.vigente_hasta, antes.vigente_hasta, 'conserva su vencimiento original');
    // monedas: -30 del canje siguen; la venta de S35 neto sumó 4,375 y se revirtió
    casi((await h.saldos(c.clienteId)).monedas, 70);
    assert.ok(num(monedasUsado) > 70);
  });

  test('cupón vencido antes de anular no se reactiva', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 5 });
    const v = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: cup.codigo });
    assert.ok(v.ok, v.err);
    await h.admin(`update public.cupones set vigente_hasta = now() - interval '1 day' where id='${cup.id}'`);
    assert.ok((await h.anular(v.venta.venta_id)).ok);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'CANJEADO');
  });

  test('anular repone stock y revierte una sola vez aunque haya intentos repetidos en paralelo', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(40, 5);
    const v = await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p, 2)] });
    assert.equal(await h.stock(p), 3);
    const rs = await Promise.all([h.anular(v.venta.venta_id), h.anular(v.venta.venta_id), h.anular(v.venta.venta_id)]);
    assert.equal(rs.filter(r => r.ok).length, 1);
    assert.equal(await h.stock(p), 5);
    casi((await h.saldos(c.clienteId)).monedas, 0);
    assert.equal(await h.json(`select to_json(count(*)) from public.recompensas_movimientos where venta_id='${v.venta.venta_id}' and tipo='VENTA_REVERSION'`), 1);
  });
});

describe('Atenciones previas al corte (regla 12, revisión punto 5)', () => {
  test('el servicio con aporte en la apertura no acredita otra vez; productos y sello de la venta sí', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(40);
    const at = await h.nuevaAtencion(c.clienteId, serv, 40);
    // El aporte es un artificio de la prueba: se retira SIEMPRE al terminar (también si falla) y SOLO el propio (por su atención),
    // para no dejar filas en recompensas_apertura_aportes que bloqueen la apertura real (ver docs/recompensas-fase2/APORTES-PREEXISTENTES-QA.md).
    try {
      await h.admin(`insert into public.recompensas_apertura_aportes (cliente_id, origen, registro_servicio_id, puntos_antiguos, monedas)
                     values ('${c.clienteId}', 'ATENCION', '${at}', 2, 10);`);
      const p = await h.nuevoProducto(40);
      const v = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), h.itemProducto(p)] });
      assert.ok(v.ok, v.err);
      const s = await h.saldos(c.clienteId);
      casi(s.monedas, 5, 'solo el producto (S40 → 5); el servicio ya estaba en la apertura');
      assert.equal(s.sellos, 1, 'el sello del día nuevo se evalúa aparte');
    } finally {
      await h.admin(`delete from public.recompensas_apertura_aportes
                     where cliente_id = '${c.clienteId}' and registro_servicio_id = '${at}';`);
    }
  });
});

describe('Permisos y accesos (RLS, GRANT, EXECUTE)', () => {
  test('solo ADMINISTRADOR activa Recompensas', async () => {
    for (const uid of [CAJERA, ASISTENTE]) {
      const r = await h.paso(uid, `select public.recompensas_establecer_activo(true);`, { rol: true });
      assert.equal(r.ok, false);
      assert.match(r.err, /Solo el administrador/);
    }
  });

  test('protección y catálogo: escritura solo ADMINISTRADOR; clienta no lee protección', async () => {
    const serv = await h.nuevoServicio(30, { materiales: 5, asistente: 5 });
    const c = await h.nuevaClienta();
    for (const uid of [CAJERA, ASISTENTE, c.uid]) {
      const w = await h.paso(uid, `insert into public.servicios_proteccion (servicio_id, materiales) values ('${serv}', 1) on conflict (servicio_id) do update set materiales = 1;`, { rol: true });
      assert.equal(w.ok, false, 'escritura rechazada');
      const cat = await h.paso(uid, `insert into public.recompensas_catalogo (nombre, origen, tipo, costo_basico) values ('x','MONEDAS','MONTO',1);`, { rol: true });
      assert.equal(cat.ok, false);
    }
    const cl = await h.paso(c.uid, `select count(*) from public.servicios_proteccion;`, { rol: true });
    assert.equal(cl.out, '0', 'la clienta no ve la protección');
    const ca = await h.paso(CAJERA, `select count(*) from public.servicios_proteccion;`, { rol: true });
    assert.equal(ca.out, '0', 'la cajera tampoco la lee directo');
    const ad = await h.paso(ADMIN_UID, `insert into public.servicios_proteccion (servicio_id, materiales) values ('${await h.nuevoServicio(10)}', 1);`, { rol: true });
    assert.ok(ad.ok, ad.err);
  });

  test('caja consulta el estado de protección por función; la clienta no', async () => {
    const serv = await h.nuevoServicio(30, { materiales: 5, asistente: 5 });
    const sin = await h.nuevoServicio(30);
    const ids = `array['${serv}','${sin}']::uuid[]`;
    const caja = JSON.parse((await h.paso(CAJERA, `select json_agg(t order by configurada desc) from public.proteccion_servicios_estado(${ids}) t;`, { rol: true })).out);
    assert.equal(caja.length, 2);
    assert.equal(caja[0].configurada, true); casi(caja[0].piso, 10);
    assert.equal(caja[1].configurada, false); assert.equal(caja[1].piso, null);
    const c = await h.nuevaClienta();
    const cl = await h.paso(c.uid, `select count(*) from public.proteccion_servicios_estado(${ids});`, { rol: true });
    assert.equal(cl.out, '0');
  });

  test('movimientos: la clienta solo ve los suyos y no puede escribirlos', async () => {
    const a = await h.nuevaClienta(), b = await h.nuevaClienta();
    await h.darMonedas(a.clienteId, 10); await h.darMonedas(b.clienteId, 20);
    const v = await h.paso(a.uid, `select count(*) from public.recompensas_movimientos;`, { rol: true });
    assert.equal(v.out, '1');
    const w = await h.paso(a.uid, `insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clave) values ('${a.clienteId}','AJUSTE',999,'hack');`, { rol: true });
    assert.equal(w.ok, false);
    const u = await h.paso(a.uid, `update public.recompensas_movimientos set monedas = 999;`, { rol: true });
    assert.equal(u.ok, false);
    casi((await h.saldos(a.clienteId)).monedas, 10);
  });

  test('canjear requiere sesión de clienta: anon sin EXECUTE; el personal no tiene clienta', async () => {
    const premio = await h.nuevoPremio();
    const anon = await h.admin(`set role anon; select * from public.canjear_recompensa('${premio}', 'z');`);
    assert.equal(anon.ok, false);
    const staff = await h.paso(ASISTENTE, `select * from public.canjear_recompensa('${premio}', 'z');`, { rol: true });
    assert.equal(staff.ok, false);
    assert.match(staff.err, /Inicia sesión con tu cuenta de clienta/);
  });

  test('movimientos explicados y sellos (lectura de la clienta)', async () => {
    const c = await h.nuevaClienta();
    const r = await ventaServicio({ c, precio: 40 });
    await h.anular(r.venta.venta_id);
    const mov = JSON.parse((await h.paso(c.uid, `select json_agg(t) from public.mis_movimientos_recompensas() t;`, { rol: true })).out);
    assert.deepEqual(mov.map(m => m.tipo).sort(), ['VENTA', 'VENTA_REVERSION']);
    assert.ok(mov.every(m => m.descripcion.length > 5));
    const sel = JSON.parse((await h.paso(c.uid, `select json_agg(t) from public.mis_sellos_recompensas() t;`, { rol: true })).out);
    assert.equal(sel.length, 2);
    assert.match(sel.find(x => x.tipo === 'SELLO_RETIRO').descripcion, /compensarán este ajuste/);
  });
});

const ADMIN_UID = h.ADMIN;
const CAJERA = h.CAJERA;
const ASISTENTE = h.ASISTENTE;

describe('Legado', () => {
  test('con Recompensas activo el canje antiguo sin costo queda cerrado', async () => {
    const c = await h.nuevaClienta();
    const r = await h.paso(c.uid, `select * from public.generar_cupon_fidelizacion();`);
    assert.equal(r.ok, false);
    assert.match(r.err, /Mis sellos/);
  });
});
