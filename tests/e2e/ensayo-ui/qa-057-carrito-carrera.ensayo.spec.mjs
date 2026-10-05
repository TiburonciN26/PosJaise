// QA-057 — la cantidad y el importe del pedido deben ser EXACTAMENTE los anunciados. Pruebas deterministas con respuestas RETENIDAS
// (page.route), inicio de sesión normal contra la instancia desechable «JaiseEnsayo» (sin sesiones insertadas ni claims simulados).
//
// Escenario de Codex: producto S50, protección S25, cupón S10, carrito de 1 unidad. Se retiene la vista previa (válida, subtotal 50,
// descuento 10); la clienta pulsa «Agregar uno» (la UI muestra 2) y se retiene el PATCH; se libera SOLO la vista previa antigua.
// Antes: la UI anunciaba S/90 y habilitaba Confirmar; el servidor seguía con 1 unidad y creaba el pedido por S/40.
import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { verificarEntorno, soloRedDelEnsayo, sqlJson, sql } from './ayuda.mjs';
import { abrirCarrito, completarEntregaYPago, CTA, usarCupon, instruccionPago, pagarExacto } from './carrito.mjs';

const CC = JSON.parse(readFileSync(new URL('../fixtures/ensayo-cupon-runtime.json', import.meta.url), 'utf8'));
const E = CC.escenas;
const VISTA = '**/rpc/vista_previa_cupon_pedido';
const CARRITO = '**/rest/v1/carrito_productos*';

test.beforeAll(async ({ request }) => { await verificarEntorno(request); });
test.beforeEach(async ({ context }) => { await soloRedDelEnsayo(context); });

// Retención determinista: cada petición que coincide queda en una cola hasta que la prueba la libera.
function retener(page, patron, { metodo } = {}) {
  const cola = [];
  const esperas = [];
  const manejador = (route) => {
    if (metodo && route.request().method() !== metodo) return route.continue();
    cola.push(route);
    esperas.splice(0).forEach((r) => r());
    return undefined;
  };
  return {
    activar: () => page.route(patron, manejador),
    async siguiente() { if (!cola.length) await new Promise((r) => esperas.push(r)); return cola.shift(); },
    pendientes: () => cola.length,
    async soltarTodo() { await page.unroute(patron, manejador); for (const r of cola.splice(0)) await r.continue(); },
  };
}
const cantidadMostrada = (page) => page.getByRole('group', { name: /^Cantidad de / }).first();
const pedidos = (e) => sqlJson(`select coalesce(json_agg(json_build_object('total', w.total, 'items', (select json_agg(json_build_object('cantidad', i.cantidad)) from public.pedidos_web_items i where i.pedido_id = w.id)) order by w.creado_en), '[]'::json) from public.pedidos_web w where w.cliente_id='${e.clienteId}'`);

async function prepararConCupon(page, e) {
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
}

test('QA-057 · carrera de Codex: vista previa vieja liberada con el PATCH retenido → NO reactiva el importe ni el CTA; el pedido final coincide', async ({ page }) => {
  const e = E.q57carrera;
  await prepararConCupon(page, e);
  const vista = retener(page, VISTA);
  const patch = retener(page, CARRITO, { metodo: 'PATCH' });
  await vista.activar(); await patch.activar();
  await usarCupon(page, e.cupones[0].codigo);
  const vieja = await vista.siguiente();                       // vista previa REAL de 1 unidad, retenida
  await page.getByRole('button', { name: 'Agregar uno', exact: true }).click();
  await expect(cantidadMostrada(page)).toContainText('2');
  const pendientePatch = await patch.siguiente();             // el PATCH (cantidad 2) no llegó al servidor
  const respuestaVieja = page.waitForResponse((r) => r.url().includes('/rpc/vista_previa_cupon_pedido'));
  await vieja.continue();                                     // se libera SOLO la respuesta antigua
  const rv = await respuestaVieja;
  expect((await rv.json())[0], 'la respuesta vieja es válida para 1 unidad').toMatchObject({ valido: true, descuento: 10 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(CTA(page), 'la respuesta vieja NO habilita la confirmación').toBeDisabled();
  await expect(instruccionPago(page)).not.toContainText('(S/ 90.00');
  await expect(instruccionPago(page)).not.toContainText('(S/ 40.00');
  expect(await pedidos(e), 'ningún pedido mientras tanto').toEqual([]);
  // se libera el PATCH: ahora sí se revalida el estado PERSISTIDO (2 unidades)
  await pendientePatch.continue();
  await vista.soltarTodo(); await patch.soltarTodo();
  await pagarExacto(page, '90.00');
  await expect(CTA(page)).toBeEnabled();
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok()).toBeTruthy();
  expect(await pedidos(e), 'el pedido es exactamente el anunciado').toEqual([{ total: 90, items: [{ cantidad: 2 }] }]);
});

test('QA-057 · cambios rápidos: tres «Agregar uno» seguidos → se guarda y valida la última cantidad; pedido = anunciado', async ({ page }) => {
  const e = E.q57rapido;
  await prepararConCupon(page, e);
  await usarCupon(page, e.cupones[0].codigo);
  await pagarExacto(page, '40.00');
  const mas = page.getByRole('button', { name: 'Agregar uno', exact: true });
  await mas.click(); await mas.click(); await mas.click();
  await expect(cantidadMostrada(page)).toContainText('4');
  await pagarExacto(page, '190.00');
  await expect(CTA(page)).toBeEnabled();
  expect(await sqlJson(`select to_json(cantidad) from public.carrito_productos where cliente_web_id='${e.uid}'`), 'el servidor guarda la última').toBe(4);
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok()).toBeTruthy();
  expect(await pedidos(e)).toEqual([{ total: 190, items: [{ cantidad: 4 }] }]);
});

test('QA-057 · PATCH fallido: recuperación explícita, se vuelve a la cantidad guardada y no se valida como si se hubiese guardado', async ({ page }) => {
  const e = E.q57patch;
  await prepararConCupon(page, e);
  await usarCupon(page, e.cupones[0].codigo);
  await pagarExacto(page, '40.00');
  await page.route(CARRITO, (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo simulado del ensayo' }) })
    : route.continue()));
  await page.getByRole('button', { name: 'Agregar uno', exact: true }).click();
  const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos guardar' });
  await expect(alerta).toBeVisible();
  await expect(cantidadMostrada(page), 'se muestra la cantidad que de verdad quedó guardada').toContainText('1');
  await expect(instruccionPago(page)).not.toContainText('(S/ 90.00');
  await page.unroute(CARRITO);
  await pagarExacto(page, '40.00');
  expect(await sqlJson(`select to_json(cantidad) from public.carrito_productos where cliente_web_id='${e.uid}'`)).toBe(1);
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok()).toBeTruthy();
  expect(await pedidos(e)).toEqual([{ total: 40, items: [{ cantidad: 1 }] }]);
});

test('QA-057 · respuesta tardía: la vista previa de 1 unidad llega DESPUÉS de la de 2 y no la reemplaza', async ({ page }) => {
  const e = E.q57tarde;
  await prepararConCupon(page, e);
  const vista = retener(page, VISTA);
  await vista.activar();
  await usarCupon(page, e.cupones[0].codigo);
  const vieja = await vista.siguiente();
  await page.getByRole('button', { name: 'Agregar uno', exact: true }).click();
  const nueva = await vista.siguiente();                       // ya con el PATCH guardado (no retenido)
  await nueva.continue();
  await pagarExacto(page, '90.00');
  await expect(CTA(page)).toBeEnabled();
  const tardia = page.waitForResponse((r) => r.url().includes('/rpc/vista_previa_cupon_pedido'));
  await vieja.continue();
  await tardia;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await pagarExacto(page, '90.00');
  await expect(instruccionPago(page)).not.toContainText('(S/ 40.00');
  await vista.soltarTodo();
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok()).toBeTruthy();
  expect(await pedidos(e)).toEqual([{ total: 90, items: [{ cantidad: 2 }] }]);
});

test('QA-057 · cambio de PRECIO entre la vista previa y la confirmación: el servidor rechaza sin pedido y la UI pide actualizar', async ({ page }) => {
  const e = E.q57precio;
  await prepararConCupon(page, e);
  await usarCupon(page, e.cupones[0].codigo);
  await pagarExacto(page, '40.00');
  await sql(`update public.productos set precio = 60 where id='${e.productoId}';`);
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  const r = await enviada;
  expect(r.ok(), 'el servidor no acepta un total distinto del anunciado').toBeFalsy();
  expect((await r.json()).message).toMatch(/total cambió/);
  expect(await pedidos(e), 'sin pedido ni escrituras parciales').toEqual([]);
  expect(await sqlJson(`select to_json(estado) from public.cupones where cliente_id='${e.clienteId}'`)).toBe('DISPONIBLE');
  // la UI se actualiza con el precio vigente y vuelve a validar: S/60 − S/10 = S/50
  await pagarExacto(page, '50.00');
});
