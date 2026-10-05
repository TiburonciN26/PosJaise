// QA-061 — prueba del ARNÉS en un Chromium real (sin la aplicación, sin Supabase, sin sesiones): un origen ficticio servido por
// route() con una página que reproduce la forma de /promociones (esqueleto aria-hidden → lista / estado vacío / error de consulta)
// y carga sus datos con un fetch que la prueba puede retener. NO es una prueba funcional con sesión real.
//
//   node --test tests/e2e/promociones-admin-navegador.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { localizarPromocion } from './promociones-admin.mjs';

const ORIGEN = 'http://arnes-qa061.invalid';
const OBJETIVO = 'TEST PW arnes-qa061 Promoción';
const PAGINA = `<!doctype html><meta charset="utf-8"><title>arnes</title>
<div class="animate-entrada-pestana" id="p">
  <div><input placeholder="Buscar promoción..."></div>
  <div class="mt-4 grid" aria-hidden="true"><div class="rounded-lg border"><p>esqueleto</p></div></div>
</div>
<script>
fetch('/datos').then(async (r) => {
  const lista = r.ok ? await r.json() : [];
  const p = document.getElementById('p');           // a partir de aquí, todo en el mismo turno (como un único render de React)
  p.querySelector('[aria-hidden]').remove();
  if (!r.ok) { const e = document.createElement('p'); e.textContent = 'No se pudo cargar las promociones.'; p.append(e); }
  if (!lista.length) { const v = document.createElement('div'); v.innerHTML = '<p>No hay promociones registradas.</p><button type="button">+ Nueva promoción</button>'; p.append(v); return; }
  const g = document.createElement('div'); g.className = 'mt-4 grid';
  for (const t of lista) {
    const c = document.createElement('div'); c.className = 'rounded-lg border';
    c.innerHTML = '<div role="button" tabindex="0" aria-expanded="false"><div><p></p></div></div><div hidden><button type="button">Editar</button></div>';
    c.querySelector('p').textContent = t;
    const fila = c.firstElementChild;
    fila.onclick = () => { fila.setAttribute('aria-expanded', 'true'); c.lastElementChild.hidden = false; };
    g.append(c);
  }
  p.append(g);
});
</script>`;

let navegador;
before(async () => { navegador = await chromium.launch({ headless: true }); });
after(async () => { await navegador?.close(); });

// `datos`: lista de títulos o { status } para un fallo; `retener`: deja pendiente la respuesta hasta soltar().
async function prepararPagina({ datos = [], retener = false } = {}) {
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();
  let pendiente = null;
  await contexto.route(`${ORIGEN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/promociones') return route.fulfill({ contentType: 'text/html', body: PAGINA });
    if (pathname === '/datos') {
      const responder = () => (Array.isArray(datos)
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(datos) })
        : route.fulfill({ status: datos.status, contentType: 'application/json', body: '{"message":"fallo simulado"}' }));
      if (retener) { pendiente = responder; return undefined; }
      return responder();
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return { contexto, pagina, soltar: () => pendiente?.(), hayPendiente: () => pendiente !== null };
}
const hasta = async (cond) => { while (!cond()) await new Promise((r) => setTimeout(r, 5)); };

test('lista que tarda: contar en el acto da 0 (fallo de QA-061); localizarPromocion espera la carga y encuentra exactamente 1', async () => {
  const otra = `${OBJETIVO} Q005 extendida`; // un título que CONTIENE al objetivo no debe contar (coincidencia exacta)
  const { contexto, pagina, soltar, hayPendiente } = await prepararPagina({ datos: ['Otra promoción', OBJETIVO, otra], retener: true });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await hasta(hayPendiente);
    assert.equal(await pagina.getByText(OBJETIVO, { exact: true }).count(), 0, 'patrón anterior: con la lista en esqueleto no hay coincidencias');
    let resuelta = false;
    const localizada = localizarPromocion(pagina, OBJETIVO).finally(() => { resuelta = true; });
    // Varios viajes de ida y vuelta a la página con los datos retenidos: la espera sigue pendiente (no concluye «ausente»).
    for (let i = 0; i < 5; i += 1) await pagina.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    assert.equal(resuelta, false, 'no debe resolver ni fallar mientras la lista no cargó');
    soltar();
    const { fila, tarjeta } = await localizada;
    assert.equal(await fila.count(), 1);
    assert.equal(await tarjeta.count(), 1);
    await fila.click();
    await tarjeta.getByRole('button', { name: 'Editar', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await fila.getAttribute('aria-expanded'), 'true');
  } finally { await contexto.close(); }
});

test('título ausente con otras promociones cargadas: error claro', async () => {
  const { contexto, pagina } = await prepararPagina({ datos: ['Otra A', 'Otra B'] });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await assert.rejects(localizarPromocion(pagina, OBJETIVO), /no aparece en \/promociones; se detiene sin escribir/);
  } finally { await contexto.close(); }
});

test('lista vacía: error claro de título ausente', async () => {
  const { contexto, pagina } = await prepararPagina({ datos: [] });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await assert.rejects(localizarPromocion(pagina, OBJETIVO), /no aparece en \/promociones/);
  } finally { await contexto.close(); }
});

test('título duplicado: error claro con el número de coincidencias, sin elegir una', async () => {
  const { contexto, pagina } = await prepararPagina({ datos: [OBJETIVO, 'Otra', OBJETIVO] });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await assert.rejects(localizarPromocion(pagina, OBJETIVO), /aparece 2 veces en \/promociones \(duplicada\)/);
  } finally { await contexto.close(); }
});

test('la consulta falla: error claro de consulta (no se confunde con «ausente»)', async () => {
  const { contexto, pagina } = await prepararPagina({ datos: { status: 500 } });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await assert.rejects(localizarPromocion(pagina, OBJETIVO), /La consulta de \/promociones falló/);
  } finally { await contexto.close(); }
});

test('la lista nunca termina de cargar: error claro de carga al vencer el plazo', async () => {
  const { contexto, pagina, soltar, hayPendiente } = await prepararPagina({ datos: [OBJETIVO], retener: true });
  try {
    await pagina.goto(`${ORIGEN}/promociones`);
    await hasta(hayPendiente);
    await assert.rejects(localizarPromocion(pagina, OBJETIVO, { timeout: 1500 }), /\/promociones no terminó de cargar/);
    soltar();
  } finally { await contexto.close(); }
});
