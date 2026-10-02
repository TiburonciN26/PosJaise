import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import { login } from './helpers.mjs';
import { readFile, writeFile } from 'node:fs/promises';

test('POS: venta de 3 unidades, stock 10→7→10 y anulación persistente', async ({ page, data }, info) => {
  test.setTimeout(90_000);
  await login(page, 'CAJERA', data);
  async function assertStock(expected) {
    await page.goto('/inventario');
    await page.getByPlaceholder('Buscar producto...').fill(data.saleProductName);
    const row = page.getByRole('row').filter({ hasText: data.saleProductName });
    // CAJERA columns: Producto, Categoría, Precio, Stock, Acciones.
    await expect(row.getByRole('cell').nth(3)).toHaveText(String(expected));
    await page.reload();
    await page.getByPlaceholder('Buscar producto...').fill(data.saleProductName);
    await expect(page.getByRole('row').filter({ hasText: data.saleProductName }).getByRole('cell').nth(3)).toHaveText(String(expected));
  }
  await assertStock(10);
  await page.goto('/ventas');
  const search = page.getByRole('searchbox').first();
  await search.fill(data.saleProductName);
  await page.getByRole('button', { name: new RegExp(data.saleProductName) }).click();
  await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '−', exact: true })).toHaveCount(0);
  // Fill to stock bound, verify disabled +, then choose three units.
  for (let i = 1; i < 10; i++) await page.getByRole('button', { name: '+', exact: true }).click();
  await expect(page.getByRole('button', { name: '+', exact: true })).toBeDisabled();
  for (let i = 10; i > 3; i--) await page.getByRole('button', { name: '−', exact: true }).click();
  await page.getByRole('button', { name: 'Efectivo', exact: true }).click();
  // There is also an editable item price with placeholder 0.00. Scope to
  // the visible Recibido label's container, not to all monetary inputs.
  await page.locator('label').filter({ hasText: /^Recibido$/ }).locator('..').getByPlaceholder('0.00', { exact: true }).fill('2');
  await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const submitted = page.waitForResponse(r => r.url().includes('/rpc/confirmar_venta'));
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  const response = await submitted;
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  const sale = Array.isArray(result) ? result[0] : result;
  expect(sale.total).toBe(3);
  const code = sale.codigo.replace(/^VEN/, 'V');
  await writeFile(`tests/e2e/results/fixtures/${data.runId}-sale.json`, JSON.stringify({ runId: data.runId, sale, code }, null, 2));
  // Expected print dialog is not a defect. Never submit the sale a second time.
  await page.reload();
  await assertStock(7);
  async function openSale() {
    await page.goto('/historial');
    // QA-013 is documented separately. Use the existing full-code UI search
    // so this independent stock/anulation control can still complete.
    await page.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);
    await page.getByText(code, { exact: true }).filter({ visible: true }).click();
    await expect(page.getByText(data.saleProductName, { exact: true }).filter({ visible: true })).toBeVisible();
  }
  await openSale();
  await page.getByRole('button', { name: 'Anular venta', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Sí, anular', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
  await openSale();
  await expect(page.getByText('Anulada', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anular venta', exact: true }).filter({ visible: true })).toHaveCount(0);
  await assertStock(10);
  await info.attach('venta-stock', { body: Buffer.from(JSON.stringify({ runId: data.runId, saleId: sale.venta_id ?? sale.id, code, storedCode: sale.codigo, lookupUsed: 'código completo por QA-013', initial: 10, sold: 3, afterSale: 7, final: 10, state: 'ANULADA' })), contentType: 'application/json' });
});

test('QA-013: buscar el código visible debe encontrar la venta TEST', async ({ page, data }, info) => {
  knownIssue(info, 'QA-013');
  const { sale, code } = JSON.parse(await readFile(`tests/e2e/results/fixtures/${data.runId}-sale.json`, 'utf8'));
  await login(page, 'CAJERA', data);
  await page.goto('/historial');
  await page.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);
  await expect(page.getByText(code, { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByPlaceholder('Buscar por código o cliente...').fill(code);
  expectKnownFailure('QA-013');
  await expect(page.getByText(code, { exact: true }).filter({ visible: true })).toBeVisible();
});

test('POS: producto con stock cero no permite confirmar', async ({ page, data }) => {
  await login(page, 'CAJERA', data);
  await page.goto('/ventas');
  await page.getByRole('searchbox').first().fill(data.zeroProductName);
  await page.getByRole('button', { name: new RegExp(data.zeroProductName) }).click();
  await expect(page.getByText('Stock insuficiente', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '+', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`RESPONSIVE: catálogo CLIENTE ${viewport.width}×${viewport.height}`, async ({ page, data }) => {
    await page.setViewportSize(viewport);
    await login(page, 'CLIENTE', data);
    await page.goto(`/productos/${data.saleProductId}`);
    await expect(page.getByRole('heading', { name: data.saleProductName })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    // Product page intentionally repeats the CTA in the mobile sticky bar.
    await expect(page.getByRole('button', { name: /^Agregar al carrito/ }).first()).toBeVisible();
  });
}
