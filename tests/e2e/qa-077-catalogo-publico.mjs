// QA-077 — verificación SIN sesión, en navegador real, de la comprobación conjunta con el catálogo público GRANDE de Local TEST
// (cientos de premios «TEST F2» activos; no se reducen ni se desactivan). Activa Recompensas solo durante la prueba y lo restaura siempre.
//   node tests/e2e/qa-077-catalogo-publico.mjs
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import * as h from './recompensas-fase2-helpers.mjs';
import { appURL, supabaseURL } from './local-safety.mjs';
import { comprobarCanjeBloqueadoSinSesion } from './catalogo-publico-botones.mjs';

await h.verificarLocalTest();
const cfg0 = await h.configActual();
const navegador = await chromium.launch();
let codigo = 0;
try {
  await h.activar(true);
  const contexto = await navegador.newContext({ baseURL: appURL, timezoneId: 'America/Lima', locale: 'es-PE', viewport: { width: 1280, height: 900 } });
  await contexto.route('**/*', (ruta) => {
    const url = new URL(ruta.request().url());
    if (!['http:', 'https:'].includes(url.protocol)) return ruta.continue();
    return [appURL, supabaseURL].includes(url.origin) ? ruta.continue() : ruta.abort('blockedbyclient');
  });
  const page = await contexto.newPage();
  const consultas = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === supabaseURL) consultas.push(u.pathname); });
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/rpc/catalogo_recompensas_publico') && r.ok());
  const t0 = Date.now();
  await page.goto('/recompensas?seccion=canje');
  const catalogo = await respuesta;
  const filas = await (await catalogo.json());
  const t1 = Date.now();
  const r = await comprobarCanjeBloqueadoSinSesion(page, expect, catalogo);
  const t2 = Date.now();
  console.log(`✔ ${filas.length} filas públicas (${filas.filter((f) => f.origen === 'MONEDAS').length} MONEDAS, ${filas.filter((f) => f.origen === 'SELLOS').length} SELLOS); ${r.deshabilitados} botones deshabilitados, ${r.habilitados} habilitados; carga ${t1 - t0} ms, comprobación conjunta ${t2 - t1} ms`);
  const personales = consultas.filter((p) => /\/rpc\/(mis_|mi_|canjear)/.test(p));
  if (personales.length) throw new Error(`consultas personales sin sesión: ${personales}`);
  if (!consultas.some((p) => p.endsWith('/rpc/catalogo_recompensas_publico'))) throw new Error('no se consultó el catálogo público');
  console.log('✔ cero consultas personales; consulta al catálogo público presente');
  await contexto.close();
} catch (e) {
  codigo = 1;
  console.log(`✖ ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`);
} finally {
  await navegador.close();
  await h.restaurarConfig(cfg0);
  const c = await h.configActual();
  console.log(`restauración: activo=${c.activo}`);
}
process.exit(codigo);
