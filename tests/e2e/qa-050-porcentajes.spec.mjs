// QA-050 / QA-051: Porcentajes pintaba TODAS las tarjetas de servicio y, dentro de cada una (aunque estuviera colapsada), una
// fila con un input por asistente (con 1758 servicios y 11 asistentes: 211329 nodos y 19339 inputs, una tarea larga de 6528 ms y
// el buscador utilizable a los 8071 ms; cifras de Codex). Ahora se pintan 50 tarjetas por ventana («Mostrar más») y las filas de
// asistentes se montan al abrir cada tarjeta; los datos siguen completos (QA-046: la búsqueda recorre TODO el catálogo).
// QA-051: cada cambio real de búsqueda u orden reinicia la ventana a 50, también al volver a una vista anterior.
//
// Solo Supabase Local TEST; login por la interfaz normal (ADMINISTRADOR). Mide el catálogo sin filtrar y adjunta el JSON crudo
// (nodos, inputs, tareas largas y soporte real de longtask, tiempos); no promedia cargas distintas ni borra fixtures. La
// medición solo vale cuando el estado POSITIVO real se cumple (catálogo cargado, exactamente 50 tarjetas y el contador con el
// total esperado): nunca se da por válido un DOM transitorio. Requiere QA_TEST_PASSWORD solo en el proceso.
import { test, expect } from './fixtures.mjs';
import { login, createService, buscadorSticky, tarjetasPorcentaje } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await h.verificarLocalTest();
});

// Cabecera (botón) de cada tarjeta de servicio de la lista VISIBLE de Porcentajes.
const tarjetasVisibles = tarjetasPorcentaje;
const totalServicios = async () => Number(await h.json(`select to_json(count(*)) from public.servicios`));

// Selector de orden de la página visible: botón «Ordenar por» (aria-label) y opciones por su texto exacto.
async function cambiarOrden(page, etiqueta) {
  const disparador = page.getByRole('button', { name: 'Ordenar por', exact: true });
  await expect(disparador, 'el selector de orden de la página visible es único').toHaveCount(1);
  await disparador.click();
  await page.getByRole('button', { name: etiqueta, exact: true }).click();
}

async function instrumentar(page) {
  await page.addInitScript(() => {
    window.__tareasLargas = [];
    window.__soporteLongtask = typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');
    if (!window.__soporteLongtask) return;
    new PerformanceObserver((lista) => lista.getEntries().forEach((e) => window.__tareasLargas.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
  });
}

// Estado POSITIVO de la lista sin filtrar: 50 tarjetas pintadas y el contador con el total real del catálogo.
async function esperarListaSinFiltrar(page, total) {
  await expect(tarjetasVisibles(page), 'exactamente 50 tarjetas (primera ventana)').toHaveCount(50, { timeout: 90_000 });
  await expect(page.getByText(`Mostrando 50 de ${total} servicios`, { exact: false }), 'contador con el total del catálogo').toBeVisible({ timeout: 90_000 });
}

test('Porcentajes sin filtrar: el DOM está acotado, el buscador es utilizable y los datos siguen completos', async ({ page, data }, info) => {
  test.setTimeout(240_000);
  await instrumentar(page);
  await login(page, 'ADMINISTRADOR', data);
  const total = await totalServicios();
  const totalAsistentes = Number(await h.json(`select to_json(count(*)) from public.asistentes where activo`));
  expect(total, 'el catálogo del caso es grande (>1000), como en el defecto').toBeGreaterThan(1000);

  const inicio = Date.now(); // cronómetro desde la navegación
  await page.goto('/porcentajes');
  await esperarListaSinFiltrar(page, total);
  const msHastaListaCompleta = Date.now() - inicio; // se registra al cumplirse el estado real, no antes
  const buscador = await buscadorSticky(page);

  const t0 = Date.now();
  await buscador.fill('TEST'); // interacción real con el catálogo completo cargado
  await expect(tarjetasVisibles(page).nth(0), 'la lista ya está filtrada por «TEST»').toContainText(/test/i);
  const msFillBuscador = Date.now() - t0;
  await buscador.fill('');
  await esperarListaSinFiltrar(page, total); // vuelve el MISMO estado sin filtrar antes de medir el DOM

  const medida = await page.evaluate(() => ({
    nodos: document.getElementsByTagName('*').length,
    inputs: document.querySelectorAll('input').length,
    tareasLargasMs: window.__tareasLargas ?? [],
    soporteLongtask: Boolean(window.__soporteLongtask),
  }));
  const tarjetas = await tarjetasVisibles(page).count();
  const crudo = { totalServicios: total, totalAsistentes, tarjetas, ...medida, msHastaListaCompleta, msFillBuscador };
  await info.attach('qa050-medicion-sin-filtrar', { body: Buffer.from(JSON.stringify(crudo, null, 2)), contentType: 'application/json' });

  // Antes: 211329 nodos y 19339 inputs. Con la ventana de 50 y filas montadas al abrir, el DOM es de otro orden de magnitud.
  expect(crudo.tarjetas).toBe(50);
  expect(crudo.nodos).toBeLessThan(20_000);
  expect(crudo.inputs).toBeLessThan(80);
  // Las tareas largas solo se pueden afirmar si el navegador las reporta; si no, queda dicho en el JSON y el caso lo señala.
  expect(crudo.soporteLongtask, 'este navegador reporta tareas largas (longtask); sin soporte la ausencia de tareas largas no se prueba').toBe(true);
  expect(Math.max(0, ...crudo.tareasLargasMs), 'ninguna tarea larga cercana a los 6528 ms del defecto').toBeLessThan(2_000);
});

test('«Mostrar más» agrega otra ventana y la búsqueda encuentra un servicio que NO está en la primera ventana (catálogo completo)', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  // «ZZZ …» ordena al final en A-Z: queda fuera de las primeras 50 por construcción, y se comprueba antes de buscar.
  const servicio = { ...data, serviceName: `ZZZ ${data.prefix} PORC ${Date.now().toString(36)}` };
  await createService(page, servicio);
  const total = await totalServicios();
  await page.goto('/porcentajes');
  await esperarListaSinFiltrar(page, total);
  const tarjetas = tarjetasVisibles(page);
  await expect(tarjetas.filter({ hasText: servicio.serviceName }), 'precondición: la ficha NO está entre las primeras 50').toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar más', exact: true }).click();
  await expect(tarjetas).toHaveCount(100);
  await expect(page.getByText(`Mostrando 100 de ${total} servicios`, { exact: false })).toBeVisible();
  const buscador = await buscadorSticky(page);
  await buscador.fill(servicio.serviceName);
  await expect(tarjetas.filter({ hasText: servicio.serviceName })).toHaveCount(1); // la búsqueda recorre TODO el catálogo
  await expect(tarjetas).toHaveCount(1);
  await expect(page.getByText(/^Mostrando \d+ de/)).toHaveCount(0); // un solo resultado: sin «Mostrar más»
});

test('QA-051: cada cambio real de búsqueda u orden reinicia a 50, también al volver a una vista anterior', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const total = await totalServicios();
  await page.goto('/porcentajes');
  await esperarListaSinFiltrar(page, total);
  const tarjetas = tarjetasVisibles(page);
  const buscador = await buscadorSticky(page);

  // A-Z: 50 → Mostrar más → 100.
  await page.getByRole('button', { name: 'Mostrar más', exact: true }).click();
  await expect(tarjetas).toHaveCount(100);

  // Búsqueda exacta (1 resultado) y limpiar: vuelve a 50, NO a 100 (retorno a la clave anterior).
  const nombreExacto = await tarjetas.nth(0).locator('p').innerText();
  await buscador.fill(nombreExacto);
  await expect(tarjetas.filter({ hasText: nombreExacto }).nth(0)).toBeVisible();
  const coincidencias = await tarjetas.count();
  expect(coincidencias, 'la búsqueda exacta reduce la lista').toBeLessThan(50);
  await buscador.fill('');
  await esperarListaSinFiltrar(page, total); // 50 tarjetas y «Mostrando 50 de N»: NO 100

  // Orden Z-A: 50. Volver a A-Z: 50 (no 100). Antes de cambiar de orden se vuelve a abrir una ventana de 100 en A-Z.
  await page.getByRole('button', { name: 'Mostrar más', exact: true }).click();
  await expect(tarjetas).toHaveCount(100);
  await cambiarOrden(page, 'Nombre (Z-A)');
  await expect(tarjetas).toHaveCount(50);
  await expect(page.getByText(`Mostrando 50 de ${total} servicios`, { exact: false })).toBeVisible();
  await cambiarOrden(page, 'Nombre (A-Z)');
  await expect(tarjetas).toHaveCount(50);
  await expect(page.getByText(`Mostrando 50 de ${total} servicios`, { exact: false })).toBeVisible();
});

test('las filas de asistentes se montan al abrir la tarjeta y se conservan al cerrarla', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const total = await totalServicios();
  await page.goto('/porcentajes');
  await esperarListaSinFiltrar(page, total);
  const filas = page.locator('div.bg-surface-2').filter({ has: page.getByRole('button', { name: 'Desbloquear' }) });
  await expect(filas).toHaveCount(0); // ninguna tarjeta abierta: ninguna fila montada
  const primera = tarjetasVisibles(page).nth(0); // la primera tarjeta de la lista (orden A-Z), no una elegida por ambigüedad
  await primera.click();
  await expect.poll(() => filas.count()).toBeGreaterThan(0);
  const abiertas = await filas.count();
  await primera.click(); // cerrar
  await expect(filas).toHaveCount(abiertas); // se conservan montadas (sin cortar la animación ni perder lo escrito)
});
