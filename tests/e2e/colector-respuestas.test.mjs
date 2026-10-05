// QA-058 — pruebas del colector de respuestas ante NAVEGACIÓN (en memoria, sin navegador): un doble de `page` emite respuestas
// cuyo cuerpo deja de estar disponible (como ocurre al navegar). Nada debe quedar como promesa rechazada sin manejar.
//
//   node --test tests/e2e/colector-respuestas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { colectorRespuestas, cuerpoDeLaCarga, sanearMotivo } from './colector-respuestas.mjs';

const pagina = () => { const e = new EventEmitter(); e.off = e.off.bind(e); return e; };
const respuesta = (url, cuerpo, { falla = false, status = 200 } = {}) => ({
  url: () => url, ok: () => status < 400, status: () => status,
  json: () => (falla ? Promise.reject(new Error('Protocol error: Response body is unavailable for redirect responses\nstack…')) : Promise.resolve(cuerpo)),
});
const esPanel = (r) => r.url().includes('/rpc/resumen_mi_panel') && r.ok();

test('recoge los cuerpos disponibles y registra (saneado) los no disponibles tras navegar, sin rechazos sin manejar', async () => {
  const sinManejar = [];
  const oyente = (e) => sinManejar.push(e);
  process.on('unhandledRejection', oyente);
  try {
    const p = pagina();
    const c = colectorRespuestas(p, esPanel);
    p.emit('response', respuesta('http://x/rpc/resumen_mi_panel', { total: 1 }));
    p.emit('response', respuesta('http://x/rpc/otra', { no: 'cuenta' }));
    p.emit('response', respuesta('http://x/rpc/resumen_mi_panel', null, { falla: true })); // cuerpo perdido al navegar
    const datos = await c.detener();
    await new Promise((r) => setImmediate(r));
    assert.equal(sinManejar.length, 0, 'ninguna promesa rechazada sin manejar');
    assert.equal(datos.length, 2);
    assert.deepEqual(datos.find((d) => d.ok), { ok: true, status: 200, cuerpo: { total: 1 } });
    const perdido = datos.find((d) => !d.ok);
    assert.match(perdido.motivo, /Response body is unavailable/);
    assert.doesNotMatch(perdido.motivo, /\n|stack/);
  } finally { process.off('unhandledRejection', oyente); }
});

test('detener() retira el observador: las respuestas posteriores (otra navegación) ya no se leen', async () => {
  const p = pagina();
  const c = colectorRespuestas(p, esPanel);
  await c.detener();
  assert.equal(p.listenerCount('response'), 0);
  let leida = false;
  p.emit('response', { ...respuesta('http://x/rpc/resumen_mi_panel', {}), json: () => { leida = true; return Promise.resolve({}); } });
  assert.equal(leida, false);
  assert.deepEqual(c.datos, []);
});

test('detener() espera las lecturas en curso y es idempotente', async () => {
  const p = pagina();
  const c = colectorRespuestas(p, esPanel);
  let soltar;
  p.emit('response', { ...respuesta('http://x/rpc/resumen_mi_panel'), json: () => new Promise((r) => { soltar = () => r({ tarde: true }); }) });
  const fin = c.detener();
  soltar();
  assert.deepEqual(await fin, [{ ok: true, status: 200, cuerpo: { tarde: true } }]);
  assert.deepEqual(await c.detener(), [{ ok: true, status: 200, cuerpo: { tarde: true } }]);
});

test('los errores de aplicación no se silencian: un 4xx no coincide con el filtro y el caso decide con sus propias aserciones', async () => {
  const p = pagina();
  const c = colectorRespuestas(p, esPanel);
  p.emit('response', respuesta('http://x/rpc/resumen_mi_panel', { message: 'boom' }, { status: 500 }));
  assert.deepEqual(await c.detener(), []);
  const saneado = sanearMotivo(new Error('Authorization: Bearer eyJa.eyJb.sig'));
  assert.doesNotMatch(saneado, /eyJ/);
  assert.match(saneado, /\[oculto\]/);
});

// ---------------- QA-060: cuerpoDeLaCarga (dobles en memoria; NO son pruebas funcionales con sesión) ----------------
function paginaConMarco() {
  const e = new EventEmitter(); e.off = e.off.bind(e);
  const marco = { nombre: 'principal' };
  e.mainFrame = () => marco;
  return { p: e, marco };
}
const peticion = (url) => ({ url: () => url });
const respuestaDe = (req, cuerpo, { falla = false } = {}) => ({
  request: () => req, url: () => req.url(), status: () => 200,
  json: () => (falla ? Promise.reject(new Error('Protocol error (Network.getResponseBody): No resource with given identifier found')) : Promise.resolve(cuerpo)),
});
const esCupones = (q) => q.url().includes('/rpc/mis_cupones');

test('QA-060 · ignora la respuesta de la página ANTERIOR y devuelve la de esta carga', async () => {
  const { p, marco } = paginaConMarco();
  const vieja = peticion('http://x/rpc/mis_cupones'); // emitida antes de navegar
  p.emit('request', vieja);
  const cuerpo = cuerpoDeLaCarga(p, esCupones);
  // la respuesta vieja llega DESPUÉS de armar el lector (y su cuerpo ya no existe): no debe tomarse
  let leidaVieja = false;
  p.emit('response', { ...respuestaDe(vieja, null, { falla: true }), json: () => { leidaVieja = true; return Promise.reject(new Error('x')); } });
  p.emit('framenavigated', { nombre: 'iframe' }); // un iframe no cuenta
  p.emit('framenavigated', marco);                 // documento nuevo comprometido
  const nueva = peticion('http://x/rpc/mis_cupones');
  p.emit('request', nueva);
  p.emit('response', respuestaDe(nueva, [{ codigo: 'A', estado: 'CANJEADO' }]));
  assert.deepEqual(await cuerpo, [{ codigo: 'A', estado: 'CANJEADO' }]);
  assert.equal(leidaVieja, false, 'la respuesta de la página anterior nunca se lee');
  assert.equal(p.listenerCount('response') + p.listenerCount('request') + p.listenerCount('framenavigated'), 0, 'el lector se retira');
});

test('QA-060 · si el cuerpo de ESTA carga no está disponible, el error se propaga (saneado), no se silencia', async () => {
  const { p, marco } = paginaConMarco();
  const cuerpo = cuerpoDeLaCarga(p, esCupones);
  p.emit('framenavigated', marco);
  const q = peticion('http://x/rpc/mis_cupones');
  p.emit('request', q);
  p.emit('response', respuestaDe(q, null, { falla: true }));
  await assert.rejects(cuerpo, /El cuerpo de la respuesta de esta carga no está disponible: Protocol error \(Network\.getResponseBody\): No resource with given identifier found$/);
});

test('QA-060 · sin respuesta de esta carga: error claro al vencer el plazo (no se cuelga ni se toma otra)', async () => {
  const { p } = paginaConMarco();
  await assert.rejects(cuerpoDeLaCarga(p, esCupones, { timeout: 20 }), /No llegó la respuesta esperada de esta carga/);
  assert.equal(p.listenerCount('response'), 0);
});
