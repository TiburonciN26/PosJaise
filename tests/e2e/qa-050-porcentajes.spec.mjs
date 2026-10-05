// QA-050: Porcentajes pintaba TODAS las tarjetas de servicio y, dentro de cada una (aunque estuviera colapsada), una fila con un
// input por asistente: con 1758 servicios y 11 asistentes, 211329 nodos y 19339 inputs, una tarea larga de 6528 ms y el buscador
// utilizable a los 8071 ms. Ahora se pintan 50 tarjetas por ventana («Mostrar más») y las filas de asistentes se montan al abrir
// cada tarjeta; los datos siguen completos (QA-046: la búsqueda recorre TODO el catálogo).
// Solo Supabase Local TEST; login por la interfaz normal (ADMINISTRADOR). Mide el MISMO catálogo y estado sin filtrar y adjunta el
// JSON crudo (nodos, inputs, tareas largas, tiempos); no promedia cargas distintas ni borra fixtures. Requiere QA_TEST_PASSWORD
// solo en el proceso. NO ejecutado en la sesión en que se escribió (sin contraseña).
import { test, expect } from './fixtures.mjs';
import { login, createService, sufijoUnico, buscadorSticky } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await h.verificarLocalTest();
});

// Cabecera (botón) de cada tarjeta de servicio de la lista VISIBLE de Porcentajes.
const tarjetasVisibles = (page) => page.locator('div.grid.items-start.gap-3:visible > div > button');

async function instrumentar(page) {
  await page.addInitScript(() => {
    window.__tareasLargas = [];
    try {
      new PerformanceObserver((lista) => lista.getEntries().forEach((e) => window.__tareasLargas.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    } catch {
      /* el navegador sin longtask: queda vacío y se informa */
    }
  });
}

test('Porcentajes sin filtrar: el DOM está acotado, el buscador es utilizable y los datos siguen completos', async ({ page, data }, info) => {
  test.setTimeout(180_000);
  await instrumentar(page);
  await login(page, 'ADMINISTRADOR', data);
  const totalServicios = Number(await h.json(`select to_json(count(*)) from public.servicios`));
  const totalAsistentes = Number(await h.json(`select to_json(count(*)) from public.asistentes where activo`));
  const inicio = Date.now();
  await page.goto('/porcentajes');
  await expect(page.getByText('Cargando servicios...')).toHaveCount(0, { timeout: 60_000 });
  const tarjetasListas = Date.now() - inicio;
  const buscador = await buscadorSticky(page);
  const t0 = Date.now();
  await buscador.fill('TEST'); // interacción real con el catálogo completo cargado
  const tFill = Date.now() - t0;
  await buscador.fill('');
  const medida = await page.evaluate(() => ({
    nodos: document.getElementsByTagName('*').length,
    inputs: document.querySelectorAll('input').length,
    tareasLargasMs: window.__tareasLargas ?? [],
  }));
  const tarjetasPintadas = await tarjetasVisibles(page).count();
  const crudo = { totalServicios, tarjetas: tarjetasPintadas, totalAsistentes, ...medida, msHastaTarjetas: tarjetasListas, msFillBuscador: tFill, hayLongTask: Array.isArray(medida.tareasLargasMs) };
  await info.attach('qa050-medicion-sin-filtrar', { body: Buffer.from(JSON.stringify(crudo, null, 2)), contentType: 'application/json' });
  expect(totalServicios, 'el catálogo del caso es grande (>1000), como en el defecto').toBeGreaterThan(1000);
  // Antes: 211329 nodos y 19339 inputs. Con la ventana de 50 y filas montadas al abrir, el DOM es de otro orden de magnitud.
  expect(crudo.nodos).toBeLessThan(20_000);
  expect(crudo.inputs).toBeLessThan(80);
  expect(crudo.tarjetas).toBe(50);
  expect(Math.max(0, ...crudo.tareasLargasMs), 'ninguna tarea larga cercana a los 6528 ms del defecto').toBeLessThan(2_000);
  await expect(page.getByText(/^Mostrando 50 de \d+ servicios/)).toBeVisible();
});

test('«Mostrar más» agrega otra ventana y la búsqueda encuentra un servicio fuera de la primera ventana (catálogo completo)', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  const servicio = { ...data, serviceName: `${data.prefix} PORC ${sufijoUnico()}` };
  await createService(page, servicio);
  await page.goto('/porcentajes');
  await expect(page.getByText('Cargando servicios...')).toHaveCount(0, { timeout: 60_000 });
  const tarjetas = tarjetasVisibles(page);
  await expect(tarjetas).toHaveCount(50);
  await page.getByRole('button', { name: 'Mostrar más', exact: true }).click();
  await expect(tarjetas).toHaveCount(100);
  // La ficha creada no está necesariamente en la ventana, pero la búsqueda recorre todo el catálogo.
  const buscador = await buscadorSticky(page);
  await buscador.fill(servicio.serviceName);
  await expect(tarjetas.filter({ hasText: servicio.serviceName })).toHaveCount(1);
  await expect(page.getByText(/^Mostrando \d+ de/)).toHaveCount(0); // un solo resultado: sin «Mostrar más»
});

test('las filas de asistentes se montan al abrir la tarjeta y se conservan al cerrarla', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  await page.goto('/porcentajes');
  await expect(page.getByText('Cargando servicios...')).toHaveCount(0, { timeout: 60_000 });
  const filas = page.locator('div.bg-surface-2').filter({ has: page.getByRole('button', { name: 'Desbloquear' }) });
  await expect(filas).toHaveCount(0); // ninguna tarjeta abierta: ninguna fila montada
  const primera = tarjetasVisibles(page).nth(0); // la primera tarjeta de la lista (orden A-Z), no una elegida por ambigüedad
  await primera.click();
  await expect.poll(() => filas.count()).toBeGreaterThan(0);
  const abiertas = await filas.count();
  await primera.click(); // cerrar
  await expect(filas).toHaveCount(abiertas); // se conservan montadas (sin cortar la animación ni perder lo escrito)
});
