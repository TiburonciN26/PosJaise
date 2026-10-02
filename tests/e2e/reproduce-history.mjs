// Read-only reproduction of the search mismatch discovered by POS automation.
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { assertLocalTest, localNetworkOnly } from './local-safety.mjs';
import { login } from './helpers.mjs';

await assertLocalTest();
const data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima', viewport: { width: 1280, height: 900 } });
await localNetworkOnly(context);
const page = await context.newPage();
await mkdir('tests/e2e/results/repro-history', { recursive: true });
try {
  await login(page, 'CAJERA', data);
  await page.goto('/historial');
  const findings = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByPlaceholder('Buscar por código o cliente...').fill('VEN019');
    await expect(page.getByText('V019', { exact: true }).filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: `tests/e2e/results/repro-history/control-${attempt}.png`, fullPage: true });
    await page.getByPlaceholder('Buscar por código o cliente...').fill('V019');
    await expect(page.getByText('No se encontraron ventas.', { exact: true })).toBeVisible();
    await page.screenshot({ path: `tests/e2e/results/repro-history/mismatch-${attempt}.png`, fullPage: true });
    findings.push({ attempt, shown: 'V019', query: 'V019', observed: 'No se encontraron ventas.', controlQuery: 'VEN019', control: 'V019 visible' });
    await page.reload();
  }
  await writeFile('tests/e2e/results/repro-history/evidence.json', JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(findings));
  if (process.argv.includes('--annul-own-test-sale')) {
    await page.getByPlaceholder('Buscar por código o cliente...').fill('VEN019');
    await page.getByText('V019', { exact: true }).filter({ visible: true }).click();
    // Verify this is THIS isolated run's product before any mutation.
    await expect(page.getByText(data.saleProductName, { exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole('button', { name: 'Anular venta', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Sí, anular', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
    await page.goto('/inventario');
    await page.getByPlaceholder('Buscar producto...').fill(data.saleProductName);
    await expect(page.getByRole('row').filter({ hasText: data.saleProductName }).getByRole('cell').nth(3)).toHaveText('10');
    await page.reload();
    await page.getByPlaceholder('Buscar producto...').fill(data.saleProductName);
    await expect(page.getByRole('row').filter({ hasText: data.saleProductName }).getByRole('cell').nth(3)).toHaveText('10');
    await page.screenshot({ path: 'tests/e2e/results/repro-history/stock-restaurado-V019.png', fullPage: true });
    console.log('V019 ANULADA por UI; stock propio restaurado a 10 y persistente.');
  }
} finally { await browser.close(); }
