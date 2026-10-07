import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { expect } from 'playwright/test';
import { login, logout, createProduct, visibleButton } from './helpers.mjs';
import { qaContext } from './phase2-helpers.mjs';

// Preparación propia de los casos CSV y TICKET (antes leían un archivo
// <runId>-sale.json que creaba OTRO caso del POS y fallaban si corrían antes).
// Crea por UI, en un contexto aislado con orígenes externos bloqueados
// (qaContext), un producto TEST dedicado y una venta de 3 unidades que anula.
// No toca el producto/stock del caso del POS. Idempotente por runId.
export async function ensureAnnulledSale(browser, data) {
  const file = `tests/e2e/results/fixtures/${data.runId}-csv-ticket-sale.json`;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fixture = await crearVentaTest(browser, data, {
    productName: `${data.prefix} Producto CSV TICKET`,
    barcode: `${data.barcode}-CT`,
    anular: true,
  });
  await writeFile(file, JSON.stringify(fixture, null, 2));
  return fixture;
}

// QA-081: venta ACTIVA propia del caso TICKET (producto distinto del de CSV, así
// ninguno depende del estado del otro). Sin caché: el caso la anula él mismo,
// y una venta ya anulada de un intento previo no serviría para reimprimir.
export function crearVentaActiva(browser, data) {
  return crearVentaTest(browser, data, {
    productName: `${data.prefix} Producto TICKET ${Date.now().toString(36)}`,
    barcode: `${data.barcode}-TK${Date.now().toString(36)}`,
    anular: false,
  });
}

async function crearVentaTest(browser, data, { productName, barcode, anular }) {
  await mkdir('tests/e2e/results/fixtures', { recursive: true });
  const context = await qaContext(browser);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const product = { productName, barcode };
    await login(page, 'ADMINISTRADOR', data);
    await createProduct(page, product);
    await logout(page);

    await login(page, 'CAJERA', data);
    await page.goto('/ventas');
    await page.getByRole('searchbox').first().fill(product.productName);
    await page.getByRole('button', { name: new RegExp(product.productName) }).click();
    for (let i = 1; i < 3; i++) await page.getByRole('button', { name: '+', exact: true }).click();
    await page.getByRole('button', { name: 'Yape', exact: true }).click();
    const submitted = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    const response = await submitted;
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const sale = Array.isArray(result) ? result[0] : result;
    expect(sale.total).toBe(3);
    const code = sale.codigo.replace(/^VEN/, 'V');

    await page.reload();
    if (anular) {
      await page.goto('/historial');
      await page.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);
      await page.getByText(code, { exact: true }).filter({ visible: true }).click();
      await visibleButton(page, 'Anular venta').click();
      await visibleButton(page, 'Sí, anular').click();
      await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
    }

    return { runId: data.runId, sale, code, productName: product.productName };
  } finally {
    await context.close();
  }
}
