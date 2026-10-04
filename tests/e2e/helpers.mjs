import { expect } from 'playwright/test';
import { accounts, password } from './fixtures/accounts.mjs';

export async function login(page, role, data) {
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill(role === 'CLIENTE' ? data.clientEmail : accounts[role]);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor();
}

export async function logout(page) {
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
}

export const formWithTitle = (page, title) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
export const visibleText = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });
export const visibleButton = (page, text) => page.getByRole('button', { name: text, exact: true }).filter({ visible: true });

export async function createProduct(page, data) {
  await page.goto('/inventario');
  await visibleButton(page, 'Nuevo producto').click();
  const form = formWithTitle(page, 'Nuevo producto');
  await form.getByLabel('Nombre', { exact: false }).fill(data.productName);
  await form.getByLabel('Código de barras', { exact: true }).fill(data.barcode);
  await form.getByLabel('Stock inicial', { exact: false }).fill(String(data.initialStock ?? 10));
  await form.getByLabel('Costo', { exact: false }).fill('0');
  await form.getByLabel('Precio de venta', { exact: false }).fill('1');
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const row = await response.json();
  data.productId = row.id ?? row[0]?.id;
  expect(data.productId).toBeTruthy();
  await expect(form).toHaveCount(0);
}

// Sufijo único por llamada (proceso + azar): los códigos de barras son UNIQUE y los nombres se buscan por
// subcadena, así que ningún caso reutiliza el fixture de otra corrida ni se apoya en first() para elegir.
export const sufijoUnico = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export async function createService(page, data) {
  await page.goto('/servicios');
  await visibleButton(page, 'Nuevo servicio').click();
  const form = formWithTitle(page, 'Nuevo servicio');
  await form.getByLabel('Nombre', { exact: false }).fill(data.serviceName);
  await form.getByLabel('Categoría', { exact: false }).selectOption({ label: 'Cabello' });
  await form.getByLabel('Precio', { exact: false }).first().fill('2');
  await form.getByLabel('Duración (min)', { exact: true }).fill('30');
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/servicios?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const row = await response.json();
  data.serviceId = row.id ?? row[0]?.id;
  expect(data.serviceId).toBeTruthy();
  await expect(form).toHaveCount(0);
}

export async function createAttention(page, data, hour) {
  await page.goto('/mi-panel');
  await visibleButton(page, 'Registrar atención').click();
  const form = formWithTitle(page, 'Registrar atención');
  await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);
  await form.getByRole('button', { name: data.clientName, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(data.serviceName);
  // La sugerencia real termina en el precio («<nombre> 2.00»); «Crear servicio "<nombre>"» no. Sin first().
  const escapado = data.serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await form.getByRole('button', { name: new RegExp(`^${escapado} \\d+(\\.\\d+)?$`) }).click();
  await form.getByLabel('Fecha y hora', { exact: false }).fill(`${data.today}T${hour}`);
  await form.getByLabel('Nota', { exact: true }).fill(`${data.prefix} atención ${hour}`);
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toHaveCount(0);
}
