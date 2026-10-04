// QA-043: «Registrar atención → Buscar cliente» no encontraba clientas fuera de la primera
// página del servidor (max_rows = 1000) y ofrecía crearlas de nuevo.
//
// Esta prueba es de la CAPA DE DATOS (la búsqueda que usa el modal), contra Supabase Local TEST:
//  * caracteriza el defecto con la consulta anterior (descarga sin paginar → la clienta falta);
//  * comprueba que la búsqueda nueva (src/lib/buscarClientes.js) sí la encuentra.
// NO prueba la interfaz del modal: eso lo cubre qa-043-registrar-atencion.spec.mjs (Playwright,
// requiere QA_TEST_PASSWORD). Usa la clave de servicio local solo para leer, desde este proceso;
// nunca se escribe en archivos ni se pasa a un navegador. No se borra ni renombra ningún dato y
// no se cambia el límite del servidor.
//   node --test --test-concurrency=1 tests/e2e/qa-043-clientes-busqueda.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { localServiceKey, supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';
import { buscarClientes, patronIlike } from '../../src/lib/buscarClientes.js';

let sb;
let objetivo; // { id, nombre }
const tag = Date.now().toString(36);

before(async () => {
  await h.verificarLocalTest();
  sb = createClient(supabaseURL, localServiceKey(), { auth: { persistSession: false } });
  // Clienta ficticia que, ordenada por nombre, queda DESPUÉS de la posición 1000. Si hace falta
  // se añaden clientas de relleno (nunca se elimina ni se renombra nada).
  const total = Number(await h.json(`select to_json(count(*)) from public.clientes`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.clientes (id, nombre)
      select gen_random_uuid(), 'TEST F2 relleno ' || ${tag.length} || '-' || g from generate_series(1, ${1100 - total}) g;`);
    assert.ok(r.ok, r.err);
  }
  const id = crypto.randomUUID();
  objetivo = { id, nombre: `ZZZ TEST F2 qa043 ${tag}` };
  const r = await h.admin(`insert into public.clientes (id, nombre) values ('${id}', '${objetivo.nombre}');`);
  assert.ok(r.ok, r.err);
});

test('precondición: la clienta queda fuera de los primeros 1000 registros ordenados por nombre', async () => {
  const antes = Number(await h.json(`select to_json(count(*)) from public.clientes where nombre < '${objetivo.nombre}'`));
  assert.ok(antes >= 1000, `solo ${antes} clientas la preceden; hacen falta ≥ 1000`);
});

test('DEFECTO (consulta anterior): la descarga sin paginar no incluye a la clienta y la lista queda cortada en 1000', async () => {
  const { data, error } = await sb.from('clientes').select('id, nombre').order('nombre');
  assert.equal(error, null);
  assert.equal(data.length, 1000, 'el servidor corta la respuesta en max_rows = 1000');
  assert.equal(data.some((c) => c.id === objetivo.id), false, 'la clienta existe pero no llega al navegador');
});

test('CORRECCIÓN: buscarClientes encuentra a la clienta por nombre completo, parcial y sin importar mayúsculas', async () => {
  for (const termino of [objetivo.nombre, objetivo.nombre.toLowerCase(), `qa043 ${tag}`, `  ${tag}  `]) {
    const r = await buscarClientes(sb, termino);
    assert.ok(r.some((c) => c.id === objetivo.id), `no encontró con «${termino}»`);
    assert.ok(r.length <= 20, 'la respuesta está acotada');
  }
});

test('la búsqueda es determinista y acotada; sin texto devuelve la primera página pequeña', async () => {
  const a = await buscarClientes(sb, '');
  const b = await buscarClientes(sb, '');
  assert.equal(a.length, 20);
  assert.deepEqual(a, b);
});

test('un nombre inexistente no devuelve nada (el modal puede ofrecer el alta legítima)', async () => {
  const r = await buscarClientes(sb, `no-existe-${tag}-${Math.random().toString(36).slice(2)}`);
  assert.deepEqual(r, []);
});

test('los comodines de LIKE del texto se tratan como literales', async () => {
  assert.equal(patronIlike('50%_a\\b'), '%50\\%\\_a\\\\b%');
  const todos = await buscarClientes(sb, '%');
  assert.ok(todos.every((c) => c.nombre.includes('%')), '«%» no debe comportarse como comodín');
  const guion = await buscarClientes(sb, '_');
  assert.ok(guion.every((c) => c.nombre.includes('_')), '«_» no debe comportarse como comodín');
});

test('el límite del servidor no se tocó', async () => {
  const toml = await (await import('node:fs/promises')).readFile('supabase/config.toml', 'utf8');
  assert.match(toml, /max_rows\s*=\s*1000/);
});

// ---------------------------------------------------------------------------------------------
// Caja → Seleccionar cliente busca por nombre O teléfono (conTelefono) y debe cubrir el mismo hueco.
// ---------------------------------------------------------------------------------------------
import { valorCitado } from '../../src/lib/buscarClientes.js';

let caja; // { id, nombre, telefono }
test('Caja: precondición — una clienta con teléfono queda fuera de los primeros 1000', async () => {
  const id = crypto.randomUUID();
  const telefono = `9${String(Date.now()).slice(-8)}`;
  caja = { id, nombre: `ZZZ TEST F2 qa043 caja ${tag}`, telefono };
  const r = await h.admin(`insert into public.clientes (id, nombre, telefono) values ('${id}', '${caja.nombre}', '${telefono}');`);
  assert.ok(r.ok, r.err);
  const antes = Number(await h.json(`select to_json(count(*)) from public.clientes where nombre < '${caja.nombre}'`));
  assert.ok(antes >= 1000);
});

test('DEFECTO (consulta anterior de Caja): nombre, id y teléfono descargados sin paginar no incluyen a la clienta', async () => {
  const { data, error } = await sb.from('clientes').select('id, nombre, telefono').order('nombre');
  assert.equal(error, null);
  assert.equal(data.length, 1000);
  assert.equal(data.some((c) => c.id === caja.id), false);
});

test('CORRECCIÓN: la búsqueda de Caja encuentra por nombre y por teléfono (completo o parcial) y trae el teléfono', async () => {
  for (const termino of [caja.nombre, `qa043 caja ${tag}`, caja.telefono, caja.telefono.slice(-6)]) {
    const r = await buscarClientes(sb, termino, { conTelefono: true });
    const fila = r.find((c) => c.id === caja.id);
    assert.ok(fila, `no encontró con «${termino}»`);
    assert.equal(fila.telefono, caja.telefono);
    assert.ok(r.length <= 20);
  }
});

test('el ID devuelto es el de la ficha existente y no se crea un duplicado por buscar', async () => {
  const r = await buscarClientes(sb, caja.nombre, { conTelefono: true });
  assert.equal(r.filter((c) => c.nombre === caja.nombre).length, 1);
  assert.equal(r[0].id, caja.id);
  assert.equal(Number(await h.json(`select to_json(count(*)) from public.clientes where nombre='${caja.nombre}'`)), 1);
});

test('caracteres especiales del texto no rompen el filtro or=() ni se interpretan como sintaxis', async () => {
  for (const raro of ['a,b', 'x)y', '(z', 'q"r', 'p\\q', '50%', 'a_b', 'nombre.ilike.x', '*', '']) {
    const r = await buscarClientes(sb, raro, { conTelefono: true });
    assert.ok(Array.isArray(r), `falló con «${raro}»`);
  }
  assert.equal(valorCitado('a"b\\c'), '"a\\"b\\\\c"');
  // «%» literal no es comodín: solo devuelve nombres o teléfonos que lo contienen
  const r = await buscarClientes(sb, '%', { conTelefono: true });
  assert.ok(r.every((c) => c.nombre.includes('%') || (c.telefono ?? '').includes('%')));
});

test('la búsqueda de Caja sin texto devuelve una página pequeña, estable y con teléfono', async () => {
  const a = await buscarClientes(sb, '', { conTelefono: true });
  const b = await buscarClientes(sb, '', { conTelefono: true });
  assert.equal(a.length, 20);
  assert.deepEqual(a, b);
  assert.ok('telefono' in a[0]);
});
