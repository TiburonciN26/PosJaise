// QA-058 — pruebas del colector de respuestas ante NAVEGACIÓN (en memoria, sin navegador): un doble de `page` emite respuestas
// cuyo cuerpo deja de estar disponible (como ocurre al navegar). Nada debe quedar como promesa rechazada sin manejar.
//
//   node --test tests/e2e/colector-respuestas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { colectorRespuestas, sanearMotivo } from './colector-respuestas.mjs';

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
