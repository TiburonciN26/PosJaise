// Separación POS / Web de Servicios y Productos. Capa de DATOS contra Supabase Local TEST (SQL con claims simulados para
// los roles: NO es una sesión HTTP real ni prueba la interfaz; eso lo cubre qa-catalogo-web.spec.mjs, que requiere
// QA_TEST_PASSWORD). Comprueba con los constructores REALES de los formularios (src/lib/catalogoCampos.js):
//  * las columnas de POS y Web son disjuntas y juntas cubren todo lo editable de la ficha;
//  * guardar campos POS conserva los Web y guardar campos Web conserva los POS (alternando);
//  * una ficha nueva se crea solo con campos POS (el contenido Web queda vacío/por defecto);
//  * solo ADMINISTRADOR escribe fichas (regla existente; CAJERA y ASISTENTE no cambian nada);
//  * el portal (CLIENTE) lee el contenido Web guardado.
//   node --test --test-concurrency=1 tests/e2e/catalogo-pos-web.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { localServiceKey, supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';
import { SELECT_PRODUCTOS, SELECT_SERVICIOS } from '../../src/lib/columnasCatalogo.js';
import {
  COLUMNAS_POS_SERVICIO, COLUMNAS_WEB_SERVICIO, COLUMNAS_POS_PRODUCTO, COLUMNAS_WEB_PRODUCTO,
  datosPosServicio, datosWebServicio, datosPosProducto, datosWebProducto,
} from '../../src/lib/catalogoCampos.js';

let sb;
before(async () => {
  await h.verificarLocalTest();
  sb = createClient(supabaseURL, localServiceKey(), { auth: { persistSession: false } });
});

const columnas = (select) => select.split(',').map((c) => c.trim());
const ordenadas = (a) => [...a].sort();

// Formularios «tal como los llena el usuario» (misma forma que el estado de los modales).
const formServicio = {
  nombre: 'TEST F2 pos-web serv', categoriaSeleccionada: 'Cabello', categoriaNueva: '', precio: '25.50', duracionMin: '45',
  descripcion: '  Texto web  ', activo: true, enTendencia: true, aDomicilio: true, costoDomicilio: '7.5', precioVariable: true,
  notaPrecio: 'Depende del largo', duracionResultado: '3-4 meses', comboCon: '',
};
const listas = {
  pasos: [{ nombre: 'Paso 1', minutos: '10', texto: 'Explicación' }, { nombre: '  ', minutos: '', texto: 'vacío' }],
  especificaciones: [{ clave: 'Técnica', valor: 'Mano alzada' }],
  herramientas: [{ nombre: 'Pinza', descripcion: 'fina' }],
  materiales: [{ nombre: 'Gel', descripcion: 'Marca X' }],
  cuidadosAntes: [{ texto: 'Ven con cabello seco' }],
  cuidadosDespues: [{ texto: 'Espera 48 h' }],
};
const formProducto = {
  codigoBarras: '', nombre: 'TEST F2 pos-web prod', categoriaSeleccionada: 'Shampoo', categoriaNueva: '', subcategoria: 'Shampoo',
  costo: '5', precio: '12.50', precioAntes: '15', ofertaHasta: '2026-12-31', stockInicial: '8', proveedor: 'Proveedor Z',
  descripcion: 'Texto web', contenido: '250 ml', rinde: '3 meses', frecuencia: '1 vez por semana', comboCon: '', destacado: true, nuevo: true, enInicio: true,
};
const listasProducto = {
  especificaciones: [{ clave: 'Marca', valor: 'Jaise' }], modoUso: [{ nombre: 'Aplica', texto: 'Con agua' }], idealPara: [{ texto: 'Cabello teñido' }],
  tips: [{ texto: 'Una vez por semana' }], ingredientes: [{ nombre: 'Keratina', texto: 'Repara' }], libreDe: [{ texto: 'Sulfatos' }],
};

test('las columnas POS y Web son disjuntas y juntas cubren todo lo editable de la ficha', () => {
  for (const [pos, web, select, ignorar] of [
    [COLUMNAS_POS_SERVICIO, COLUMNAS_WEB_SERVICIO, SELECT_SERVICIOS, ['id']],
    [COLUMNAS_POS_PRODUCTO, COLUMNAS_WEB_PRODUCTO, SELECT_PRODUCTOS, ['id', 'stock_minimo', 'activo']],
  ]) {
    assert.deepEqual(pos.filter((c) => web.includes(c)), [], 'una columna no puede ser de las dos interfaces');
    const editables = columnas(select).filter((c) => !ignorar.includes(c));
    assert.deepEqual(ordenadas([...pos, ...web]), ordenadas(editables));
  }
});

test('los constructores escriben exactamente su lista de columnas (ni una más, ni una menos)', () => {
  assert.deepEqual(ordenadas(Object.keys(datosPosServicio({ formulario: formServicio, categoriaFinal: 'Cabello' }))), ordenadas(COLUMNAS_POS_SERVICIO));
  assert.deepEqual(ordenadas(Object.keys(datosWebServicio({ formulario: formServicio, fotoFinal: null, ...listas }))), ordenadas(COLUMNAS_WEB_SERVICIO));
  assert.deepEqual(ordenadas(Object.keys(datosPosProducto({ formulario: formProducto, categoriaFinal: 'Shampoo', precio: 12.5, costo: 5 }))), ordenadas(COLUMNAS_POS_PRODUCTO));
  assert.deepEqual(ordenadas(Object.keys(datosWebProducto({ formulario: formProducto, fotoFinal: null, ...listasProducto }))), ordenadas(COLUMNAS_WEB_PRODUCTO));
  // El precio REAL es de POS: el payload Web nunca lo trae.
  assert.equal('precio' in datosWebServicio({ formulario: formServicio, fotoFinal: null, ...listas }), false);
  assert.equal('precio' in datosWebProducto({ formulario: formProducto, fotoFinal: null, ...listasProducto }), false);
});

async function fila(tabla, id, cols) {
  const { data, error } = await sb.from(tabla).select(cols.join(',')).eq('id', id).single();
  assert.equal(error, null);
  return data;
}

test('SERVICIO: alta solo con campos POS (contenido Web vacío) y guardado alternado POS/Web sin pérdida', async () => {
  const nombre = h.nombreUnico('TEST F2 pos-web serv');
  const pos1 = datosPosServicio({ formulario: { ...formServicio, nombre, precio: '10' }, categoriaFinal: 'Cabello' });
  const { data: nuevo, error } = await sb.from('servicios').insert(pos1).select().single();
  assert.equal(error, null);
  // Web vacío por defecto: nada se inventa al crear desde POS.
  assert.deepEqual([nuevo.pasos, nuevo.especificaciones, nuevo.herramientas, nuevo.materiales, nuevo.cuidados_antes, nuevo.cuidados_despues], [[], [], [], [], [], []]);
  assert.equal(nuevo.descripcion, null);
  assert.equal(nuevo.precio_variable, false);
  assert.equal(nuevo.a_domicilio, false);
  assert.equal(nuevo.en_tendencia, false);
  assert.equal(nuevo.foto_url, null);

  // Web guarda su contenido: POS intacto.
  const web = datosWebServicio({ formulario: formServicio, fotoFinal: 'ruta/foto.webp', ...listas });
  assert.equal((await sb.from('servicios').update(web).eq('id', nuevo.id)).error, null);
  const trasWeb = await fila('servicios', nuevo.id, [...COLUMNAS_POS_SERVICIO, ...COLUMNAS_WEB_SERVICIO]);
  for (const c of COLUMNAS_POS_SERVICIO) assert.deepEqual(trasWeb[c], pos1[c], `POS cambió: ${c}`);
  for (const c of COLUMNAS_WEB_SERVICIO) assert.deepEqual(trasWeb[c], web[c], `Web no se guardó: ${c}`);
  assert.equal(trasWeb.pasos.length, 1, 'los pasos vacíos se descartan');

  // POS guarda otros valores: Web intacto (aunque el formulario POS estuviera abierto desde antes).
  const pos2 = datosPosServicio({ formulario: { ...formServicio, nombre: `${nombre} v2`, precio: '99', duracionMin: '', activo: false }, categoriaFinal: 'Uñas' });
  assert.equal((await sb.from('servicios').update(pos2).eq('id', nuevo.id)).error, null);
  const trasPos = await fila('servicios', nuevo.id, [...COLUMNAS_POS_SERVICIO, ...COLUMNAS_WEB_SERVICIO]);
  for (const c of COLUMNAS_POS_SERVICIO) assert.deepEqual(trasPos[c], pos2[c], `POS no se guardó: ${c}`);
  for (const c of COLUMNAS_WEB_SERVICIO) assert.deepEqual(trasPos[c], web[c], `Web se perdió al guardar POS: ${c}`);
  assert.equal(Number(trasPos.precio), 99, 'el precio real es el mismo para POS y portal');
  assert.equal(trasPos.duracion_min, null);

  // Y de vuelta: Web de nuevo, POS conserva lo último guardado.
  const web2 = datosWebServicio({ formulario: { ...formServicio, aDomicilio: false, precioVariable: false, descripcion: '' }, fotoFinal: null, ...listas, pasos: [] });
  assert.equal((await sb.from('servicios').update(web2).eq('id', nuevo.id)).error, null);
  const final = await fila('servicios', nuevo.id, [...COLUMNAS_POS_SERVICIO, ...COLUMNAS_WEB_SERVICIO]);
  for (const c of COLUMNAS_POS_SERVICIO) assert.deepEqual(final[c], pos2[c], `POS cambió al guardar Web: ${c}`);
  assert.equal(final.costo_domicilio, null, 'sin domicilio no hay costo');
  assert.equal(final.nota_precio, null, 'sin precio variable no hay nota');
  assert.equal(final.descripcion, null);
});

test('PRODUCTO: alta solo con campos POS (contenido Web vacío) y guardado alternado POS/Web sin pérdida', async () => {
  const nombre = h.nombreUnico('TEST F2 pos-web prod');
  const pos1 = datosPosProducto({ formulario: { ...formProducto, nombre }, categoriaFinal: 'Shampoo', precio: 12.5, costo: 5 });
  const { data: nuevo, error } = await sb.from('productos').insert({ ...pos1, stock_minimo: 3 }).select('id').single();
  assert.equal(error, null);
  const base = await fila('productos', nuevo.id, [...COLUMNAS_WEB_PRODUCTO]);
  assert.deepEqual([base.especificaciones, base.modo_uso, base.ideal_para, base.tips, base.ingredientes, base.libre_de], [[], [], [], [], [], []]);
  assert.deepEqual([base.precio_antes, base.oferta_hasta, base.descripcion, base.contenido, base.foto_url], [null, null, null, null, null]);
  assert.deepEqual([base.destacado, base.nuevo, base.en_inicio], [false, false, false]);

  const web = datosWebProducto({ formulario: formProducto, fotoFinal: 'ruta/p.webp', ...listasProducto });
  assert.equal((await sb.from('productos').update(web).eq('id', nuevo.id)).error, null);
  const trasWeb = await fila('productos', nuevo.id, [...COLUMNAS_POS_PRODUCTO, ...COLUMNAS_WEB_PRODUCTO]);
  for (const c of COLUMNAS_POS_PRODUCTO) assert.equal(String(trasWeb[c]), String(pos1[c]), `POS cambió: ${c}`);
  for (const c of COLUMNAS_WEB_PRODUCTO) assert.deepEqual(trasWeb[c] == null ? null : trasWeb[c], web[c] ?? null, `Web no se guardó: ${c}`);

  const pos2 = datosPosProducto({ formulario: { ...formProducto, nombre: `${nombre} v2`, stockInicial: '3', proveedor: '' }, categoriaFinal: 'Tinte', precio: 20, costo: 7 });
  assert.equal((await sb.from('productos').update(pos2).eq('id', nuevo.id)).error, null);
  const trasPos = await fila('productos', nuevo.id, [...COLUMNAS_POS_PRODUCTO, ...COLUMNAS_WEB_PRODUCTO]);
  for (const c of COLUMNAS_WEB_PRODUCTO) assert.deepEqual(trasPos[c] == null ? null : trasPos[c], web[c] ?? null, `Web se perdió al guardar POS: ${c}`);
  assert.equal(Number(trasPos.precio), 20);
  assert.equal(trasPos.stock_actual, 3);
  assert.equal(trasPos.proveedor, null);
});

test('la fecha de oferta es informativa: no hay vencimiento automático (el precio real no cambia solo)', async () => {
  const id = await h.nuevoProducto(30, 5);
  const web = datosWebProducto({ formulario: { ...formProducto, precioAntes: '40', ofertaHasta: '2000-01-01' }, fotoFinal: null, ...listasProducto });
  assert.equal((await sb.from('productos').update(web).eq('id', id)).error, null);
  const f = await fila('productos', id, ['precio', 'precio_antes', 'oferta_hasta']);
  assert.equal(Number(f.precio), 30);
  assert.equal(Number(f.precio_antes), 40, 'la fecha vencida no borra el precio anterior ni toca el precio real');
});

for (const [rol, uid] of [['CAJERA', h.CAJERA], ['ASISTENTE', h.ASISTENTE]]) {
  test(`${rol}: no puede escribir fichas de servicios ni de productos (regla existente, sin cambios)`, async () => {
    const idS = await h.nuevoServicio(11, null, { duracion_min: 20 });
    const idP = await h.nuevoProducto(9, 4);
    for (const sql of [
      `update public.servicios set descripcion='intruso', precio=1 where id='${idS}';`,
      `update public.productos set descripcion='intruso', precio=1 where id='${idP}';`,
    ]) {
      await h.paso(uid, sql, { rol: true });
    }
    const s = await fila('servicios', idS, ['descripcion', 'precio']);
    const p = await fila('productos', idP, ['descripcion', 'precio']);
    assert.equal(s.descripcion, null);
    assert.equal(Number(s.precio), 11);
    assert.equal(p.descripcion, null);
    assert.equal(Number(p.precio), 9);
    const alta = await h.paso(uid, `insert into public.servicios (nombre, precio) values ('${h.nombreUnico('TEST F2 intruso')}', 1);`, { rol: true });
    assert.equal(alta.ok, false, 'el alta de una ficha sigue siendo solo de ADMINISTRADOR');
  });
}

test('ADMINISTRADOR (claims simulados) escribe POS y Web; CLIENTE del portal lee el contenido Web guardado', async () => {
  const id = await h.nuevoServicio(15, null, { duracion_min: 30 });
  const web = datosWebServicio({ formulario: { ...formServicio, descripcion: 'Descripción del portal' }, fotoFinal: null, ...listas });
  const sql = `update public.servicios set descripcion=${h.q(web.descripcion)}, precio_variable=true, nota_precio=${h.q(web.nota_precio)} where id='${id}';`;
  const r = await h.paso(h.ADMIN, sql, { rol: true });
  assert.ok(r.ok, r.err);
  const cli = await h.nuevaClienta({ vinculada: true });
  const lectura = await h.paso(cli.uid, `select row_to_json(t) from (select descripcion, precio_variable, nota_precio, precio from public.servicios where id='${id}') t;`, { rol: true });
  assert.ok(lectura.ok, lectura.err);
  const f = JSON.parse(lectura.out.split('\n').filter(Boolean).pop());
  assert.equal(f.descripcion, 'Descripción del portal');
  assert.equal(f.precio_variable, true);
  assert.equal(f.nota_precio, 'Depende del largo');
  assert.equal(Number(f.precio), 15, 'el precio real es el mismo que ve el POS');
});

test('tamaños representativos: contenido Web largo y muchas filas se guardan y se leen íntegros', async () => {
  const id = await h.nuevoServicio(12, null, { duracion_min: 30 });
  const largo = 'Texto largo con acentos áéíóú ñ. '.repeat(300);
  const muchos = Array.from({ length: 60 }, (_, i) => ({ nombre: `Paso ${i + 1}`, minutos: String(i + 1), texto: largo.slice(0, 200) }));
  const web = datosWebServicio({ formulario: { ...formServicio, descripcion: largo }, fotoFinal: null, ...listas, pasos: muchos });
  assert.equal((await sb.from('servicios').update(web).eq('id', id)).error, null);
  const f = await fila('servicios', id, ['descripcion', 'pasos']);
  assert.equal(f.descripcion, largo.trim());
  assert.equal(f.pasos.length, 60);
});
