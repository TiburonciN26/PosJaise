// Ayudas de interfaz del carrito de la clienta para la vía de ENSAYO (QA-054, QA-057). Solo observan y operan la interfaz real.
import { expect } from 'playwright/test';
import { loginUI, sqlJson } from './ayuda.mjs';

export function diaDeEntrega() {
  const lima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const hoy = lima.getDate();
  const d = new Date(lima); d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // domingo cerrado
  return { dia: d.getDate(), mesSiguiente: d.getMonth() !== lima.getMonth() && d.getDate() < hoy };
}
export async function imagenFicticia(page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 80;
    const x = c.getContext('2d'); x.fillStyle = '#ffccd9'; x.fillRect(0, 0, 160, 80); x.fillStyle = '#222'; x.font = '16px sans-serif';
    x.fillText('TEST ENSAYO', 12, 35); x.fillText('NO PAGO / FICTICIO', 12, 60);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'TEST-ENSAYO-NO-PAGO.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}
export async function abrirCarrito(page, escena) {
  await loginUI(page, escena.email);
  await page.goto('/carrito');
  await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
  await expect(page.getByText(escena.nombre, { exact: false }).first()).toBeVisible();
}
export async function completarEntregaYPago(page) {
  const { dia, mesSiguiente } = diaDeEntrega();
  await page.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
  await page.getByRole('button', { name: 'Elige el día', exact: true }).click();
  if (mesSiguiente) await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click();
  await page.getByRole('button', { name: String(dia), exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Elige la hora', exact: true }).click();
  await page.getByRole('button', { name: '11:00', exact: true }).click();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(await imagenFicticia(page));
}
export const CTA = (page) => page.getByRole('button', { name: /^Confirmar pedido/ });
export async function usarCupon(page, codigo) {
  await page.getByText('Agregar cupón', { exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Tus cupones' });
  await expect(panel).toBeVisible();
  // El panel lista las tarjetas; «Usar» es el botón de la tarjeta cuyo código coincide.
  const tarjeta = panel.locator('div.flex.flex-col.gap-1\\.5').filter({ hasText: codigo });
  await tarjeta.getByRole('button', { name: 'Usar', exact: true }).click();
}
// El total del resumen es un contador animado (dígitos apilados, no legible como texto); el importe EXACTO que la clienta debe pagar
// también está escrito en las instrucciones del método de pago, y eso es lo que se comprueba. Con un cupón sin confirmar no hay importe.
export const instruccionPago = (page) => page.getByText(/el total exacto/);
export const quitarCupon = (page) => page.getByText('Cupón aplicado', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Quitar', exact: true }).click();
export const totalMostrado = (page) => page.getByText('Total', { exact: true }).locator('xpath=..');
export const pagarExacto = (page, importe) => expect(instruccionPago(page)).toContainText(`(S/ ${importe}`);
export const sinImporte = (page) => expect(instruccionPago(page)).toContainText('se mostrará cuando se confirme tu cupón');
export const estadoBD = (e) => sqlJson(`select json_build_object(
  'pedidos', (select count(*) from public.pedidos_web where cliente_id='${e.clienteId}'),
  'ventas', (select count(*) from public.ventas where cliente_id='${e.clienteId}'),
  'stock', (select stock_actual from public.productos where id='${e.productoId}'),
  'carrito', (select coalesce(sum(cantidad),0) from public.carrito_productos where cliente_web_id='${e.uid}'),
  'cupones', (select coalesce(string_agg(estado||coalesce(venta_id::text,''), ',' order by codigo),'') from public.cupones where cliente_id='${e.clienteId}'),
  'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${e.clienteId}'),
  'sellos', (select count(*) from public.recompensas_sellos_movs where cliente_id='${e.clienteId}'))`);

