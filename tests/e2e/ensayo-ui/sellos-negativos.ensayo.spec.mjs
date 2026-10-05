// QA-052: el aviso de sellos negativos es NEUTRAL y vale para los dos orígenes del negativo. Antes decía «Se descontó un sello por
// una venta anulada» aunque el saldo viniera de la apertura (reclamadas > visitas). Texto aprobado:
//   «Tienes {cantidad} sellos por recuperar. Cada día con una venta de servicios válida recuperas un sello, hasta volver a 0.
//    Después puedes seguir acumulando. Los premios que ya reclamaste se conservan.»  (valor absoluto; singular/plural)
// Solo se observa la interfaz: no se comprueba ni se altera ningún estilo, efecto o animación. Instancia desechable.
import { test, expect } from 'playwright/test';
import { R, verificarEntorno, soloRedDelEnsayo, loginUI, sesion, rpc, mensaje, sqlJson } from './ayuda.mjs';

const aviso = (n) => `Tienes ${n} ${n === 1 ? 'sello' : 'sellos'} por recuperar. Cada día con una venta de servicios válida recuperas un sello, hasta volver a 0. Después puedes seguir acumulando. Los premios que ya reclamaste se conservan.`;
const sellosSql = (cid) => sqlJson(`select to_json(sellos) from public.recompensas_saldos('${cid}')`);
// El aviso es el único <p role="status"> con «por recuperar»; el historial de sellos tiene sus propias filas (la de una anulación sí
// dice «Se descontó un sello por una venta anulada», y es correcto para ese movimiento), por eso se acota por rol.
const AVISO_ANTIGUO = /venta anulada|Se descontó un sello|compensarán este ajuste/;
async function comprobarAviso(panel, n) {
  const avisoEl = panel.getByRole('status').filter({ hasText: 'por recuperar' });
  await expect(avisoEl).toHaveCount(1);
  await expect(avisoEl).toHaveText(aviso(n));
  await expect(panel.getByRole('status').filter({ hasText: AVISO_ANTIGUO }), 'el aviso antiguo ya no aparece').toHaveCount(0);
}

test.beforeAll(async ({ request }) => { await verificarEntorno(request); });
test.beforeEach(async ({ context }) => { await soloRedDelEnsayo(context); });

async function verSellos(page, email) {
  await loginUI(page, email);
  await page.goto('/recompensas?seccion=sellos');
  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  return panel;
}

test('QA-052 · negativo procedente de la APERTURA (reclamadas > visitas): aviso neutral en plural, sin hablar de ventas anuladas', async ({ page }) => {
  expect(await sellosSql(R.clientas.h2.id)).toBe(-7);
  const panel = await verSellos(page, R.clientas.h2.email);
  await expect(panel).toContainText('-7 sellos'); // el contador no cambia
  await expect(panel).toContainText('Tu saldo de sellos es negativo.');
  await comprobarAviso(panel, 7);
  expect(await panel.innerText()).not.toMatch(/NaN|undefined|\[object/);
});

test('QA-052 · negativo procedente de una ANULACIÓN: se llega a −1 por el camino real y el aviso va en singular', async ({ request, page }) => {
  const h = R.clientas.h8;
  const admin = await sesion(request, R.cuentas.ADMINISTRADOR);
  const cajera = await sesion(request, R.cuentas.CAJERA);
  const clienta = await sesion(request, h.email);
  expect(await sellosSql(h.id), '4 visitas anteriores a la apertura → 4 sellos').toBe(4);
  // +1: venta con servicio (la atención pendiente es anterior al corte; el sello del día se evalúa aparte).
  const v = await rpc(request, cajera.token, 'confirmar_venta', {
    p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'SERVICIO', registro_servicio_id: h.atencion, cantidad: 1 }],
    p_cliente_id: h.id, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: null, p_costo_delivery: 0,
  });
  expect(v.status, mensaje(v)).toBe(200);
  expect(await sellosSql(h.id)).toBe(5);
  // −5: canje de sellos de la clienta.
  const c = await rpc(request, clienta.token, 'canjear_premio_sellos', { p_catalogo_id: R.premioSellos, p_clave: `ens-sellos-${R.nonce}` });
  expect(c.status, mensaje(c)).toBe(200);
  expect(await sellosSql(h.id)).toBe(0);
  // −1: se anula la venta que dio el sello; el sello ya se había gastado.
  const a = await rpc(request, admin.token, 'anular_venta', { p_venta_id: v.cuerpo[0].venta_id });
  expect([200, 204]).toContain(a.status);
  expect(await sellosSql(h.id)).toBe(-1);
  const panel = await verSellos(page, h.email);
  await expect(panel).toContainText('-1 sello');
  await comprobarAviso(panel, 1); // singular: «1 sello por recuperar»
  await expect(panel.getByRole('status').filter({ hasText: '1 sellos' })).toHaveCount(0);
  expect(await panel.innerText()).not.toMatch(/NaN|undefined|\[object/);
});

test('QA-052 · sin saldo negativo no aparece el aviso (clienta con 25 sellos y clienta sin sellos negativos)', async ({ page }) => {
  const panel = await verSellos(page, R.clientas.h1.email);
  await expect(panel).toContainText('25 sellos');
  await expect(panel.getByRole('status').filter({ hasText: 'por recuperar' })).toHaveCount(0);
  await expect(panel).not.toContainText('Tu saldo de sellos es negativo');
});
