// QA-046: con más de 1000 servicios, Servicios / Nueva cita / Registrar atención / Deuda / combo no
// encontraban las fichas posteriores al corte (descargaban la tabla sin paginar y filtraban en el navegador).
// Capa de DATOS contra Supabase Local TEST: caracteriza el defecto con la consulta anterior y comprueba las
// funciones nuevas (src/lib/buscarServicios.js, leerPaginado.js). NO prueba la interfaz (eso lo cubre
// qa-046-servicios.spec.mjs, que requiere QA_TEST_PASSWORD). No se borra ni renombra nada ni se toca max_rows.
//   node --test --test-concurrency=1 tests/e2e/qa-046-servicios-catalogo.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { localServiceKey, supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';
import {
  buscarServicios, servicioPorId, consultaListadoServicios, categoriasDeServicios, leerServicios,
  LIMITE_SERVICIOS, TAMANO_PAGINA_SERVICIOS,
} from '../../src/lib/buscarServicios.js';

let sb;
let objetivo; // { id, nombre }
let combinado; // servicio que tiene al objetivo como combo
const categoria = `Cat QA046 ${h.runId}`;

before(async () => {
  await h.verificarLocalTest();
  sb = createClient(supabaseURL, localServiceKey(), { auth: { persistSession: false } });
  const total = Number(await h.json(`select to_json(count(*)) from public.servicios`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.servicios (id, nombre, precio, duracion_min)
      select gen_random_uuid(), 'AAA relleno QA046 ${h.runId} ' || lpad(g::text, 5, '0'), 10 + (g % 7), 15 + (g % 4) * 15
      from generate_series(1, ${1100 - total}) g;`);
    assert.ok(r.ok, r.err);
  }
  // El objetivo se ordena DESPUÉS del corte (nombre «ZZZ…») y tiene categoría y duración propias.
  const id = await h.nuevoServicio(2, null, { duracion_min: 30 });
  const nombre = 'ZZZ ' + await h.json(`select to_json(nombre) from public.servicios where id='${id}'`);
  assert.ok((await h.admin(`update public.servicios set nombre='${nombre}', categoria='${categoria}' where id='${id}'`)).ok);
  objetivo = { id, nombre };
  const idCombo = await h.nuevoServicio(5, null, { duracion_min: 45 });
  assert.ok((await h.admin(`update public.servicios set combo_con='${id}' where id='${idCombo}'`)).ok);
  combinado = idCombo;
});

test('precondición: hay más de 1000 servicios y el objetivo queda después de las primeras 1000 por nombre', async () => {
  const { count } = await sb.from('servicios').select('id', { count: 'exact', head: true });
  assert.ok(count > 1000, `solo ${count} servicios`);
  const { count: antes } = await sb.from('servicios').select('id', { count: 'exact', head: true }).lt('nombre', objetivo.nombre);
  assert.ok(antes >= 1000, `solo ${antes} nombres preceden al objetivo`);
});

test('DEFECTO (consulta anterior): la descarga sin paginar corta en 1000 y NO incluye el servicio', async () => {
  const { data, error } = await sb.from('servicios').select('id, nombre, precio, duracion_min, categoria').order('nombre');
  assert.equal(error, null);
  assert.equal(data.length, 1000, 'el servidor corta la respuesta en max_rows = 1000');
  assert.equal(data.some((s) => s.id === objetivo.id), false);
  // Y el filtrado en el navegador sobre esa copia tampoco lo encuentra (lo que veía el usuario).
  assert.equal(data.filter((s) => s.nombre.toLowerCase().includes(objetivo.nombre.toLowerCase())).length, 0);
});

test('CORRECCIÓN: la búsqueda del servidor encuentra el servicio por nombre completo, parcial y sin importar mayúsculas', async () => {
  for (const termino of [objetivo.nombre, objetivo.nombre.toLowerCase(), objetivo.nombre.slice(4, 24), `  ${objetivo.nombre}  `]) {
    const r = await buscarServicios(sb, termino);
    const f = r.find((s) => s.id === objetivo.id);
    assert.ok(f, `no lo encontró con «${termino}»`);
    assert.ok(r.length <= LIMITE_SERVICIOS);
    assert.equal(f.nombre, objetivo.nombre);
    assert.equal(Number(f.precio), 2);
    assert.equal(f.duracion_min, 30);
    assert.equal(f.categoria, categoria);
  }
});

test('búsqueda: orden determinista, acotada, solo activos, exclusión por ID y ausencia distinguible de error', async () => {
  const a = await buscarServicios(sb, '');
  const b = await buscarServicios(sb, '');
  assert.equal(a.length, LIMITE_SERVICIOS);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
  assert.equal((await buscarServicios(sb, objetivo.nombre, { excluirId: objetivo.id })).some((s) => s.id === objetivo.id), false);
  assert.deepEqual(await buscarServicios(sb, `no-existe-${h.runId}-${Math.random().toString(36).slice(2)}`), []);
  // Inactivo: sigue existiendo para Servicios/edición, pero no se ofrece donde solo cuentan los activos.
  assert.ok((await h.admin(`update public.servicios set activo=false where id='${objetivo.id}'`)).ok);
  try {
    assert.equal((await buscarServicios(sb, objetivo.nombre, { soloActivos: true })).length, 0);
    assert.equal((await buscarServicios(sb, objetivo.nombre)).some((s) => s.id === objetivo.id), true);
  } finally {
    assert.ok((await h.admin(`update public.servicios set activo=true where id='${objetivo.id}'`)).ok);
  }
});

test('los comodines del texto son literales y los caracteres especiales no rompen la búsqueda', async () => {
  const barra = String.fromCharCode(92);
  for (const raro of ['%', '_', 'a,b', 'x)y', 'q"r', `p${barra}q`, '*', 'nombre.ilike.x']) {
    const r = await buscarServicios(sb, raro);
    assert.ok(Array.isArray(r), `falló con «${raro}»`);
    assert.ok(r.every((s) => s.nombre.toLowerCase().includes(raro.toLowerCase())), `«${raro}» no se trató como literal`);
  }
});

test('listado paginado: cada orden recorre TODO el catálogo sin repetir ni saltar filas y encuentra el objetivo', async () => {
  const { count } = await sb.from('servicios').select('id', { count: 'exact', head: true });
  for (const orden of ['nombre-asc', 'nombre-desc', 'precio-asc', 'precio-desc', 'duracion-asc', 'duracion-desc']) {
    const ids = [];
    let filas;
    let desde = 0;
    do {
      const { data, error } = await consultaListadoServicios(sb, { orden, columnas: 'id, nombre, precio, duracion_min' })
        .range(desde, desde + TAMANO_PAGINA_SERVICIOS - 1);
      assert.equal(error, null);
      filas = data;
      ids.push(...filas.map((f) => f.id));
      desde += TAMANO_PAGINA_SERVICIOS;
    } while (filas.length === TAMANO_PAGINA_SERVICIOS);
    assert.equal(ids.length, count, `${orden}: no recorrió todo`);
    assert.equal(new Set(ids).size, count, `${orden}: repite filas`);
    assert.ok(ids.includes(objetivo.id), `${orden}: falta el objetivo`);
  }
});

test('listado: el orden por precio y duración es el pedido y la búsqueda se resuelve en el servidor', async () => {
  const { data: p } = await consultaListadoServicios(sb, { orden: 'precio-desc', columnas: 'id, precio' }).range(0, 49);
  const precios = p.map((f) => Number(f.precio));
  assert.deepEqual(precios, [...precios].sort((x, y) => y - x));
  const { data: d } = await consultaListadoServicios(sb, { orden: 'duracion-asc', columnas: 'id, duracion_min' }).range(0, 49);
  const duraciones = d.map((f) => f.duracion_min ?? 0);
  assert.deepEqual(duraciones, [...duraciones].sort((x, y) => x - y), 'una duración vacía se ordena como 0');
  const { data: b } = await consultaListadoServicios(sb, { termino: objetivo.nombre.toLowerCase(), columnas: 'id, nombre' }).range(0, 49);
  assert.deepEqual(b.map((f) => f.id), [objetivo.id]);
});

test('lectura completa por bloques: devuelve todas las fichas (también las posteriores al corte) o falla', async () => {
  const { count } = await sb.from('servicios').select('id', { count: 'exact', head: true });
  const todos = await leerServicios(sb);
  assert.equal(todos.length, count);
  assert.equal(new Set(todos.map((s) => s.id)).size, count);
  assert.ok(todos.some((s) => s.id === objetivo.id));
  const activos = await leerServicios(sb, { soloActivos: true });
  assert.ok(activos.some((s) => s.id === objetivo.id));
  // Un fallo parcial nunca se presenta como catálogo completo.
  const falla = async () => ({ data: null, error: new Error('red') });
  const roto = { from: () => ({ select: () => ({ order: () => ({ order: () => ({ range: falla }) }) }) }) };
  await assert.rejects(() => leerServicios(roto), /red/);
});

test('categorías: el selector de ModalServicio recibe también las categorías de fichas posteriores al corte', async () => {
  const categorias = await categoriasDeServicios(sb);
  assert.ok(categorias.includes(categoria));
  assert.deepEqual(categorias, [...categorias].sort((a, b) => a.localeCompare(b)));
});

test('edición: la selección guardada (combo) se conserva aunque caiga fuera de los resultados de la búsqueda', async () => {
  const guardado = await h.json(`select to_json(combo_con) from public.servicios where id='${combinado}'`);
  assert.equal(guardado, objetivo.id);
  // La búsqueda inicial (sin texto) NO incluye al objetivo: el selector lo recupera por ID.
  assert.equal((await buscarServicios(sb, '')).some((s) => s.id === guardado), false);
  const ficha = await servicioPorId(sb, guardado);
  assert.equal(ficha.id, objetivo.id);
  assert.equal(ficha.nombre, objetivo.nombre);
  assert.equal(await servicioPorId(sb, '00000000-0000-4000-8000-000000000000'), null);
  // Guardar sin tocar el combo conserva el valor (la UI reenvía el mismo ID).
  assert.ok((await h.admin(`update public.servicios set precio = precio where id='${combinado}'`)).ok);
  assert.equal(await h.json(`select to_json(combo_con) from public.servicios where id='${combinado}'`), objetivo.id);
});

test('el servicio posterior al corte se puede registrar y cobrar con ADMINISTRADOR y CAJERA', async () => {
  const clienta = await h.nuevaClienta({ vinculada: false });
  for (const uid of [h.ADMIN, h.CAJERA]) {
    const registro = await h.nuevaAtencion(clienta.clienteId, objetivo.id, 2);
    const v = await h.vender({ uid, clienteId: clienta.clienteId, items: [h.itemServicio(registro)] });
    assert.ok(v.ok, `${uid}: ${v.err}`);
    assert.equal(await h.json(`select to_json(servicio_id) from public.registro_servicios where id='${registro}'`), objetivo.id);
    assert.equal(await h.json(`select to_json(venta_id) from public.registro_servicios where id='${registro}'`), v.venta.venta_id);
  }
});

test('el límite del servidor no se tocó', async () => {
  assert.match(await readFile('supabase/config.toml', 'utf8'), /max_rows\s*=\s*1000/);
});
