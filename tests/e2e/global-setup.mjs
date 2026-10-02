import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertLocalTest, localServiceKey, localNetworkOnly, supabaseURL } from './local-safety.mjs';
import { password } from './fixtures/accounts.mjs';
import { login, formWithTitle, createProduct, createService, createAttention } from './helpers.mjs';

export default async function setup() {
  await assertLocalTest();
  if (process.env.QA_REUSE_FIXTURES === '1') {
    const { readFile } = await import('node:fs/promises');
    const existing = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
    if (!existing.setupComplete || !existing.prefix.startsWith('TEST PW ')) throw new Error('Missing isolated QA fixture; refusing reuse.');
    console.log(`Reusing isolated LOCAL QA fixture ${existing.prefix}`);
    return;
  }
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const prefix = `TEST PW ${runId}`;
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const data = {
    runId, prefix,
    clientEmail: `clientetest-pw-${runId}@test.local`,
    clientName: `${prefix} CLIENTE`,
    phone: `9${String(Date.now()).slice(-8)}`,
    productName: `${prefix} Producto`,
    barcode: `TEST-PW-${runId}`,
    serviceName: `${prefix} Servicio`,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()),
    tomorrow: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(tomorrow),
  };
  // AGENTS local QA provisioning exception: Auth only. Application profile is
  // created by normal login and filled in via UI, never by mutating SQL/API.
  const key = localServiceKey();
  const response = await fetch(`${supabaseURL}/auth/v1/admin/users`, {
    method: 'POST', redirect: 'error', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: data.clientEmail, password, email_confirm: true, user_metadata: { qa: true } }),
  });
  if (!response.ok) throw new Error(`Local QA Auth provisioning failed (${response.status}); key not logged.`);
  data.clientAuthId = (await response.json()).id;
  await mkdir('tests/e2e/fixtures', { recursive: true });
  await mkdir('tests/e2e/results/fixtures', { recursive: true });
  await writeFile('tests/e2e/fixtures/runtime.json', JSON.stringify(data, null, 2));
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima', viewport: { width: 1280, height: 900 } });
  await localNetworkOnly(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await login(page, 'CLIENTE', data);
    await page.goto('/mi-perfil');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.locator('#perfil-nombre').fill(data.clientName);
    await page.getByLabel('Teléfono', { exact: true }).fill(data.phone);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Perfil guardado.', { exact: true })).toBeVisible();
    await context.close();
    const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima', viewport: { width: 1280, height: 900 } });
    await localNetworkOnly(adminContext);
    const admin = await adminContext.newPage();
    admin.setDefaultTimeout(15_000);
    await login(admin, 'ADMINISTRADOR', data);
    await createProduct(admin, data);
    const sale = { productName: `${prefix} Producto POS`, barcode: `${data.barcode}-POS` };
    await createProduct(admin, sale);
    data.saleProductName = sale.productName;
    data.saleProductId = sale.productId;
    const zero = { productName: `${prefix} Producto SIN STOCK`, barcode: `${data.barcode}-ZERO`, initialStock: 0 };
    await createProduct(admin, zero);
    data.zeroProductName = zero.productName;
    data.zeroProductId = zero.productId;
    await createService(admin, data);
    await createAttention(admin, data, '09:15');
    await admin.goto('/promociones');
    await admin.getByRole('button', { name: 'Nueva promoción', exact: true }).filter({ visible: true }).click();
    const promo = formWithTitle(admin, 'Nueva promoción');
    data.promotionName = `${prefix} Promoción`;
    await promo.getByLabel('Título', { exact: false }).fill(data.promotionName);
    await promo.getByLabel('Porcentaje', { exact: false }).fill('15');
    // Inicio shows the first promotion ordered by expiry, rather than newest.
    await promo.getByLabel('Vigente hasta', { exact: true }).fill(data.today);
    await promo.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(promo).toHaveCount(0);
    await adminContext.close();
    await writeFile('tests/e2e/fixtures/runtime.json', JSON.stringify({ ...data, setupComplete: true }, null, 2));
    await writeFile(`tests/e2e/results/fixtures/${runId}.json`, JSON.stringify({ ...data, setupComplete: true }, null, 2));
    console.log(`LOCAL QA fixtures ready: ${prefix}; no existing business records modified.`);
  } catch (error) {
    if (!page.isClosed()) await page.screenshot({ path: 'tests/e2e/fixtures/setup-failure.png', fullPage: true }).catch(() => {});
    await writeFile('tests/e2e/fixtures/runtime.json', JSON.stringify({ ...data, setupComplete: false }, null, 2));
    await writeFile(`tests/e2e/results/fixtures/${runId}.json`, JSON.stringify({ ...data, setupComplete: false }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
