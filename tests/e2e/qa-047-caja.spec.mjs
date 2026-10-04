// QA-047 en la interfaz: con más de 1000 productos activos, Caja debe encontrar por nombre y por código de barras
// los productos posteriores al corte, vender la última unidad sin sobreventa, y distinguir carga, error y ausencia.
// Solo Supabase Local TEST; login por la interfaz normal (CAJERA y ADMINISTRADOR). Datos: por SQL local, productos
// ficticios «ZZZ …» (después del corte por nombre) y relleno hasta 1100 activos. No se elimina ni renombra nada ni
// se toca max_rows. Requiere QA_TEST_PASSWORD solo en el proceso.
import { test, expect } from './fixtures.mjs';
import { login, visibleButton } from './helpers.mjs';
import { qaContext } from './phase2-helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await h.verificarLocalTest();
  const total = Number(await h.json(`select to_json(count(*)) from public.productos where activo`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.productos (id, nombre, precio, costo, stock_actual)
      select gen_random_uuid(), 'AAA relleno QA047 ${h.runId} ' || lpad(g::text, 5, '0'), 5, 1, 3
      from generate_series(1, ${1100 - total}) g;`);
    if (!r.ok) throw new Error(r.err);
  }
});

// Un producto PROPIO por caso: nombre y código únicos, después del corte por nombre («ZZZ …»).
async function productoCaso(stock) {
  const codigo = `QA047-${h.nombreUnico('C').replace(/[^A-Za-z0-9]/g, '')}`;
  const id = await h.nuevoProducto(1, stock, { codigo_barras: codigo });
  const nombre = 'ZZZ ' + (await h.json(`select to_json(nombre) from public.productos where id='${id}'`));
  await h.admin(`update public.productos set nombre='${nombre}' where id='${id}'`);
  const antes = Number(await h.json(`select to_json(count(*)) from public.productos_vista where activo and nombre < '${nombre}'`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} nombres preceden al producto; hacen falta ≥ 1000.`);
  return { id, nombre, codigo };
}

// Los espacios del filtro viajan como «+» o «%20»: se decodifica antes de comparar.
const decodificada = (peticion) => decodeURIComponent(peticion.url().replace(/\+/g, ' '));
const buscador = (page) => page.getByPlaceholder('Buscar producto o escanear código de barras...');

for (const rol of ['CAJERA', 'ADMINISTRADOR']) {
  test(`${rol}: el producto posterior al corte se busca por nombre, se vende, baja el stock y la segunda venta se rechaza`, async ({ page }) => {
    test.setTimeout(120_000);
    const p = await productoCaso(1);
    await login(page, rol, {});
    await page.goto('/ventas');
    await buscador(page).fill(p.nombre);
    const sugerencia = page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 1 S/`) });
    await expect(sugerencia).toHaveCount(1);
    await sugerencia.click();
    await visibleButton(page, 'Yape').click();
    const vendida = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
    await visibleButton(page, 'Confirmar venta').click();
    const respuesta = await vendida;
    expect(respuesta.ok(), 'el cobro se confirma').toBeTruthy();
    expect(Number(await h.stock(p.id))).toBe(0);
    // Persistencia: tras recargar, la sugerencia muestra stock 0 (no se oculta ni se inventa).
    await page.reload();
    await buscador(page).fill(p.nombre);
    await expect(page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 0 S/`) })).toHaveCount(1);
  });

  test(`${rol}: el código de barras del producto posterior al corte se resuelve con Enter (consulta exacta)`, async ({ page }) => {
    const p = await productoCaso(3);
    await login(page, rol, {});
    await page.goto('/ventas');
    await buscador(page).fill(p.codigo);
    await buscador(page).press('Enter');
    await expect(page.getByText(p.nombre, { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(buscador(page)).toHaveValue('');
    // Un código que no existe NO agrega nada.
    await buscador(page).fill(`${p.codigo}-X`);
    await buscador(page).press('Enter');
    await expect(page.getByText(p.nombre, { exact: true }).filter({ visible: true })).toHaveCount(1);
  });
}

test('búsqueda de producto: ausencia real, error con Reintentar y respuesta vieja descartada', async ({ page }) => {
  const p = await productoCaso(2);
  await login(page, 'CAJERA', {});
  await page.goto('/ventas');
  await buscador(page).fill(`no-existe-${h.runId}`);
  await expect(page.getByText('No hay productos que coincidan.', { exact: true })).toBeVisible();

  await page.route('**/rest/v1/productos_vista?*ilike*', (route) => route.abort('failed'));
  await buscador(page).fill(`falla ${h.runId}`);
  await expect(page.getByText('No se pudo buscar productos', { exact: false })).toBeVisible();
  await expect(page.getByText('No hay productos que coincidan.', { exact: true })).toHaveCount(0);
  await page.unroute('**/rest/v1/productos_vista?*ilike*');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('No se pudo buscar productos', { exact: false })).toHaveCount(0);

  // Respuesta vieja: la petición del texto PARCIAL se retiene; la del nombre completo responde antes.
  const estado = { interceptada: false, liberada: false };
  const prefijo = p.nombre.slice(0, p.nombre.length - 3);
  await page.route('**/rest/v1/productos_vista?*', async (route) => {
    if (!estado.interceptada && route.request().url().includes('ilike') && decodificada(route.request()).includes(prefijo + '%')) {
      estado.interceptada = true;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, 1800));
      estado.liberada = true;
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  await buscador(page).fill(prefijo);
  await expect.poll(() => estado.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador(page).fill(p.nombre);
  await expect(page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 2 S/`) })).toHaveCount(1);
  await expect.poll(() => estado.liberada, { message: 'la respuesta retenida se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  await expect(page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 2 S/`) })).toHaveCount(1);
});

test('stock: no se puede agregar más unidades que el stock real aunque el producto esté fuera del corte', async ({ page }) => {
  const p = await productoCaso(1);
  await login(page, 'CAJERA', {});
  await page.goto('/ventas');
  await buscador(page).fill(p.nombre);
  const sugerencia = page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 1 S/`) });
  await sugerencia.click();
  await buscador(page).fill(p.nombre);
  await page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 1 S/`) }).click();
  await expect(page.getByText('Stock máx: 1', { exact: false }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText('Stock insuficiente', { exact: false })).toHaveCount(0);
});

test('última unidad: dos cajas confirman a la vez y exactamente UNA venta se acepta (la otra recibe «Stock insuficiente»)', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const p = await productoCaso(1);
  const preparar = async (tab, rol) => {
    await login(tab, rol, {});
    await tab.goto('/ventas');
    await buscador(tab).fill(p.nombre);
    await tab.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 1 S/`) }).click();
    await visibleButton(tab, 'Yape').click();
    await expect(visibleButton(tab, 'Confirmar venta')).toBeEnabled();
  };
  await preparar(page, 'CAJERA');
  const contexto = await qaContext(browser);
  try {
    const otra = await contexto.newPage();
    await preparar(otra, 'ADMINISTRADOR');
    const retenidas = [];
    let ambas;
    const listas = new Promise((r) => { ambas = r; });
    for (const tab of [page, otra]) {
      await tab.route('**/rpc/confirmar_venta', (route) => {
        retenidas.push(route);
        if (retenidas.length === 2) ambas();
      });
    }
    const respuestas = [page, otra].map((tab) => tab.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta')));
    await Promise.all([page, otra].map((tab) => visibleButton(tab, 'Confirmar venta').click()));
    await listas; // las dos peticiones están retenidas: se liberan juntas
    await Promise.all(retenidas.map((ruta) => ruta.continue()));
    const resultados = await Promise.all((await Promise.all(respuestas)).map(async (r) => ({ ok: r.ok(), cuerpo: await r.json() })));
    await info.attach('ultima-unidad', { body: Buffer.from(JSON.stringify({ producto: p.id, resultados })), contentType: 'application/json' });
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok).cuerpo.message).toContain('Stock insuficiente');
    expect(Number(await h.stock(p.id))).toBe(0);
    expect(Number(await h.json(`select to_json(count(*)) from public.venta_items where producto_id='${p.id}'`))).toBe(1);
  } finally {
    await contexto.close();
  }
});

test('doble clic en Confirmar venta: se crea UNA sola venta y se resta UNA unidad', async ({ page }) => {
  const p = await productoCaso(2);
  await login(page, 'CAJERA', {});
  await page.goto('/ventas');
  await buscador(page).fill(p.nombre);
  await page.getByRole('button', { name: new RegExp(`^${p.nombre} Stock: 2 S/`) }).click();
  await visibleButton(page, 'Yape').click();
  const peticiones = [];
  page.on('request', (r) => { if (r.url().includes('/rpc/confirmar_venta')) peticiones.push(r.method()); });
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
  await visibleButton(page, 'Confirmar venta').dblclick();
  expect((await enviada).ok()).toBeTruthy();
  await page.waitForTimeout(500);
  expect(peticiones).toHaveLength(1);
  expect(Number(await h.stock(p.id))).toBe(1);
  expect(Number(await h.json(`select to_json(count(*)) from public.venta_items where producto_id='${p.id}'`))).toBe(1);
});
