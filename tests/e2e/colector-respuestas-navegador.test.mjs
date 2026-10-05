// QA-060 — prueba del ARNÉS en un Chromium real (sin la aplicación, sin Supabase, sin sesiones): un origen ficticio servido por
// page.route() con una página que pide «/rpc/mis_cupones» al cargar. NO es una prueba funcional con sesión real.
//
//   node --test tests/e2e/colector-respuestas-navegador.test.mjs
//
// Reproduce el patrón anterior de readCoupon (esperar la respuesta, NAVEGAR y después leer el cuerpo) y comprueba que
// cuerpoDeLaCarga() devuelve siempre el cuerpo de la carga comprobada, aunque la página anterior responda tarde.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cuerpoDeLaCarga } from './colector-respuestas.mjs';

const ORIGEN = 'http://arnes-qa060.invalid';
let navegador;
before(async () => { navegador = await chromium.launch({ headless: true }); });
after(async () => { await navegador?.close(); });

// Cada carga del documento lleva su número; la respuesta de mis_cupones lo devuelve. `retener(n)` deja pendiente la de la carga n.
async function prepararPagina({ retener = new Set() } = {}) {
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();
  let carga = 0;
  const pendientes = new Map();
  await contexto.route(`${ORIGEN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ofertas') {
      carga += 1;
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>arnes</title><script>fetch('/rpc/mis_cupones?carga=${carga}')</script>` });
    }
    if (url.pathname === '/rpc/mis_cupones') {
      const n = Number(url.searchParams.get('carga'));
      const responder = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ carga: n }]) });
      if (retener.has(n)) { pendientes.set(n, responder); return undefined; }
      return responder();
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return { contexto, pagina, soltar: (n) => pendientes.get(n)?.(), hayPendiente: (n) => pendientes.has(n) };
}
const esCupones = (q) => q.url().includes('/rpc/mis_cupones');
const hasta = async (cond) => { while (!cond()) await new Promise((r) => setTimeout(r, 5)); };

test('patrón ANTERIOR: la respuesta que espera readCoupon es la de la página previa (carga 1), no la de la carga comprobada', async () => {
  // Observado al preparar esta prueba: leer después ese cuerpo (r.json()) queda colgado ~90 s y termina en «Page crashed»;
  // en la suite real Codex vio «No resource with given identifier found». Aquí solo se comprueba la ligadura incorrecta,
  // que es la causa: no se lee el cuerpo para no colgar la prueba.
  const { contexto, pagina, soltar, hayPendiente } = await prepararPagina({ retener: new Set([1]) });
  try {
    await pagina.goto(`${ORIGEN}/ofertas`);
    await hasta(() => hayPendiente(1));
    const esperada = pagina.waitForResponse((r) => r.url().includes('/rpc/mis_cupones'));
    soltar(1);                                   // la página ANTERIOR responde justo ahora
    await pagina.goto(`${ORIGEN}/ofertas`);      // carga 2 (la que se quiere comprobar)
    const r = await esperada;
    assert.match(r.url(), /carga=1$/, 'el patrón anterior toma la respuesta de la página previa');
  } finally { await contexto.close(); }
});

test('cuerpoDeLaCarga: con la página anterior respondiendo tarde, devuelve el cuerpo de ESTA carga (carga 2)', async () => {
  const { contexto, pagina, soltar, hayPendiente } = await prepararPagina({ retener: new Set([1]) });
  try {
    await pagina.goto(`${ORIGEN}/ofertas`);
    await hasta(() => hayPendiente(1));
    const cuerpo = cuerpoDeLaCarga(pagina, esCupones);
    soltar(1);
    await pagina.goto(`${ORIGEN}/ofertas`);
    assert.deepEqual(await cuerpo, [{ carga: 2 }]);
  } finally { await contexto.close(); }
});

test('cuerpoDeLaCarga: navegación al mismo URL sin respuestas tardías también devuelve la carga nueva', async () => {
  const { contexto, pagina } = await prepararPagina();
  try {
    await pagina.goto(`${ORIGEN}/ofertas`);
    const cuerpo = cuerpoDeLaCarga(pagina, esCupones);
    await pagina.goto(`${ORIGEN}/ofertas`);
    assert.deepEqual(await cuerpo, [{ carga: 2 }]);
  } finally { await contexto.close(); }
});

test('cuerpoDeLaCarga: si la carga comprobada no responde, falla con un error claro (no toma otra respuesta)', async () => {
  const { contexto, pagina, soltar, hayPendiente } = await prepararPagina({ retener: new Set([2]) });
  try {
    await pagina.goto(`${ORIGEN}/ofertas`);
    const cuerpo = cuerpoDeLaCarga(pagina, esCupones, { timeout: 1500 });
    await pagina.goto(`${ORIGEN}/ofertas`);
    await assert.rejects(cuerpo, /No llegó la respuesta esperada de esta carga/);
    await hasta(() => hayPendiente(2));
    soltar(2);
  } finally { await contexto.close(); }
});
