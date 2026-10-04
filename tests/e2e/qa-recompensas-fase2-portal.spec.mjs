// Portal de la clienta — Recompensas Fase 2 (canje, sellos, movimientos, catálogo público).
// Solo Supabase Local TEST (guarda de fixtures.mjs). Login por la interfaz normal; la clienta es la
// CLIENTE ficticia aislada de global-setup. El saldo/sellos de partida y el catálogo se preparan por SQL
// local (helpers de recompensas-fase2) porque no existe una vía de UI para otorgar saldo de prueba; las
// ACCIONES bajo prueba (canjear, reclamar, leer) se hacen siempre por la interfaz.
// El programa se activa para la prueba y se restaura al terminar.
import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

let cfg0;
let clienteId;
const tag = Date.now().toString(36);
const premioMon = `TEST F2 portal monedas ${tag}`;
const premioSel = `TEST F2 portal sellos ${tag}`;

async function prepararClienta(data) {
  const r = await h.json(`select to_json(id) from auth.users where email='${data.clientEmail}'`);
  const uid = r;
  await h.admin(`insert into public.clientes_web (id, email) values ('${uid}', '${data.clientEmail}') on conflict (id) do nothing;`);
  let id = await h.json(`select to_json(id) from public.clientes where cliente_web_id='${uid}'`);
  if (!id) {
    id = crypto.randomUUID();
    await h.admin(`insert into public.clientes (id, nombre, cliente_web_id) values ('${id}', 'TEST F2 portal ${tag}', '${uid}');`);
  }
  return id;
}

async function reiniciarSaldo(monedas, clasificacion, sellos) {
  // Los libros son solo-insertar: se compensa con un movimiento de ajuste hasta el valor deseado.
  const s = await h.saldos(clienteId);
  await h.darMonedas(clienteId, monedas - Number(s.monedas), clasificacion - Number(s.clasificacion));
  if (sellos !== s.sellos) await h.darSellos(clienteId, sellos - s.sellos);
}

test.beforeAll(async ({}, info) => {
  void info;
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  await h.activar(true);
});
test.afterAll(async () => {
  if (cfg0) await h.restaurarConfig(cfg0);
});

test('preparación: clienta ficticia con 100 monedas, nivel Premium, 20 sellos y premios publicados', async ({ data }) => {
  clienteId = await prepararClienta(data);
  await reiniciarSaldo(100, 60, 20);
  await h.nuevoPremio({ costoBasico: 40, valor: 5, nivelMinimo: 'BASICO', activo: true }).then(async (id) => {
    await h.admin(`update public.recompensas_catalogo set nombre='${premioMon}' where id='${id}'`);
  });
  await h.nuevoPremio({ origen: 'SELLOS', valor: 8, activo: true }).then(async (id) => {
    await h.admin(`update public.recompensas_catalogo set nombre='${premioSel}' where id='${id}'`);
  });
  const s = await h.saldos(clienteId);
  expect(Number(s.monedas)).toBe(100);
  expect(s.sellos).toBe(20);
});

test('Mi tarjeta: monedas disponibles separadas de la clasificación', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=tarjeta');
  await expect(page.getByText('MONEDAS DISPONIBLES')).toBeVisible();
  await expect(page.getByText(/Saldo de monedas:\s*100/)).toBeVisible();
  await expect(page.getByText('Gastar tus monedas no hace bajar tu nivel.')).toBeVisible();
});

test('Canjear: confirmación con condiciones, cancelar no debita, doble clic debita una sola vez', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await page.getByRole('button', { name: 'Obtener cupón', exact: true }).first().click();

  const d = page.getByRole('dialog');
  await expect(d).toBeVisible();
  await expect(d.getByText('Este canje es definitivo', { exact: false })).toBeVisible();
  await expect(d.getByText(/40 monedas/).first()).toBeVisible();
  await expect(d.getByText(/Saldo después/)).toBeVisible();
  await expect(d.getByText('Solo puedes usar un cupón por compra', { exact: false })).toBeVisible();
  await expect(d.getByText('sin protección configurada', { exact: false })).toBeVisible();

  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(100);

  await page.getByRole('button', { name: 'Obtener cupón', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).dblclick();
  await expect(page.getByRole('dialog').getByText('Canje realizado')).toBeVisible();
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(60);
  expect(await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}' and costo=40`)).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText(/Tienes\s*60 monedas\s*disponibles/)).toBeVisible();
});

test('Respuesta perdida: el reintento recupera el mismo cupón sin debitar otra vez', async ({ page, data }) => {
  await reiniciarSaldo(100, 60, 20);
  const antes = await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}'`);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  let primera = true;
  await page.route('**/rest/v1/rpc/canjear_recompensa', async (route) => {
    if (primera) {
      primera = false;
      await route.fetch(); // el servidor sí procesa el canje…
      await route.abort('failed'); // …pero la respuesta nunca llega al navegador
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await page.getByRole('button', { name: 'Obtener cupón', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('No pudimos confirmar si el canje se realizó', { exact: false })).toBeVisible();
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(60); // ya estaba debitado una vez

  await page.getByRole('dialog').getByRole('button', { name: 'Reintentar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Recuperamos el cupón de este canje')).toBeVisible();
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(60); // sin segundo débito
  expect(await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}'`)).toBe(antes + 1);
});

test('Recarga con un canje sin confirmar: se conserva la clave y se recupera el mismo resultado', async ({ page, data }) => {
  await reiniciarSaldo(100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  await page.route('**/rest/v1/rpc/canjear_recompensa', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await page.getByRole('button', { name: 'Obtener cupón', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('No pudimos confirmar', { exact: false })).toBeVisible();
  await page.unroute('**/rest/v1/rpc/canjear_recompensa');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await page.getByRole('button', { name: 'Obtener cupón', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByText('Quedó un canje sin confirmar', { exact: false })).toBeVisible();
  const debitos = await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`);
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Recuperamos el cupón de este canje')).toBeVisible();
  expect(await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`)).toBe(debitos);
});

test('Mis sellos: aviso verde al llegar a 20, reclamo de 5 y vuelve a poder acumular', async ({ page, data }) => {
  await reiniciarSaldo(100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Tienes 20 sellos. Canjea una recompensa para seguir acumulando.')).toBeVisible();
  await expect(page.getByText(/Un sello por día de Perú/).first()).toBeVisible();
  await page.getByRole('button', { name: /Reclamar por 5 sellos/ }).first().click();
  await expect(page.getByRole('dialog').getByText(/5 sellos/).first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Canje realizado')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect((await h.saldos(clienteId)).sellos).toBe(15);
  await expect(page.getByText('Tienes 20 sellos', { exact: false })).toHaveCount(0);
});

test('Sellos heredados mayores a 20 se conservan y se canjean de 5 en 5', async ({ page, data }) => {
  await reiniciarSaldo(100, 60, 35);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Tienes 35 sellos. Canjea una recompensa para seguir acumulando.')).toBeVisible();
  await page.getByRole('button', { name: /Reclamar por 5 sellos/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Canje realizado')).toBeVisible();
  expect((await h.saldos(clienteId)).sellos).toBe(30);
});

test('Saldos negativos: monedas y sellos se muestran, se explican y bloquean el canje', async ({ page, data }) => {
  await reiniciarSaldo(-15, 60, -1);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=tarjeta');
  await expect(page.getByText(/Tu saldo es negativo/)).toBeVisible();
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(/Tu saldo de monedas es negativo/)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await expect(page.getByRole('button', { name: 'Obtener cupón', exact: true }).first()).toBeDisabled();
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Se descontó un sello por una venta anulada. Tus próximos sellos compensarán este ajuste.', { exact: false }).first()).toBeVisible();
});

test('Movimientos: lista real con saldo después y fechas', async ({ page, data }) => {
  await reiniciarSaldo(100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=movimientos');
  await expect(page.getByText(/saldo -?\d/).first()).toBeVisible();
  await expect(page.getByText(/Canje:/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Gastados', exact: true }).click();
  await expect(page.getByText(/Canje:/).first()).toBeVisible();
});

test('Catálogo público: sin sesión se ve lo publicado, sin datos personales, y no se puede canjear', async ({ page }) => {
  const consultas = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === 'http://127.0.0.1:54321') consultas.push(u.pathname);
  });
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(premioMon)).toBeVisible();
  await expect(page.getByText(/Tienes .* disponibles/)).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(premioMon) }).click();
  await expect(page.getByRole('button', { name: 'Obtener cupón', exact: true }).first()).toBeDisabled();
  expect(consultas.filter((p) => /\/rpc\/(mis_|mi_|canjear)/.test(p))).toEqual([]);
  expect(consultas.some((p) => p.endsWith('/rpc/catalogo_recompensas_publico'))).toBe(true);
});
