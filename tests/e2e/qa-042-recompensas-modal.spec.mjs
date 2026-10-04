// QA-042: el modal de premio (Web → Recompensas) debe contener el foco, cerrar con Esc/Cancelar y
// devolver el foco a quien lo abrió, tanto en «Nuevo» como en «Editar» (mismo componente).
// Solo Supabase Local TEST (guarda de fixtures.mjs). Login por la interfaz normal. El único dato
// escrito es un premio ficticio «TEST F2 …» creado por UI y dejado SIN publicar.
import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';

const dialogo = (page) => page.getByRole('dialog');
const focoDentro = (page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
const nombreFoco = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || document.activeElement?.id || '');

async function irACatalogo(page) {
  await page.goto('/recompensas-web');
  await expect(page.getByRole('tab', { name: /Catálogo de monedas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Nuevo', exact: true })).toBeVisible();
}

async function comprobarContencion(page, disparador) {
  await expect(dialogo(page)).toBeVisible();
  await expect(dialogo(page)).toHaveAttribute('aria-modal', 'true');
  await expect(dialogo(page)).toHaveAccessibleName(/premio/i);
  // El foco inicial está en Nombre.
  await expect(dialogo(page).getByLabel('Nombre', { exact: false })).toBeFocused();

  // Shift+Tab desde el primer campo NO sale del diálogo (QA-042): salta al último control.
  await page.keyboard.press('Shift+Tab');
  expect(await focoDentro(page)).toBe(true);
  await expect(dialogo(page).getByRole('button', { name: 'Guardar', exact: true })).toBeFocused();

  // Tab desde el último control vuelve al primero.
  await page.keyboard.press('Tab');
  expect(await focoDentro(page)).toBe(true);

  // Muchas pulsaciones de Tab en ambos sentidos: el foco nunca escapa del diálogo.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    expect(await focoDentro(page), `Tab #${i + 1} salió del diálogo`).toBe(true);
  }
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focoDentro(page), `Shift+Tab #${i + 1} salió del diálogo`).toBe(true);
  }
  // Nada del fondo es alcanzable: el botón del disparador no recibió el foco.
  expect(await nombreFoco(page)).not.toBe('');
  await expect(disparador).not.toBeFocused();
}

test('QA-042: «Nuevo premio» contiene el foco, cierra con Esc y Cancelar y devuelve el foco', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await irACatalogo(page);
  const nuevo = page.getByRole('button', { name: 'Nuevo', exact: true });

  await nuevo.click();
  await comprobarContencion(page, nuevo);

  // Escape cierra y devuelve el foco al botón que lo abrió.
  await page.keyboard.press('Escape');
  await expect(dialogo(page)).toHaveCount(0);
  await expect(nuevo).toBeFocused();

  // Reapertura: vuelve a funcionar igual (sin listeners ni foco colgados).
  await nuevo.click();
  await comprobarContencion(page, nuevo);

  // Cancelar cierra y devuelve el foco.
  await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialogo(page)).toHaveCount(0);
  await expect(nuevo).toBeFocused();

  // El scroll del fondo se restituye al cerrar.
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('QA-042: «Editar premio» (mismo componente) también contiene el foco y devuelve el foco', async ({ page }, info) => {
  await login(page, 'ADMINISTRADOR', {});
  await irACatalogo(page);
  const nombre = `TEST F2 foco ${Date.now().toString(36)}`;

  // Se crea por UI un premio ficticio sin publicar.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  const d = dialogo(page);
  await d.getByLabel('Nombre', { exact: false }).fill(nombre);
  await d.getByLabel('Monto (S/)', { exact: false }).fill('5');
  await d.getByRole('spinbutton', { name: /Básico/ }).fill('40');
  await d.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialogo(page)).toHaveCount(0);

  const tarjeta = page.getByRole('listitem').filter({ hasText: nombre });
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta.getByText('Sin publicar')).toBeVisible();
  const editar = tarjeta.getByRole('button', { name: 'Editar', exact: true });

  await editar.click();
  await comprobarContencion(page, editar);
  await page.keyboard.press('Escape');
  await expect(dialogo(page)).toHaveCount(0);
  await expect(editar).toBeFocused();

  await editar.click();
  await expect(dialogo(page)).toBeVisible();
  await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(editar).toBeFocused();
  info.annotations.push({ type: 'dato-ficticio', description: nombre });
});
