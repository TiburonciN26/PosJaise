// QA-033 (autorización de ventas) y QA-041 (reparto de centavos) sobre el núcleo de
// Recompensas Fase 2. Solo Supabase Local TEST.
//
// NIVEL DE EVIDENCIA: SQL con `set role authenticated` + request.jwt.claims simulado.
// Esto prueba EXECUTE/RLS/lógica de las RPC, pero NO es una sesión HTTP real ni E2E
// (el caso HTTP vive en qa-033-ventas-roles.spec.mjs y requiere QA_TEST_PASSWORD).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg0;
before(async () => { await h.verificarLocalTest(); cfg0 = await h.configActual(); });
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const auth = (uid, sql) => h.paso(uid, sql, { rol: true });
const venta = (uid, clienteId, items, extra = '') => auth(uid, `select row_to_json(t) from public.confirmar_venta('Yape', null, $j$${JSON.stringify(items)}$j$::jsonb, ${clienteId ? `'${clienteId}'::uuid` : 'null'}, 0, 0, null, ${extra || 'null'}, 0) t;`);

async function instantanea(c, ids) {
  const lista = ids.length ? ids.map(i => `'${i}'`).join(',') : "'00000000-0000-0000-0000-000000000000'";
  return h.json(`select jsonb_build_object(
    'ventas', (select count(*) from public.ventas),
    'items', (select count(*) from public.venta_items),
    'estados', (select coalesce(string_agg(estado, ',' order by id), '') from public.ventas where id in (${lista})),
    'stock', (select coalesce(sum(stock_actual),0) from public.productos),
    'cupones', (select coalesce(string_agg(estado, ',' order by id), '') from public.cupones where cliente_id='${c.clienteId}'),
    'pedidos', (select count(*) from public.pedidos_web),
    'mov', (select count(*) from public.recompensas_movimientos),
    'sellos', (select count(*) from public.recompensas_sellos_movs)
  );`);
}

for (const recompensas of [true, false]) {
  describe(`QA-033 con Recompensas ${recompensas ? 'ACTIVO' : 'APAGADO'}`, () => {
    before(async () => { await h.activar(recompensas); });
    after(async () => { await h.activar(true); });

    test('ASISTENTE no vende (simple, con cupón) ni anula; nada cambia', async () => {
      const c = await h.nuevaClienta();
      const p = await h.nuevoProducto(40, 5);
      const cup = await h.nuevoCupon(c.clienteId, { valor: 5 });
      const ok = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)] });
      assert.ok(ok.ok, ok.err);
      const antes = await instantanea(c, [ok.venta.venta_id]);

      const simple = await venta(h.ASISTENTE, c.clienteId, [h.itemProducto(p)]);
      assert.equal(simple.ok, false, 'ASISTENTE no debe poder vender');
      assert.match(simple.err, /Solo el administrador o la cajera pueden registrar ventas/);
      const conCupon = await venta(h.ASISTENTE, c.clienteId, [h.itemProducto(p)], `'${cup.codigo}'`);
      assert.equal(conCupon.ok, false);
      const anula = await auth(h.ASISTENTE, `select public.anular_venta('${ok.venta.venta_id}');`);
      assert.equal(anula.ok, false, 'ASISTENTE no debe poder anular');
      assert.match(anula.err, /Solo el administrador o la cajera pueden anular ventas/);

      assert.deepEqual(await instantanea(c, [ok.venta.venta_id]), antes, 'snapshot idéntico tras los rechazos');
    });

    test('CLIENTE y sin sesión no venden ni anulan; nada cambia', async () => {
      const c = await h.nuevaClienta();
      const p = await h.nuevoProducto(40, 5);
      const ok = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)] });
      const antes = await instantanea(c, [ok.venta.venta_id]);
      const cli = await venta(c.uid, c.clienteId, [h.itemProducto(p)]);
      assert.equal(cli.ok, false);
      const cliAn = await auth(c.uid, `select public.anular_venta('${ok.venta.venta_id}');`);
      assert.equal(cliAn.ok, false);
      const anon = await h.admin(`set role anon; select * from public.confirmar_venta('Yape', null, '[]'::jsonb);`);
      assert.equal(anon.ok, false);
      const anonAn = await h.admin(`set role anon; select public.anular_venta('${ok.venta.venta_id}');`);
      assert.equal(anonAn.ok, false);
      assert.deepEqual(await instantanea(c, [ok.venta.venta_id]), antes);
    });

    test('ADMINISTRADOR y CAJERA siguen vendiendo y anulando; CAJERA no anula otro día', async () => {
      const c = await h.nuevaClienta();
      const p = await h.nuevoProducto(40, 5);
      for (const uid of [h.ADMIN, h.CAJERA]) {
        const v = await venta(uid, c.clienteId, [h.itemProducto(p)]);
        assert.ok(v.ok, v.err);
        const venta1 = JSON.parse(v.out).venta_id;
        const an = await auth(uid, `select public.anular_venta('${venta1}');`);
        assert.ok(an.ok, an.err);
      }
      const v = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)] });
      await h.admin(`update public.ventas set fecha = now() - interval '2 days' where id='${v.venta.venta_id}'`);
      const antes = await instantanea(c, [v.venta.venta_id]);
      const noHoy = await auth(h.CAJERA, `select public.anular_venta('${v.venta.venta_id}');`);
      assert.equal(noHoy.ok, false);
      assert.match(noHoy.err, /Solo puedes anular ventas de hoy/);
      assert.deepEqual(await instantanea(c, [v.venta.venta_id]), antes);
      const admin = await auth(h.ADMIN, `select public.anular_venta('${v.venta.venta_id}');`);
      assert.ok(admin.ok, 'ADMIN sí anula ventas de otro día');
    });
  });
}

describe('QA-041 reparto de centavos', () => {
  const dist = (bases, total) => h.json(`select to_json(public.recompensas_distribuir(array[${bases}]::numeric[], ${total}));`);
  const invariantes = (bases, total, r) => {
    assert.equal(r.length, bases.length);
    let suma = 0;
    r.forEach((d, i) => {
      assert.ok(d >= 0, `descuento ${i} negativo: ${d}`);
      assert.ok(d <= bases[i] + 1e-9, `descuento ${i} (${d}) excede su base ${bases[i]}`);
      if (bases[i] <= 0) assert.equal(d, 0, 'línea excluida recibe cero');
      suma += d;
    });
    assert.ok(Math.abs(suma - total) < 1e-9, `suma ${suma} ≠ ${total}`);
  };

  test('caso reportado: cuatro bases de S/1 y descuento S/0,02', async () => {
    const r = await dist('1,1,1,1', 0.02);
    invariantes([1, 1, 1, 1], 0.02, r);
  });

  const casos = [
    [[1, 1, 1, 1], 0.01], [[1, 1, 1, 1], 0.03], [[1, 1, 1, 1], 4],
    [[0.01, 0.01, 0.01, 0.01, 0.01], 0.03], [[10, 20, 0, 5, 0.5], 12.34],
    [[3, 3, 3], 0.01], [[100, 0.01], 100.01], [[7.77, 0, 1.11, 2.22], 5.55],
    [[1, 2, 3, 4, 5, 6, 7], 0.07], [[0, 0, 5], 5], [[33.33, 33.33, 33.34], 99.99],
  ];
  for (const [bases, total] of casos) {
    test(`invariantes con bases [${bases}] y descuento ${total}`, async () => {
      const r = await dist(bases.join(','), total);
      invariantes(bases, total, r);
      const r2 = await dist(bases.join(','), total);
      assert.deepEqual(r2, r, 'determinista');
    });
  }
});

describe('QA-041 integración: venta real con descuento mínimo y varias líneas', () => {
  before(async () => { await h.activar(true); });

  test('cuatro productos de S/1 con cupón S/0,02: ningún neto sube y las monedas usan el neto', async () => {
    const c = await h.nuevaClienta();
    const ps = await Promise.all([1, 2, 3, 4].map(() => h.nuevoProducto(1)));
    const cup = await h.nuevoCupon(c.clienteId, { valor: 0.02 });
    const r = await h.vender({ clienteId: c.clienteId, items: ps.map(p => h.itemProducto(p)), cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    assert.equal(Number(r.venta.total), 3.98);
    const det = await h.json(`select jsonb_agg(d order by linea) from public.recompensas_venta_detalle d where venta_id='${r.venta.venta_id}'`);
    for (const d of det) {
      assert.ok(Number(d.descuento) >= 0 && Number(d.descuento) <= Number(d.subtotal));
      assert.ok(Number(d.neto) >= 0 && Number(d.neto) <= Number(d.subtotal), `neto ${d.neto}`);
    }
    assert.equal(det.reduce((a, d) => a + Number(d.descuento), 0).toFixed(2), '0.02');
    const s = await h.saldos(c.clienteId);
    assert.ok(Math.abs(Number(s.monedas) - 3.98 * 5 / 40) < 1e-9);
  });

  test('mezcla servicio-producto con tasas distintas y excluidos: monedas sobre el neto por tipo', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(10, { materiales: 0 });
    const at = await h.nuevaAtencion(c.clienteId, serv, 10);
    const p = [await h.nuevoProducto(3), await h.nuevoProducto(3), await h.nuevoProducto(3)];
    const cup = await h.nuevoCupon(c.clienteId, { valor: 1.01, alcance: 'PRODUCTOS' });
    const r = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at), ...p.map(x => h.itemProducto(x))], cupon: cup.codigo });
    assert.ok(r.ok, r.err);
    const det = await h.json(`select jsonb_agg(d order by linea) from public.recompensas_venta_detalle d where venta_id='${r.venta.venta_id}'`);
    assert.equal(Number(det[0].descuento), 0, 'el servicio está excluido por alcance');
    assert.equal(det.slice(1).reduce((a, d) => a + Number(d.descuento), 0).toFixed(2), '1.01');
    for (const d of det) assert.ok(Number(d.neto) <= Number(d.subtotal) && Number(d.neto) >= 0);
    const netoProd = det.slice(1).reduce((a, d) => a + Number(d.neto), 0);
    const esperado = 10 * 5 / 20 + netoProd * 5 / 40;
    assert.ok(Math.abs(Number((await h.saldos(c.clienteId)).monedas) - esperado) < 1e-9);
  });
});
