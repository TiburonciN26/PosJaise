// QA-054 — el cupón se valida ANTES de pedir el pago de un pedido web (capa SQL, solo Supabase Local TEST; datos "TEST F2").
//
//   node --test --test-concurrency=1 tests/e2e/recompensas-pedido-cupon.test.mjs
//
// IMPORTANTE: esta capa simula la identidad con request.jwt.claims; NO es E2E con sesión real. Las pruebas HTTP/UI con inicio de
// sesión normal están en tests/e2e/qa-054-cupon-pedido.spec.mjs (Playwright) y requieren QA_TEST_PASSWORD.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

const GLOBAL = /supera el descuento permitido para esta compra/;
let cfg0;
before(async () => { await h.verificarLocalTest(); cfg0 = await h.configActual(); await h.activar(true); });
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const casi = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 1e-9, `${msg ?? ''} esperado ${b}, obtenido ${a}`);

// Escenario de Codex: producto S50, costo S20 + transporte S3 + otros S25 = protección S48.
async function escenario({ precio = 50, costo = 20, transporte = 3, otros = 25, cantidad = 1, cupon = { valor: 10 } } = {}) {
  const c = await h.nuevaClienta();
  const p = await h.nuevoProducto(precio, 10, { costo, transporte, otros });
  const cup = await h.nuevoCupon(c.clienteId, cupon);
  await h.ponerEnCarrito(c.uid, p, cantidad);
  return { c, p, cup };
}

const huella = (c, p, cup) => h.json(`select jsonb_build_object(
  'pedidos', (select count(*) from public.pedidos_web where cliente_id='${c.clienteId}'),
  'items', (select count(*) from public.pedidos_web_items i join public.pedidos_web w on w.id=i.pedido_id where w.cliente_id='${c.clienteId}'),
  'ventas', (select count(*) from public.ventas where cliente_id='${c.clienteId}'),
  'stock', (select stock_actual from public.productos where id='${p}'),
  'carrito', (select coalesce(sum(cantidad),0) from public.carrito_productos where cliente_web_id='${c.uid}'),
  'cupon', (select estado||coalesce(venta_id::text,'') from public.cupones where id='${cup}'),
  'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${c.clienteId}'),
  'sellos', (select count(*) from public.recompensas_sellos_movs where cliente_id='${c.clienteId}'));`);

describe('QA-054 · cupón fuera de protección: rechazo ANTES de pedir el pago', () => {
  test('escenario de Codex: S50, protección S48, cupón S10 → vista previa inválida y el pedido NO se crea (llamada directa, sin UI)', async () => {
    const { c, p, cup } = await escenario();
    const antes = await huella(c, p, cup.id);
    const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
    assert.ok(vp.ok, vp.err);
    assert.equal(vp.fila.valido, false);
    assert.match(vp.fila.motivo, GLOBAL);
    casi(vp.fila.descuento, 0, 'no se promete ningún descuento');
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.equal(ped.ok, false, 'saltándose la UI el servidor también rechaza');
    assert.match(ped.err, GLOBAL);
    assert.deepEqual(await huella(c, p, cup.id), antes, 'sin pedido, sin consumo, sin stock ni libros tocados; el carrito sigue');
  });

  test('cupón dentro de la protección (S2): total correcto, pedido aceptado y pago verificado', async () => {
    const { c, p, cup } = await escenario({ cupon: { valor: 2 } });
    const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
    assert.equal(vp.fila.valido, true, vp.fila.motivo);
    casi(vp.fila.subtotal, 50); casi(vp.fila.descuento, 2);
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.ok(ped.ok, ped.err);
    const w = await h.json(`select to_json(w) from (select subtotal, descuento_cupon, total from public.pedidos_web where id='${ped.pedidoId}') w`);
    casi(w.total, 48); casi(w.descuento_cupon, 2);
    const v = await h.verificarPagoPedido(ped.pedidoId);
    assert.ok(v.ok, v.err);
    const venta = await h.json(`select to_json(v) from (select total, cupon_id is not null as con_cupon from public.ventas where id=(select venta_id from public.pedidos_web where id='${ped.pedidoId}')) v`);
    casi(venta.total, 48, 'la venta coincide con lo que la clienta pagó');
    assert.equal((await h.estadoCupon(cup.id)).estado, 'CANJEADO');
    assert.equal(await h.stock(p), 9);
  });

  test('la vista previa es de SOLO LECTURA: no consume el cupón, no reserva stock, no crea pedidos ni acredita', async () => {
    for (const valor of [10, 2]) {
      const { c, p, cup } = await escenario({ cupon: { valor } });
      const antes = await huella(c, p, cup.id);
      const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
      assert.ok(vp.ok, vp.err);
      assert.deepEqual(await huella(c, p, cup.id), antes, `cupón S${valor}`);
    }
  });
});

describe('QA-054 · alcance, mínimo, porcentaje con tope, costo desconocido y cantidades', () => {
  test('cupón exclusivo de SERVICIOS en un carrito solo de productos: no aplica (vista previa y pedido)', async () => {
    const { c, p, cup } = await escenario({ cupon: { valor: 5, alcance: 'SERVICIOS' } });
    const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
    assert.equal(vp.fila.valido, false);
    assert.match(vp.fila.motivo, /no aplica a los productos o servicios de esta compra/);
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.equal(ped.ok, false);
    assert.match(ped.err, /no aplica a los productos o servicios/);
  });

  test('porcentaje con tope y compra mínima: aplica el tope; el mínimo y la protección rechazan sin recortar', async () => {
    // S50, protección S10 (costo 10): máximo S40.
    const a = await escenario({ costo: 10, transporte: 0, otros: 0, cupon: { valor: 50, tipo: 'PORCENTAJE', tope: 5 } });
    const va = await h.vistaPreviaCupon(a.c.uid, a.cup.codigo, [a.p]);
    assert.equal(va.fila.valido, true); casi(va.fila.descuento, 5, 'el tope manda (25 → 5)');
    // compra mínima S60 sobre S50: rechazo
    const b = await escenario({ costo: 10, transporte: 0, otros: 0, cupon: { valor: 10, minimo: 60 } });
    const vb = await h.vistaPreviaCupon(b.c.uid, b.cup.codigo, [b.p]);
    assert.equal(vb.fila.valido, false);
    assert.match(vb.fila.motivo, /compra mínima de S\/ 60/);
    // 100 % con tope S45 > máximo S40: se rechaza COMPLETO (no se recorta a 40)
    const d = await escenario({ costo: 10, transporte: 0, otros: 0, cupon: { valor: 100, tipo: 'PORCENTAJE', tope: 45 } });
    const vd = await h.vistaPreviaCupon(d.c.uid, d.cup.codigo, [d.p]);
    assert.equal(vd.fila.valido, false);
    assert.match(vd.fila.motivo, GLOBAL);
    assert.equal((await h.crearPedido(d.c.uid, [d.p], d.cup.codigo)).ok, false);
    assert.equal((await h.estadoCupon(d.cup.id)).estado, 'DISPONIBLE');
  });

  test('costo DESCONOCIDO bloquea con un motivo neutro (sin revelar costos); costo cero CONFIRMADO lo admite', async () => {
    const c = await h.nuevaClienta();
    const id = await h.json(`with p as (insert into public.productos (nombre, precio, costo, stock_actual)
      values ('TEST F2 prod sin costo ${h.runId}-${Math.random().toString(36).slice(2, 6)}', 40, 0, 10) returning id) select to_json(id) from p`);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 5 });
    await h.ponerEnCarrito(c.uid, id, 1);
    const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [id]);
    assert.equal(vp.fila.valido, false);
    assert.match(vp.fila.motivo, /por ahora/);
    assert.doesNotMatch(JSON.stringify(vp.fila), /costo|TEST F2 prod|administrador/i, 'la clienta no recibe el motivo interno');
    const ped = await h.crearPedido(c.uid, [id], cup.codigo);
    assert.equal(ped.ok, false);
    assert.doesNotMatch(ped.err, /costo|administrador/i);
    await h.admin(`insert into public.productos_proteccion (producto_id, costo_confirmado) values ('${id}', true);`);
    const ok = await h.vistaPreviaCupon(c.uid, cup.codigo, [id]);
    assert.equal(ok.fila.valido, true, ok.fila.motivo);
    casi(ok.fila.descuento, 5);
  });

  test('cambio de cantidad después de aplicar el cupón: se revalida con el carrito actual', async () => {
    // cupón con compra mínima S50 sobre un producto de S25: con 2 unidades vale, con 1 ya no
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(25, 10, { costo: 5 });
    const cup = await h.nuevoCupon(c.clienteId, { valor: 5, minimo: 50 });
    await h.ponerEnCarrito(c.uid, p, 2);
    assert.equal((await h.vistaPreviaCupon(c.uid, cup.codigo, [p])).fila.valido, true);
    await h.ponerEnCarrito(c.uid, p, 1);
    const una = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
    assert.equal(una.fila.valido, false);
    assert.match(una.fila.motivo, /compra mínima/);
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.equal(ped.ok, false, 'con una unidad el servidor también lo rechaza');
    // y la protección crece con la cantidad: S25, costo S20; cupón S6: con 1 unidad (máximo S5) no, con 3 (máximo S15) sí
    const c2 = await h.nuevaClienta();
    const p2 = await h.nuevoProducto(25, 10, { costo: 20 });
    const cup2 = await h.nuevoCupon(c2.clienteId, { valor: 6 });
    await h.ponerEnCarrito(c2.uid, p2, 1);
    assert.equal((await h.vistaPreviaCupon(c2.uid, cup2.codigo, [p2])).fila.valido, false);
    await h.ponerEnCarrito(c2.uid, p2, 3);
    assert.equal((await h.vistaPreviaCupon(c2.uid, cup2.codigo, [p2])).fila.valido, true);
  });

  test('cupón vencido, ajeno e inexistente: motivo claro y sin escrituras', async () => {
    const { c, p } = await escenario();
    const viejo = await h.nuevoCupon(c.clienteId, { valor: 1, vigenteHasta: '2020-01-01T00:00:00Z' });
    assert.match((await h.vistaPreviaCupon(c.uid, viejo.codigo, [p])).fila.motivo, /ya venció/);
    const otra = await h.nuevaClienta();
    const ajeno = await h.nuevoCupon(otra.clienteId, { valor: 1 });
    assert.match((await h.vistaPreviaCupon(c.uid, ajeno.codigo, [p])).fila.motivo, /no existe, no es tuyo/, 'solo sus propios cupones');
    assert.match((await h.vistaPreviaCupon(c.uid, 'NOEXISTE1', [p])).fila.motivo, /no existe, no es tuyo/);
    assert.equal((await h.estadoCupon(ajeno.id)).estado, 'DISPONIBLE');
  });
});

describe('QA-054 · privacidad de la respuesta', () => {
  test('la respuesta solo trae valido, motivo, subtotal y descuento: sin costos, componentes ni porcentajes internos', async () => {
    const { c, p, cup } = await escenario({ costo: 21.37, transporte: 3.11, otros: 25.13 });
    for (const valor of [10, 1]) {
      const cupon = valor === 10 ? cup : await h.nuevoCupon(c.clienteId, { valor });
      const vp = await h.vistaPreviaCupon(c.uid, cupon.codigo, [p]);
      assert.deepEqual(Object.keys(vp.fila).sort(), ['descuento', 'motivo', 'subtotal', 'valido']);
      assert.doesNotMatch(JSON.stringify(vp.fila), /21\.37|3\.11|25\.13|49\.61|costo|transporte|proteccion|protección \d/i);
    }
  });

  test('las funciones internas no son ejecutables por la clienta ni por Caja; la vista previa solo existe para sesión autenticada', async () => {
    const c = await h.nuevaClienta();
    for (const [uid] of [[c.uid], [h.CAJERA]]) {
      for (const fn of [`public.recompensas_evaluar_cupon('${c.clienteId}', '[]')`, `public.recompensas_validar_cupon_pedido('${c.clienteId}', 'X', '[]')`]) {
        const r = await h.paso(uid, `select ${fn};`, { rol: true });
        assert.equal(r.ok, false, fn);
      }
    }
    const anon = await h.admin(`set role anon; select * from public.vista_previa_cupon_pedido('X', array[]::uuid[]);`);
    assert.equal(anon.ok, false, 'anon no ejecuta la vista previa');
  });
});

describe('QA-054 · cambios entre la vista previa, el pedido y la verificación', () => {
  test('cambio de precio o protección ENTRE la vista previa y la confirmación: manda el servidor', async () => {
    const { c, p, cup } = await escenario({ cupon: { valor: 2 } });
    assert.equal((await h.vistaPreviaCupon(c.uid, cup.codigo, [p])).fila.valido, true);
    await h.admin(`update public.productos_proteccion set transporte = 10 where producto_id='${p}';`); // protección S58 > S50
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.equal(ped.ok, false);
    assert.match(ped.err, GLOBAL);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
  });

  test('cambio de COSTO/protección DESPUÉS de aceptar el pedido: CONFLICTO explícito, sin escrituras parciales', async () => {
    const { c, p, cup } = await escenario({ cupon: { valor: 2 } });
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.ok(ped.ok, ped.err);
    await h.admin(`update public.productos_proteccion set otros = 40 where producto_id='${p}';`); // protección 63 > 48
    const antes = await huella(c, p, cup.id);
    const v = await h.verificarPagoPedido(ped.pedidoId);
    assert.equal(v.ok, false);
    assert.match(v.err, /CONFLICTO/);
    assert.match(v.err, /ya no cumple la protección económica/);
    assert.match(v.err, /no se cobró ni se cambió nada/);
    assert.deepEqual(await huella(c, p, cup.id), antes);
    assert.equal(await h.json(`select to_json(pago_verificado or venta_id is not null) from public.pedidos_web where id='${ped.pedidoId}'`), false);
    assert.equal(await h.json(`select to_json(estado) from public.pedidos_web where id='${ped.pedidoId}'`), 'PENDIENTE');
  });

  test('cambio de PRECIO después del pedido (con y sin cupón): el total vigente no coincide → CONFLICTO, nada se cobra', async () => {
    for (const conCupon of [true, false]) {
      const c = await h.nuevaClienta();
      const p = await h.nuevoProducto(50, 10, { costo: 20 });
      const cup = await h.nuevoCupon(c.clienteId, { valor: 5 });
      await h.ponerEnCarrito(c.uid, p, 1);
      const ped = await h.crearPedido(c.uid, [p], conCupon ? cup.codigo : null);
      assert.ok(ped.ok, ped.err);
      await h.admin(`update public.productos set precio = 60 where id='${p}';`);
      const antes = await huella(c, p, cup.id);
      const v = await h.verificarPagoPedido(ped.pedidoId);
      assert.equal(v.ok, false, `conCupon=${conCupon}`);
      assert.match(v.err, /CONFLICTO: el total vigente \(S\/ \d+(\.\d+)?\) ya no coincide con el que la clienta pagó/);
      assert.deepEqual(await huella(c, p, cup.id), antes, 'sin venta, sin stock descontado, sin consumo del cupón');
      assert.equal(await h.json(`select to_json(estado) from public.pedidos_web where id='${ped.pedidoId}'`), 'PENDIENTE');
    }
  });

  test('sin cambios: pedido con descuento porcentual y tope se verifica y la venta coincide al centavo (lógica compartida)', async () => {
    const { c, p, cup } = await escenario({ costo: 10, transporte: 0, otros: 0, cupon: { valor: 33.33, tipo: 'PORCENTAJE', tope: 12.34 } });
    const ped = await h.crearPedido(c.uid, [p], cup.codigo);
    assert.ok(ped.ok, ped.err);
    const w = await h.json(`select to_json(w) from (select descuento_cupon, total from public.pedidos_web where id='${ped.pedidoId}') w`);
    casi(w.descuento_cupon, 12.34, 'el tope también se aplica en el pedido');
    const v = await h.verificarPagoPedido(ped.pedidoId);
    assert.ok(v.ok, v.err);
    casi(await h.json(`select to_json(total) from public.ventas where id=(select venta_id from public.pedidos_web where id='${ped.pedidoId}')`), w.total);
  });
});
