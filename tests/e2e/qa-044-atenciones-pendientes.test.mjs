// QA-044: «+ Agregar servicio → Atención a cobrar» no encontraba atenciones pendientes fuera de las
// primeras 1000 (max_rows). Capa de DATOS contra Supabase Local TEST:
//  * caracteriza el defecto con la consulta anterior (descarga sin paginar);
//  * comprueba la búsqueda/conteo del servidor (src/lib/buscarAtenciones.js);
//  * cobra, anula y vuelve a cobrar con ADMINISTRADOR y CAJERA (SQL con claims simulados) comprobando el
//    vínculo al registro correcto y la ausencia de doble cobro.
// NO prueba la interfaz del modal (eso lo cubre qa-044-atenciones.spec.mjs, que requiere QA_TEST_PASSWORD).
// La clave de servicio local solo se usa para leer desde este proceso. No se borra ni renombra nada y no se
// toca max_rows.
//   node --test --test-concurrency=1 tests/e2e/qa-044-atenciones-pendientes.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { localServiceKey, supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';
import { buscarAtenciones, contarAtenciones, LIMITE_ATENCIONES } from '../../src/lib/buscarAtenciones.js';

const tag = Date.now().toString(36);
let sb;
let clienta; // { clienteId }
let servicioId;
let nombreServicio;
let nombreClienta;
const registros = {}; // { admin, cajera } ids de atención

before(async () => {
  await h.verificarLocalTest();
  sb = createClient(supabaseURL, localServiceKey(), { auth: { persistSession: false } });

  // Relleno antiguo (se ordena ANTES) hasta superar 1100 pendientes; nunca se borra ni renombra nada.
  const total = Number(await h.json(`select to_json(count(*)) from public.registro_servicios where estado='ACTIVO' and venta_id is null`));
  const servRelleno = await h.nuevoServicio(10);
  const cliRelleno = await h.nuevaClienta({ vinculada: false });
  if (total < 1100) {
    const r = await h.admin(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
      select gen_random_uuid(), '${h.ADMIN}', '${servRelleno}', '${cliRelleno.clienteId}', 10,
             now() - interval '3 years' - (g || ' minutes')::interval, 'ACTIVO' from generate_series(1, ${1100 - total}) g;`);
    assert.ok(r.ok, r.err);
  }

  // Casos nuevos: la fecha es AHORA, así que son las MÁS NUEVAS y quedan al final del orden por fecha.
  clienta = await h.nuevaClienta({ vinculada: false });
  nombreClienta = await h.json(`select to_json(nombre) from public.clientes where id='${clienta.clienteId}'`);
  servicioId = await h.nuevoServicio(25);
  nombreServicio = await h.json(`select to_json(nombre) from public.servicios where id='${servicioId}'`);
  registros.admin = await h.nuevaAtencion(clienta.clienteId, servicioId, 25);
  registros.cajera = await h.nuevaAtencion(clienta.clienteId, servicioId, 30);
});

test('precondición: hay más de 1000 pendientes y los casos quedan fuera de las primeras 1000 por fecha', async () => {
  const total = Number(await h.json(`select to_json(count(*)) from public.registro_servicios where estado='ACTIVO' and venta_id is null`));
  assert.ok(total > 1000, `solo ${total} pendientes`);
  const antes = Number(await h.json(`select to_json(count(*)) from public.registro_servicios r
    where r.estado='ACTIVO' and r.venta_id is null and r.fecha < (select fecha from public.registro_servicios where id='${registros.admin}')`));
  assert.ok(antes >= 1000, `solo ${antes} pendientes preceden al caso`);
});

test('DEFECTO (consulta anterior): la descarga sin paginar corta en 1000 y NO incluye las atenciones del caso', async () => {
  const { data, error } = await sb
    .from('registro_servicios')
    .select('id, servicio_id, cliente_id, precio, fecha, servicios(nombre), clientes(nombre)')
    .eq('estado', 'ACTIVO')
    .is('venta_id', null)
    .order('fecha');
  assert.equal(error, null);
  assert.equal(data.length, 1000, 'el servidor corta la respuesta en max_rows = 1000');
  assert.equal(data.some((a) => a.id === registros.admin || a.id === registros.cajera), false);
});

test('CORRECCIÓN: la búsqueda del servidor encuentra las atenciones por clienta y por servicio', async () => {
  for (const termino of [nombreClienta, nombreClienta.toLowerCase(), nombreServicio, nombreServicio.slice(5)]) {
    const { filas } = await buscarAtenciones(sb, termino);
    const ids = filas.map((a) => a.id);
    assert.ok(ids.includes(registros.admin) && ids.includes(registros.cajera), `no las encontró con «${termino}»`);
    assert.ok(filas.length <= LIMITE_ATENCIONES);
    const f = filas.find((a) => a.id === registros.admin);
    assert.equal(f.cliente_id, clienta.clienteId);
    assert.equal(f.servicio_id, servicioId);
    assert.equal(f.servicios.nombre, nombreServicio);
    assert.equal(f.clientes.nombre, nombreClienta);
  }
});

test('sin texto: lista acotada, determinista y marcada como truncada (nunca parece completa)', async () => {
  const a = await buscarAtenciones(sb, '');
  const b = await buscarAtenciones(sb, '');
  assert.equal(a.filas.length, LIMITE_ATENCIONES);
  assert.equal(a.truncado, true);
  assert.deepEqual(a.filas.map((x) => x.id), b.filas.map((x) => x.id));
  const fechas = a.filas.map((x) => new Date(x.fecha).getTime());
  assert.deepEqual(fechas, [...fechas].sort((x, y) => x - y), 'orden por fecha');
});

test('una búsqueda con pocos resultados no se marca como truncada y un texto inexistente da vacío', async () => {
  const r = await buscarAtenciones(sb, nombreClienta);
  assert.equal(r.truncado, false);
  assert.equal(r.filas.length, 2);
  const nada = await buscarAtenciones(sb, `no-existe-${tag}-${Math.random().toString(36).slice(2)}`);
  assert.deepEqual(nada, { filas: [], truncado: false });
});

test('excluir lo que ya está en el carrito oculta esas atenciones sin tocar las demás', async () => {
  const r = await buscarAtenciones(sb, nombreClienta, { excluirIds: [registros.admin] });
  assert.deepEqual(r.filas.map((a) => a.id), [registros.cajera]);
});

test('el conteo del avisito cuenta todas las pendientes (no solo la primera página) y respeta las exclusiones', async () => {
  const total = Number(await h.json(`select to_json(count(*)) from public.registro_servicios where estado='ACTIVO' and venta_id is null`));
  assert.equal(await contarAtenciones(sb), total);
  assert.ok(total > 1000);
  assert.equal(await contarAtenciones(sb, { excluirIds: [registros.admin, registros.cajera] }), total - 2);
});

test('los comodines del texto son literales y los caracteres especiales no rompen la búsqueda', async () => {
  for (const raro of ['%', '_', 'a,b', 'x)y', 'q"r', 'p\\q', '*', 'servicios.nombre.ilike.x']) {
    const r = await buscarAtenciones(sb, raro);
    assert.ok(Array.isArray(r.filas), `falló con «${raro}»`);
  }
  const pct = await buscarAtenciones(sb, '%');
  assert.ok(pct.filas.every((a) => (a.servicios?.nombre ?? '').includes('%') || (a.clientes?.nombre ?? '').includes('%')));
});

for (const [rol, uid, clave] of [['ADMINISTRADOR', h.ADMIN, 'admin'], ['CAJERA', h.CAJERA, 'cajera']]) {
  test(`${rol}: cobro, vínculo al registro correcto, persistencia, anulación y ausencia de doble cobro`, async () => {
    const id = registros[clave];
    const otro = registros[clave === 'admin' ? 'cajera' : 'admin'];
    const venta = await h.vender({ uid, clienteId: clienta.clienteId, items: [h.itemServicio(id)] });
    assert.ok(venta.ok, venta.err);
    const ventaId = venta.venta.venta_id;

    // Vinculada al registro correcto (y SOLO a ese).
    assert.equal(await h.json(`select to_json(venta_id) from public.registro_servicios where id='${id}'`), ventaId);
    assert.equal(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${otro}'`), true, 'la otra atención no se tocó');
    assert.equal(await h.json(`select to_json(count(*)) from public.venta_items where venta_id='${ventaId}' and tipo='SERVICIO'`), 1);
    // Ya no aparece como pendiente y el conteo baja en 1 (persistencia: se vuelve a consultar).
    const tras = await buscarAtenciones(sb, nombreClienta);
    assert.deepEqual(tras.filas.map((a) => a.id), [otro]);

    // Sin doble cobro: el segundo intento se rechaza y no crea otra venta ni otro vínculo.
    const ventasAntes = Number(await h.json(`select to_json(count(*)) from public.ventas`));
    const doble = await h.vender({ uid, clienteId: clienta.clienteId, items: [h.itemServicio(id)] });
    assert.equal(doble.ok, false);
    assert.match(doble.err, /ya no está disponible para vender/);
    assert.equal(Number(await h.json(`select to_json(count(*)) from public.ventas`)), ventasAntes);
    assert.equal(await h.json(`select to_json(venta_id) from public.registro_servicios where id='${id}'`), ventaId);

    // Anulación: la atención vuelve a estar pendiente y se puede encontrar otra vez.
    const an = await h.anular(ventaId, uid);
    assert.ok(an.ok, an.err);
    assert.equal(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${id}'`), true);
    const vuelta = await buscarAtenciones(sb, nombreClienta);
    assert.ok(vuelta.filas.some((a) => a.id === id));
    assert.equal(vuelta.filas.length, 2);
  });
}

test('el límite del servidor no se tocó', async () => {
  assert.match(await readFile('supabase/config.toml', 'utf8'), /max_rows\s*=\s*1000/);
});
