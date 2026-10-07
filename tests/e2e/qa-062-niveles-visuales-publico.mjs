// QA-062/QA-064 — verificación de interfaz SIN sesión del diseño de cupones por nivel y de su responsive (catálogo de /recompensas,
// que es público). Complementa —no sustituye— la suite Playwright con sesión (qa-recompensas-037-040.spec.mjs, requiere
// QA_TEST_PASSWORD). Solo Supabase Local TEST (verificarLocalTest + red restringida a localhost:5173 y 127.0.0.1:54321).
//
//   node tests/e2e/qa-062-niveles-visuales-publico.mjs
//
// Las filas «de ejemplo» solo se muestran con Recompensas apagado (estado de QA); si el programa estuviera activo el catálogo sería real
// y esta verificación se aborta con un mensaje claro en vez de pasar con otros datos.
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import * as h from './recompensas-fase2-helpers.mjs';
import { appURL, supabaseURL } from './local-safety.mjs';
import { comprobarNivelYEfectosEnCanje, comprobarResponsiveCanje } from './niveles-visuales-helpers.mjs';

await h.verificarLocalTest();
const cfg = await h.configActual();
if (cfg.activo) throw new Error('Recompensas está activo: el catálogo no es el de ejemplo; no se verifica.');

const navegador = await chromium.launch();
let fallos = 0;
async function caso(nombre, cuerpo) {
  const contexto = await navegador.newContext({ baseURL: appURL, timezoneId: 'America/Lima', locale: 'es-PE', viewport: { width: 1280, height: 900 } });
  await contexto.route('**/*', (ruta) => {
    const url = new URL(ruta.request().url());
    if (!['http:', 'https:'].includes(url.protocol)) return ruta.continue();
    return [appURL, supabaseURL].includes(url.origin) ? ruta.continue() : ruta.abort('blockedbyclient');
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(10_000);
  try {
    await cuerpo(page);
    console.log(`✔ ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`✖ ${nombre}\n   ${String(e.message).split('\n').slice(0, 6).join('\n   ')}`);
  } finally {
    await contexto.close();
  }
}

await caso('niveles Plata/Oro/Diamante = nivel de negocio de la fila, con sus efectos (escritorio)', (page) => comprobarNivelYEfectosEnCanje(page, expect));
await caso('responsive 1280: sin desbordes y tarjetas dentro del viewport', (page) => comprobarResponsiveCanje(page, expect, 1280));
await caso('responsive 390: sin desbordes y tarjetas dentro del viewport', (page) => comprobarResponsiveCanje(page, expect, 390));
await navegador.close();
console.log(fallos ? `\n${fallos} caso(s) con fallo.` : '\nTodos los casos aprobados.');
process.exit(fallos ? 1 : 0);
