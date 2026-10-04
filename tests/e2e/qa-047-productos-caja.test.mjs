// QA-047: con más de 1000 productos activos, Caja no encontraba los posteriores al corte por nombre ni por
// código de barras (descargaba productos_vista sin paginar y buscaba sobre esa copia truncada; el stock del
// carrito también salía de ella). Capa de DATOS contra Supabase Local TEST: caracteriza el defecto con la
// consulta anterior y comprueba src/lib/buscarProductosVenta.js; vende la «última unidad» con ADMINISTRADOR y
// CAJERA, y repite el intento en paralelo («doble clic» / dos cajas) comprobando que solo una venta se confirma.
// SQL con claims simulados: NO es una sesión HTTP real ni prueba la interfaz (eso lo cubre
// qa-047-caja.spec.mjs, que requiere QA_TEST_PASSWORD). No se borra ni renombra nada ni se toca max_rows.
//   node --test --test-concurrency=1 tests/e2e/qa-047-productos-caja.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { localServiceKey, supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';
import { buscarProductosVenta, productoPorCodigo, productosPorIds, LIMITE_PRODUCTOS_VENTA } from '../../src/lib/buscarProductosVenta.js';

let sb;
let ultima; // { id, nombre, codigo } stock 1, después del corte por nombre
const codigo = `QA047${h.runId}`.toUpperCase();

async function nombreDe(id) {
  return h.json(`select to_json(nombre) from public.productos where id='${id}'`);
}

before(async () => {
  await h.verificarLocalTest();
  sb = createClient(supabaseURL, localServiceKey(), { auth: { persistSession: false } });
  const total = Number(await h.json(`select to_json(count(*)) from public.productos where activo`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.productos (id, nombre, precio, costo, stock_actual)
      select gen_random_uuid(), 'AAA relleno QA047 ${h.runId} ' || lpad(g::text, 5, '0'), 5, 1, 3
      from generate_series(1, ${1100 - total}) g;`);
    assert.ok(r.ok, r.err);
  }
  const id = await h.nuevoProducto(1, 1, { codigo_barras: codigo });
  const nombre = 'ZZZ ' + (await nombreDe(id));
  assert.ok((await h.admin(`update public.productos set nombre='${nombre}' where id='${id}'`)).ok);
  ultima = { id, nombre, codigo };
});

test('precondición: más de 1000 productos activos y el objetivo queda después de las primeras 1000 por nombre', async () => {
  const { count } = await sb.from('productos_vista').select('id', { count: 'exact', head: true }).eq('activo', true);
  assert.ok(count > 1000, `solo ${count} activos`);
  const { count: antes } = await sb.from('productos_vista').select('id', { count: 'exact', head: true }).eq('activo', true).lt('nombre', ultima.nombre);
  assert.ok(antes >= 1000, `solo ${antes} nombres preceden al objetivo`);
});

test('DEFECTO (consulta anterior): la descarga sin paginar corta en 1000; ni el nombre ni el código lo encuentran', async () => {
  const { data, error } = await sb
    .from('productos_vista')
    .select('id, codigo_barras, nombre, categoria, precio, stock_actual')
    .eq('activo', true)
    .order('nombre');
  assert.equal(error, null);
  assert.equal(data.length, 1000, 'el servidor corta la respuesta en max_rows = 1000');
  assert.equal(data.some((p) => p.id === ultima.id), false);
  assert.equal(data.filter((p) => p.nombre.toLowerCase().includes(ultima.nombre.toLowerCase())).length, 0, 'buscador anterior');
  assert.equal(data.find((p) => p.codigo_barras === ultima.codigo), undefined, 'lookup de código anterior (y del escáner)');
  // La consulta dirigida por identidad sí lo devuelve: el producto existe y es visible.
  const { data: directo } = await sb.from('productos_vista').select('id').eq('id', ultima.id);
  assert.equal(directo.length, 1);
});

test('CORRECCIÓN: la búsqueda por nombre del servidor lo encuentra (completo, parcial, mayúsculas) y está acotada', async () => {
  for (const termino of [ultima.nombre, ultima.nombre.toLowerCase(), ultima.nombre.slice(4, 24), `  ${ultima.nombre} `]) {
    const r = await buscarProductosVenta(sb, termino);
    const f = r.find((p) => p.id === ultima.id);
    assert.ok(f, `no lo encontró con «${termino}»`);
    assert.ok(r.length <= LIMITE_PRODUCTOS_VENTA);
    assert.equal(f.stock_actual, 1);
    assert.equal(Number(f.precio), 1);
  }
  assert.deepEqual(await buscarProductosVenta(sb, '   '), [], 'sin texto no hay sugerencias');
  assert.deepEqual(await buscarProductosVenta(sb, `no-existe-${h.runId}-${Math.random().toString(36).slice(2)}`), []);
});

test('CORRECCIÓN: el código de barras se resuelve por consulta EXACTA (no por coincidencia parcial ni por copia local)', async () => {
  const exacto = await productoPorCodigo(sb, ultima.codigo);
  assert.equal(exacto.producto?.id, ultima.id);
  assert.equal(exacto.ambiguo, false);
  assert.equal((await productoPorCodigo(sb, ` ${ultima.codigo} `)).producto?.id, ultima.id, 'el escáner puede añadir espacios');
  for (const parcial of [ultima.codigo.slice(0, -1), ultima.codigo.toLowerCase(), '%', '']) {
    assert.deepEqual(await productoPorCodigo(sb, parcial), { producto: null, ambiguo: false }, `«${parcial}» no es el código`);
  }
});

test('un producto inactivo no se ofrece ni se escanea; al reactivarlo vuelve (y el ID sigue siendo el mismo)', async () => {
  assert.ok((await h.admin(`update public.productos set activo=false where id='${ultima.id}'`)).ok);
  try {
    assert.equal((await buscarProductosVenta(sb, ultima.nombre)).length, 0);
    assert.equal((await productoPorCodigo(sb, ultima.codigo)).producto, null);
  } finally {
    assert.ok((await h.admin(`update public.productos set activo=true where id='${ultima.id}'`)).ok);
  }
  assert.equal((await productoPorCodigo(sb, ultima.codigo)).producto?.id, ultima.id);
});

test('los comodines del texto son literales y los caracteres especiales no rompen la búsqueda', async () => {
  const barra = String.fromCharCode(92);
  for (const raro of ['%', '_', 'a,b', 'x)y', 'q"r', `p${barra}q`, '*', 'nombre.ilike.x']) {
    const r = await buscarProductosVenta(sb, raro);
    assert.ok(Array.isArray(r), `falló con «${raro}»`);
    assert.ok(r.every((p) => p.nombre.toLowerCase().includes(raro.toLowerCase())), `«${raro}» no se trató como literal`);
  }
});

test('el stock del carrito se consulta por ID y refleja el valor real (no una copia truncada)', async () => {
  const filas = await productosPorIds(sb, [ultima.id]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].stock_actual, 1);
  assert.deepEqual(await productosPorIds(sb, []), []);
  const roto = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('red') }) }) }) };
  await assert.rejects(() => productosPorIds(roto, ['x']), /red/);
});

for (const [rol, uid] of [['ADMINISTRADOR', h.ADMIN], ['CAJERA', h.CAJERA]]) {
  test(`${rol}: última unidad, venta, stock en 0, rechazo de la segunda venta y anulación que devuelve el stock`, async () => {
    const id = await h.nuevoProducto(1, 1);
    const venta = await h.vender({ uid, items: [h.itemProducto(id)] });
    assert.ok(venta.ok, venta.err);
    assert.equal(Number(await h.stock(id)), 0);
    const otra = await h.vender({ uid, items: [h.itemProducto(id)] });
    assert.equal(otra.ok, false);
    assert.match(otra.err, /stock/i);
    assert.equal(Number(await h.stock(id)), 0, 'el rechazo no escribe stock');
    const an = await h.anular(venta.venta.venta_id, h.ADMIN);
    assert.ok(an.ok, an.err);
    assert.equal(Number(await h.stock(id)), 1);
  });
}

test('doble clic / dos cajas en paralelo sobre la última unidad: exactamente UNA venta se confirma', async () => {
  const id = await h.nuevoProducto(1, 1);
  const ventasAntes = Number(await h.json(`select to_json(count(*)) from public.venta_items where producto_id='${id}'`));
  assert.equal(ventasAntes, 0);
  const resultados = await Promise.all([
    h.vender({ uid: h.CAJERA, items: [h.itemProducto(id)] }),
    h.vender({ uid: h.ADMIN, items: [h.itemProducto(id)] }),
    h.vender({ uid: h.CAJERA, items: [h.itemProducto(id)] }),
  ]);
  const ok = resultados.filter((r) => r.ok);
  assert.equal(ok.length, 1, JSON.stringify(resultados.map((r) => r.ok || r.err)));
  assert.equal(Number(await h.stock(id)), 0);
  assert.equal(Number(await h.json(`select to_json(count(*)) from public.venta_items where producto_id='${id}'`)), 1);
  for (const r of resultados.filter((x) => !x.ok)) assert.match(r.err, /stock/i);
});

test('el límite del servidor no se tocó', async () => {
  assert.match(await readFile('supabase/config.toml', 'utf8'), /max_rows\s*=\s*1000/);
});
