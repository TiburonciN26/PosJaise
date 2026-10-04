// QA-045: desde la venta 1000 confirmar_venta() fallaba por código duplicado (lpad TRUNCA a 3 caracteres).
// Capa de datos contra Supabase Local TEST; SQL con claims simulados (no es una sesión HTTP real).
//   node --test --test-concurrency=1 tests/e2e/qa-045-codigo-venta.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

before(async () => { await h.verificarLocalTest(); });

test('la causa: lpad(x, 3, 0) trunca los números de 4 dígitos y reproduce un código existente', async () => {
  assert.equal(await h.json(`select to_json('VEN' || lpad('1000', 3, '0'))`), 'VEN100');
  assert.equal(await h.json(`select to_json('VEN' || lpad('100', 3, '0'))`), 'VEN100');
});

test('con la secuencia por encima de 999 una venta nueva se confirma con un código único de 4 o más dígitos', async () => {
  const seq = Number(await h.json(`select to_json(last_value) from public.ventas_codigo_seq`));
  assert.ok(seq >= 1000, `la secuencia está en ${seq}; la prueba exige estar por encima de 999`);
  const p = await h.nuevoProducto(10, 5);
  for (const uid of [h.ADMIN, h.CAJERA]) {
    const r = await h.vender({ uid, items: [h.itemProducto(p)] });
    assert.ok(r.ok, `${uid}: ${r.err}`);
    assert.match(r.venta.codigo, /^VEN\d{4,}$/);
    assert.equal(await h.json(`select to_json(count(*)) from public.ventas where codigo='${r.venta.codigo}'`), 1, 'código único');
  }
});

test('los códigos históricos de 3 dígitos conservan su formato y no hay códigos duplicados', async () => {
  assert.equal(await h.json(`select to_json(count(*) - count(distinct codigo)) from public.ventas`), 0);
  assert.equal(await h.json(`select to_json(count(*)) from public.ventas where codigo !~ '^VEN[0-9]{3,}$'`), 0);
});

test('un rechazo de venta no consume códigos que rompan la unicidad (sin ventas parciales)', async () => {
  const antes = Number(await h.json(`select to_json(count(*)) from public.ventas`));
  const r = await h.vender({ uid: h.ASISTENTE, items: [] });
  assert.equal(r.ok, false);
  assert.equal(Number(await h.json(`select to_json(count(*)) from public.ventas`)), antes);
});
