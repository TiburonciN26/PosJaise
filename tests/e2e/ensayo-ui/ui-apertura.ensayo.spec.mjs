// Pruebas de INTERFAZ con sesiones reales contra la app de ensayo (puerto 5273) → Auth/REST del ensayo → base «postgres» (la
// de la apertura). Solo se observa la interfaz existente: no se modifica ningún diseño, efecto ni animación de monedas, cupones
// o niveles. Corren después de http-apertura (mismo estado preparado); para repetirlas hay que volver a preparar.
import { test, expect } from 'playwright/test';
import { R, verificarEntorno, soloRedDelEnsayo, loginUI, sqlJson } from './ayuda.mjs';
import { cuerpoDeLaCarga } from '../colector-respuestas.mjs';

test.beforeAll(async ({ request }) => { await verificarEntorno(request); });
test.beforeEach(async ({ context }) => { await soloRedDelEnsayo(context); });

const panel = (page) => page.getByRole('tabpanel');
async function irA(page, seccion) {
  await page.goto(`/recompensas?seccion=${seccion}`);
  await expect(panel(page)).toBeVisible();
}
const sinRotos = async (page) => {
  const t = await page.locator('body').innerText();
  expect(t, 'sin NaN ni undefined en pantalla').not.toMatch(/NaN|undefined|\[object/);
};

test('CLIENTE con apertura, sellos > 20 y nivel VIP: tarjeta, sellos, cupones y movimientos coinciden con la base', async ({ page }) => {
  const llamadas = [];
  page.on('response', (r) => { if (/\/rpc\/(mi_saldo_recompensas|mis_cupones|mis_movimientos_recompensas)/.test(r.url())) llamadas.push(new URL(r.url()).origin); });
  await loginUI(page, R.clientas.h1.email);
  // El cuerpo se lee de la respuesta de ESTA carga (QA-060): tras iniciar sesión, la página de Inicio ya pide mi_saldo_recompensas y su
  // respuesta tardía no debe confundirse con la de «Mi tarjeta».
  const saldo = cuerpoDeLaCarga(page, (q) => q.url().includes('/rpc/mi_saldo_recompensas'));
  await irA(page, 'tarjeta');
  const cuerpo = (await saldo)[0];
  expect(Number(cuerpo.monedas)).toBe(250);
  await expect(panel(page)).toContainText('VIP');
  await expect(panel(page)).toContainText('MONEDAS DISPONIBLES');
  await expect(panel(page)).toContainText('Saldo de monedas: 250');
  await expect(panel(page)).toContainText('nivel máximo alcanzado');
  await sinRotos(page);
  await irA(page, 'sellos');
  await expect(panel(page)).toContainText('25 sellos'); // heredados íntegros aunque el tope sea 20
  await expect(panel(page)).toContainText('Tienes 5 premios disponibles');
  await sinRotos(page);
  await irA(page, 'movimientos');
  await expect(panel(page)).toContainText('Saldo inicial convertido a monedas');
  await irA(page, 'cupones');
  await sinRotos(page);
  expect([...new Set(llamadas)]).toEqual(['http://127.0.0.1:56321']);
});

test('CLIENTE con sellos negativos (apertura con reclamadas > visitas): la interfaz muestra −7 sin romperse', async ({ page }) => {
  await loginUI(page, R.clientas.h2.email);
  await irA(page, 'tarjeta');
  await expect(panel(page)).toContainText('Saldo de monedas: 30');
  await expect(panel(page)).toContainText('FALTAN 20 PTS · PREMIUM');
  await sinRotos(page);
  await irA(page, 'sellos');
  await expect(panel(page)).toContainText('-7 sellos');
  await expect(panel(page)).toContainText('Tu saldo de sellos es negativo');
  await sinRotos(page);
  // QA-052: el aviso ya no atribuye este negativo a una venta anulada (el detalle del texto se prueba en sellos-negativos).
  await expect(panel(page).getByRole('status').filter({ hasText: 'por recuperar' })).toContainText('Tienes 7 sellos por recuperar');
  await expect(panel(page).getByRole('status').filter({ hasText: /venta anulada|Se descontó un sello/ })).toHaveCount(0);
});

test('CLIENTE con canje: el cupón emitido por HTTP aparece en pantalla y el saldo refleja el canje', async ({ page }) => {
  const cup = await sqlJson(`select row_to_json(c) from (select codigo, estado from public.cupones where cliente_id='${R.clientas.h5.id}' order by creado_en desc limit 1) c`);
  expect(cup.estado).toBe('DISPONIBLE'); // la venta de prueba con ese cupón se anuló y el cupón volvió
  await loginUI(page, R.clientas.h5.email);
  await irA(page, 'cupones');
  await expect(panel(page)).toContainText(cup.codigo);
  await irA(page, 'tarjeta');
  await expect(panel(page)).toContainText('Saldo de monedas: 35');
  await irA(page, 'movimientos');
  await expect(panel(page)).toContainText('Saldo inicial convertido a monedas');
  await sinRotos(page);
});

test('vinculación posterior (decisión A) por la interfaz: «Sí, es mi registro» habilita el saldo congelado una sola vez', async ({ page }) => {
  const h = R.clientas.h7;
  expect(await sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${h.id}' and tipo='APERTURA'`)).toBe(0);
  await loginUI(page, h.email);
  await irA(page, 'tarjeta');
  await sinRotos(page);
  await page.goto('/mi-perfil');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.locator('#perfil-nombre').fill(`TEST ENS ui ${R.nonce}`);
  await page.getByLabel('Teléfono', { exact: true }).fill(h.telefono);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('¿Es tu registro?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sí, es mi registro', exact: true }).click();
  await expect.poll(() => sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${h.id}' and tipo='APERTURA'`)).toBe(1);
  await irA(page, 'tarjeta');
  await expect(panel(page)).toContainText('Saldo de monedas: 40');
  await irA(page, 'sellos');
  await expect(panel(page)).toContainText('3 sellos');
  // Reabrir y guardar de nuevo no abre otra vez.
  await page.goto('/mi-perfil');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForTimeout(1500);
  const n = await sqlJson(`select json_build_object('aperturas', (select count(*) from public.recompensas_movimientos where cliente_id='${h.id}' and tipo='APERTURA'),
    'estado', (select estado from public.recompensas_apertura_espera where cliente_id='${h.id}'))`);
  expect(n).toEqual({ aperturas: 1, estado: 'HABILITADA' });
});

test('CLIENTE no accede a pantallas de personal (ventas, clientes, porcentajes)', async ({ page }) => {
  await loginUI(page, R.clientas.h1.email);
  for (const ruta of ['/ventas', '/clientes', '/porcentajes', '/inventario']) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/inicio$/);
  }
});

test('venta y anulación por la interfaz: CAJERA vende a la clienta con apertura; el saldo sube y vuelve; la apertura queda', async ({ page }) => {
  const cid = R.clientas.h1.id;
  const saldo = async () => Number((await sqlJson(`select row_to_json(s) from public.recompensas_saldos('${cid}') s`)).monedas);
  expect(await saldo()).toBe(250);
  await loginUI(page, R.cuentas.CAJERA);
  await page.goto('/ventas');
  await page.getByRole('searchbox').first().fill(`TEST ENS prod ${R.nonce}`);
  await page.getByRole('button', { name: new RegExp(`TEST ENS prod ${R.nonce}`) }).first().click();
  await page.getByRole('button', { name: /^Cliente:/ }).click();
  await page.getByPlaceholder('Buscar por nombre o teléfono...').fill(`TEST ENS sellos-mayor-20 ${R.nonce}`);
  await page.getByRole('button', { name: new RegExp(`TEST ENS sellos-mayor-20 ${R.nonce}`) }).first().click();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  const resp = await enviada;
  expect(resp.ok()).toBeTruthy();
  const venta = (await resp.json())[0];
  expect(await saldo(), 'la venta por pantalla acredita monedas a la clienta con apertura').toBe(260);
  await page.goto('/historial');
  await page.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo);
  await page.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Anular venta', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Sí, anular', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
  expect(await saldo(), 'la anulación revierte solo lo acreditado').toBe(250);
  expect(await sqlJson(`select to_json(sum(monedas)) from public.recompensas_movimientos where cliente_id='${cid}' and tipo='APERTURA'`)).toBe(250);
});
