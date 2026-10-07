// QA-078 — la lectura que hace Caja (columnas de Ventas.jsx) devuelve la vigencia a cada rol de personal, sin abrir permisos nuevos.
// Capa SQL con identidad simulada (rol authenticated); NO es E2E con sesión.
//   node --test --test-concurrency=1 tests/e2e/cupones-caja-lectura.test.mjs
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

before(async () => { await h.verificarLocalTest(); });

describe('QA-078 · lectura de Caja: vigente_hasta visible para el personal', () => {
  for (const [rol, uid] of [['ADMINISTRADOR', h.ADMIN], ['CAJERA', h.CAJERA], ['ASISTENTE', h.ASISTENTE]]) {
    test(`${rol}: el select de Caja devuelve vigente_hasta (vencido, vigente y sin vencimiento)`, async () => {
      const c = await h.nuevaClienta();
      const vencido = await h.nuevoCupon(c.clienteId, { valor: 15, tipo: 'PORCENTAJE', vigenteHasta: '2020-01-01T05:00:00Z' });
      const vigente = await h.nuevoCupon(c.clienteId, { valor: 5, vigenteHasta: '2099-01-01T05:00:00Z' });
      const sin = await h.nuevoCupon(c.clienteId, { valor: 5 });
      for (const [cup, esperado] of [[vencido, '2020-01-01T05:00:00+00:00'], [vigente, '2099-01-01T05:00:00+00:00'], [sin, null]]) {
        const r = await h.paso(uid, `select row_to_json(t) from (select valor, tipo_descuento, estado, vigente_hasta, (select nombre from public.clientes where id=c.cliente_id) as cliente from public.cupones c where codigo='${cup.codigo}') t;`, { rol: true });
        assert.ok(r.ok, r.err);
        const fila = JSON.parse(r.out.split('\n').filter(Boolean).pop());
        assert.ok('vigente_hasta' in fila, 'la columna se consulta (no «no consultada»)');
        assert.equal(fila.vigente_hasta === null ? null : new Date(fila.vigente_hasta).toISOString(), esperado === null ? null : new Date(esperado).toISOString());
      }
    });
  }

  test('el backend sigue siendo la autoridad: Caja rechaza el cupón vencido aunque la interfaz se saltara', async () => {
    const c = await h.nuevaClienta();
    const p = await h.nuevoProducto(100, 10, { costo: 10 });
    const cup = await h.nuevoCupon(c.clienteId, { valor: 15, tipo: 'PORCENTAJE', vigenteHasta: '2020-01-01T05:00:00Z' });
    const v = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: cup.codigo });
    assert.equal(v.ok, false);
    assert.match(v.err, /venció/);
    assert.equal(await h.stock(p), 10);
    assert.equal((await h.estadoCupon(cup.id)).estado, 'DISPONIBLE');
  });
});
