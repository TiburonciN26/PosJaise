import { test, expect } from './fixtures.mjs';
import { login, logout } from './helpers.mjs';

test('AUTH: sin sesión, rutas protegidas redirigen a login', async ({ page }) => {
  for (const path of ['/ventas', '/clientes', '/inicio', '/mi-perfil', '/pedidos-web']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  }
});

test('AUTH: contraseña incorrecta se rechaza', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill('cajeratest01@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('TEST-no-es-la-clave');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

for (const [role, allowed, denied, destination] of [
  ['ADMINISTRADOR', ['/inventario', '/clientes', '/auditoria', '/pedidos-web'], [], null],
  ['CAJERA', ['/ventas', '/inventario', '/historial', '/servicios', '/citas', '/gastos'], ['/dashboard', '/clientes', '/asistentes', '/porcentajes', '/web'], '/ventas'],
  ['ASISTENTE', ['/mi-panel', '/citas'], ['/ventas', '/inventario', '/clientes', '/porcentajes'], '/mi-panel'],
  ['CLIENTE', ['/inicio', '/mi-perfil', '/historial', '/citas', '/productos'], ['/ventas', '/inventario', '/asistentes', '/pedidos-web'], '/inicio'],
]) {
  test(`AUTH/ROLES: ${role}, rutas y logout`, async ({ page, data }) => {
    await login(page, role, data);
    for (const path of allowed) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('button', { name: /Menú de (usuario|cuenta)/ })).toBeVisible();
    }
    for (const path of denied) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
    }
    await logout(page);
    await page.goto(allowed[0]);
    await expect(page).toHaveURL(/\/login$/);
  });
}
