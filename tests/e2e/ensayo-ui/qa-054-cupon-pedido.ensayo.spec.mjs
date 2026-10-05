// QA-054 — el cupón se valida ANTES de pedir el pago de un pedido web. HTTP + interfaz con SESIONES REALES (inicio de sesión
// normal contra GoTrue de la instancia desechable «JaiseEnsayo»; no se insertan sesiones ni se simulan claims).
//
//   ENSAYO_PASSWORD=… node tests/e2e/ensayo-preparar-cupon.mjs   (alta de cuentas y escenas)
//   (Vite de ensayo en :5273)  node node_modules/playwright/cli.js test --config=playwright.ensayo.config.mjs qa-054
//
// Límite declarado: es la vía de ENSAYO (copia de QA con las migraciones de protección). La suite de QA (Supabase Local QA, con
// QA_TEST_PASSWORD) no se ejecutó en este lote.
import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { verificarEntorno, soloRedDelEnsayo, loginUI, sesion, rpc, tabla, mensaje, sqlJson, sql } from './ayuda.mjs';

const CC = JSON.parse(readFileSync(new URL('../fixtures/ensayo-cupon-runtime.json', import.meta.url), 'utf8'));
const E = CC.escenas;
const GLOBAL = /supera el descuento permitido para esta compra/;

test.beforeAll(async ({ request }) => { await verificarEntorno(request); });
test.beforeEach(async ({ context }) => { await soloRedDelEnsayo(context); });

// ---------- ayudas de interfaz ----------
function diaDeEntrega() {
  const lima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const hoy = lima.getDate();
  const d = new Date(lima); d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // domingo cerrado
  return { dia: d.getDate(), mesSiguiente: d.getMonth() !== lima.getMonth() && d.getDate() < hoy };
}
async function imagenFicticia(page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 80;
    const x = c.getContext('2d'); x.fillStyle = '#ffccd9'; x.fillRect(0, 0, 160, 80); x.fillStyle = '#222'; x.font = '16px sans-serif';
    x.fillText('TEST ENSAYO', 12, 35); x.fillText('NO PAGO / FICTICIO', 12, 60);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'TEST-ENSAYO-NO-PAGO.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}
async function abrirCarrito(page, escena) {
  await loginUI(page, escena.email);
  await page.goto('/carrito');
  await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
  await expect(page.getByText(escena.nombre, { exact: false }).first()).toBeVisible();
}
async function completarEntregaYPago(page) {
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
const CTA = (page) => page.getByRole('button', { name: /^Confirmar pedido/ });
async function usarCupon(page, codigo) {
  await page.getByText('Agregar cupón', { exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Tus cupones' });
  await expect(panel).toBeVisible();
  // El panel lista las tarjetas; «Usar» es el botón de la tarjeta cuyo código coincide.
  const tarjeta = panel.locator('div.flex.flex-col.gap-1\\.5').filter({ hasText: codigo });
  await tarjeta.getByRole('button', { name: 'Usar', exact: true }).click();
}
// El total del resumen es un contador animado (dígitos apilados, no legible como texto); el importe EXACTO que la clienta debe pagar
// también está escrito en las instrucciones del método de pago, y eso es lo que se comprueba. Con un cupón sin confirmar no hay importe.
const instruccionPago = (page) => page.getByText(/el total exacto/);
const quitarCupon = (page) => page.getByText('Cupón aplicado', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Quitar', exact: true }).click();
const totalMostrado = (page) => page.getByText('Total', { exact: true }).locator('xpath=..');
const pagarExacto = (page, importe) => expect(instruccionPago(page)).toContainText(`(S/ ${importe}`);
const sinImporte = (page) => expect(instruccionPago(page)).toContainText('se mostrará cuando se confirme tu cupón');
const estadoBD = (e) => sqlJson(`select json_build_object(
  'pedidos', (select count(*) from public.pedidos_web where cliente_id='${e.clienteId}'),
  'ventas', (select count(*) from public.ventas where cliente_id='${e.clienteId}'),
  'stock', (select stock_actual from public.productos where id='${e.productoId}'),
  'carrito', (select coalesce(sum(cantidad),0) from public.carrito_productos where cliente_web_id='${e.uid}'),
  'cupones', (select coalesce(string_agg(estado||coalesce(venta_id::text,''), ',' order by codigo),'') from public.cupones where cliente_id='${e.clienteId}'),
  'mov', (select count(*) from public.recompensas_movimientos where cliente_id='${e.clienteId}'),
  'sellos', (select count(*) from public.recompensas_sellos_movs where cliente_id='${e.clienteId}'))`);

// ---------- 1. reproducción de Codex ----------
test('QA-054 · UI: S50, protección S48, cupón S10 → se rechaza ANTES de pedir el pago; sin descuento prometido ni pedido', async ({ page }) => {
  const e = E.rechazo;
  const antes = await estadoBD(e);
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  await expect(CTA(page)).toBeEnabled(); // sin cupón el pedido sí se puede confirmar
  await usarCupon(page, e.cupones[0].codigo);
  const alerta = page.getByRole('alert').filter({ hasText: 'supera el descuento permitido' });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText('No se consumió');
  await expect(CTA(page), 'no se puede confirmar con un cupón rechazado').toBeDisabled();
  await sinImporte(page); // el S/40 que Codex vio ya no se anuncia como importe a pagar
  await expect(instruccionPago(page)).not.toContainText('40.00');
  await expect(page.getByText(/Cupón EC[0-9A-F]+/)).toHaveCount(0); // ninguna línea de descuento
  expect(await estadoBD(e), 'rechazo en pantalla: nada cambió').toEqual(antes);
  // el cupón se puede quitar y el carrito vuelve a ser confirmable por su total real (S/50)
  await quitarCupon(page);
  await expect(CTA(page)).toBeEnabled();
  await pagarExacto(page, '50.00');
  // persistencia: tras recargar, el cupón sigue DISPONIBLE y el carrito intacto
  await page.reload();
  await expect(page.getByText(e.nombre, { exact: false }).first()).toBeVisible();
  expect(await estadoBD(e)).toEqual(antes);
});

// ---------- 2. cupón válido de punta a punta ----------
test('QA-054 · UI: cupón S2 válido → total S48, pedido aceptado y pago verificado por ADMINISTRADOR; venta = lo pagado', async ({ page, request }) => {
  const e = E.valido;
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  await usarCupon(page, e.cupones[0].codigo);
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toBeVisible();
  await pagarExacto(page, '48.00');
  await expect(CTA(page)).toBeEnabled();
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok(), 'el pedido válido se acepta').toBeTruthy();
  const ped = await sqlJson(`select to_json(w) from (select id, total, descuento_cupon, estado, pago_verificado from public.pedidos_web where cliente_id='${e.clienteId}') w`);
  expect(Number(ped.total)).toBe(48); expect(Number(ped.descuento_cupon)).toBe(2); expect(ped.pago_verificado).toBe(false);
  // el ADMINISTRADOR verifica el pago (sesión real)
  const admin = await sesion(request, CC.cuentas.ADMINISTRADOR);
  const v = await rpc(request, admin.token, 'verificar_pago_pedido_web', { p_pedido_id: ped.id });
  expect(v.status, mensaje(v)).toBe(200);
  const fin = await sqlJson(`select json_build_object('venta', (select total from public.ventas where id=(select venta_id from public.pedidos_web where id='${ped.id}')),
    'cupon', (select estado from public.cupones where cliente_id='${e.clienteId}' limit 1), 'stock', (select stock_actual from public.productos where id='${e.productoId}'))`);
  expect(Number(fin.venta)).toBe(48); expect(fin.cupon).toBe('CANJEADO'); expect(Number(fin.stock)).toBe(9);
});

// ---------- 3. respuesta lenta o fallida ----------
test('QA-054 · UI: validación lenta o fallida → no se presenta un descuento como confirmado y no se puede confirmar', async ({ page }) => {
  const e = E.lento;
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  // lenta: la respuesta tarda; mientras tanto no hay descuento ni total confirmado
  let liberar;
  const retenida = new Promise((r) => { liberar = r; });
  await page.route('**/rpc/vista_previa_cupon_pedido', async (route) => { await retenida; await route.continue(); });
  await usarCupon(page, e.cupones[0].codigo);
  await expect(page.getByText('Validando tu cupón…')).toBeVisible();
  await expect(CTA(page)).toBeDisabled();
  await expect(totalMostrado(page)).toContainText('Validando cupón…');
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toHaveCount(0);
  liberar();
  await pagarExacto(page, '48.00');
  await expect(CTA(page)).toBeEnabled();
  await page.unroute('**/rpc/vista_previa_cupon_pedido');
  // fallida: la consulta falla; error con «Reintentar», sin descuento y sin poder confirmar
  await page.route('**/rpc/vista_previa_cupon_pedido', (route) => route.abort('failed'));
  await quitarCupon(page);
  await usarCupon(page, e.cupones[0].codigo);
  const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos validar el cupón' });
  await expect(alerta).toBeVisible();
  await expect(CTA(page)).toBeDisabled();
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toHaveCount(0);
  await page.unroute('**/rpc/vista_previa_cupon_pedido');
  await alerta.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await pagarExacto(page, '48.00');
  await expect(CTA(page)).toBeEnabled();
  expect((await estadoBD(e)).pedidos, 'la validación no creó ningún pedido').toBe(0);
});

// ---------- 4. cambio de cantidad ----------
test('QA-054 · UI: cambio de cantidad después de aplicar el cupón → se revalida (compra mínima S50 con 2 u. sí, con 1 u. no)', async ({ page }) => {
  const e = E.cantidad;
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  await usarCupon(page, e.cupones[0].codigo);
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toBeVisible();
  await expect(CTA(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Quitar uno', exact: true }).click();
  const alerta = page.getByRole('alert').filter({ hasText: 'compra mínima' });
  await expect(alerta).toBeVisible();
  await expect(CTA(page)).toBeDisabled();
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar uno', exact: true }).click();
  await expect(page.getByText(/^Cupón EC[0-9A-F]+/)).toBeVisible();
  await expect(CTA(page)).toBeEnabled();
});

// ---------- 5. alcance ----------
test('QA-054 · UI: cupón exclusivo de SERVICIOS en un carrito solo de productos → motivo claro y no se puede confirmar', async ({ page }) => {
  const e = E.servicios;
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  await usarCupon(page, e.cupones[0].codigo);
  await expect(page.getByRole('alert').filter({ hasText: 'no aplica a los productos o servicios' })).toBeVisible();
  await expect(CTA(page)).toBeDisabled();
});

// ---------- 6. saltándose la UI ----------
test('QA-054 · HTTP: confirmar_pedido_productos directo con sesión real y cupón fuera de protección → rechazo, sin pedido ni consumo', async ({ request }) => {
  const e = E.directo;
  const c = await sesion(request, e.email);
  const antes = await estadoBD(e);
  const r = await rpc(request, c.token, 'confirmar_pedido_productos', {
    p_producto_ids: [e.productoId], p_tipo_entrega: 'RECOJO_TIENDA', p_fecha_entrega: await sqlJson(`select to_json((now() at time zone 'America/Lima')::date + 1)`),
    p_hora_entrega: '11:00', p_metodo_pago: 'YAPE', p_comprobante_url: 'ficticio/c.jpg', p_codigo_cupon: e.cupones[0].codigo,
  });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(mensaje(r)).toMatch(GLOBAL);
  expect(JSON.stringify(r.cuerpo)).not.toMatch(/costo|transporte|48|proteccion/i);
  expect(await estadoBD(e)).toEqual(antes);
  // la vista previa por HTTP es de solo lectura y devuelve únicamente 4 campos
  const vp = await rpc(request, c.token, 'vista_previa_cupon_pedido', { p_codigo: e.cupones[0].codigo, p_producto_ids: [e.productoId] });
  expect(vp.status).toBe(200);
  expect(Object.keys(vp.cuerpo[0]).sort()).toEqual(['descuento', 'motivo', 'subtotal', 'valido']);
  expect(vp.cuerpo[0].valido).toBe(false);
  expect(await estadoBD(e)).toEqual(antes);
  // otra clienta no puede consultar este cupón
  const otra = await sesion(request, E.cantidad.email);
  const ajeno = await rpc(request, otra.token, 'vista_previa_cupon_pedido', { p_codigo: e.cupones[0].codigo, p_producto_ids: [E.cantidad.productoId] });
  expect(ajeno.cuerpo[0].valido).toBe(false);
  expect(ajeno.cuerpo[0].motivo).toMatch(/no existe, no es tuyo/);
  // sin sesión: la vista previa no existe para anon
  const anon = await rpc(request, undefined, 'vista_previa_cupon_pedido', { p_codigo: 'X', p_producto_ids: [e.productoId] });
  expect(anon.status).toBeGreaterThanOrEqual(400);
});

// ---------- 7. cambios posteriores al pedido ----------
test('QA-054 · UI: cambio de protección DESPUÉS de aceptar el pedido → CONFLICTO explícito al verificar el pago, sin escrituras parciales', async ({ page, browser, request }) => {
  const e = E.posterior;
  // el pedido se acepta (cupón S2 dentro de la protección) por la interfaz de la clienta
  await abrirCarrito(page, e);
  await completarEntregaYPago(page);
  await usarCupon(page, e.cupones[0].codigo);
  await pagarExacto(page, '48.00');
  const enviada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
  await CTA(page).click();
  expect((await enviada).ok()).toBeTruthy();
  // después, sube la protección del producto (S63 > S48): el conflicto aparece al verificar
  await sql(`update public.productos_proteccion set otros = 40 where producto_id='${e.productoId}';`);
  const antes = await estadoBD(e);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5273', timezoneId: 'America/Lima', viewport: { width: 1280, height: 900 } });
  await soloRedDelEnsayo(ctx);
  try {
    const a = await ctx.newPage();
    await loginUI(a, CC.cuentas.ADMINISTRADOR);
    await a.goto('/pedidos-web');
    await a.getByPlaceholder('Buscar por clienta...').fill(`TEST ENS cupon posterior ${CC.nonce}`);
    await a.getByRole('button').filter({ hasText: `TEST ENS cupon posterior ${CC.nonce}` }).click();
    const verificada = a.waitForResponse((r) => r.url().includes('/rpc/verificar_pago_pedido_web'));
    await a.getByRole('button', { name: 'Verificar pago', exact: true }).click();
    const rv = await verificada;
    expect(rv.ok(), 'la verificación se rechaza').toBeFalsy();
    const cuerpo = await rv.json();
    expect(cuerpo.message).toMatch(/CONFLICTO: el cupón de este pedido ya no cumple la protección económica/);
    expect(cuerpo.message).toMatch(/no se cobró ni se cambió nada/);
    await expect(a.getByText(/CONFLICTO/).first()).toBeVisible();
  } finally { await ctx.close(); }
  expect(await estadoBD(e), 'sin venta, sin stock descontado, cupón intacto').toEqual({ ...antes });
  expect((await estadoBD(e)).ventas).toBe(0);
  expect(await sqlJson(`select to_json(estado) from public.pedidos_web where cliente_id='${e.clienteId}'`)).toBe('PENDIENTE');
  // ... y un cambio de PRECIO también se declara como conflicto (no se cobra otro total en silencio)
  await sql(`update public.productos_proteccion set otros = 25 where producto_id='${e.productoId}'; update public.productos set precio = 60 where id='${e.productoId}';`);
  const admin = await sesion(request, CC.cuentas.ADMINISTRADOR);
  const pid = await sqlJson(`select to_json(id) from public.pedidos_web where cliente_id='${e.clienteId}'`);
  const v2 = await rpc(request, admin.token, 'verificar_pago_pedido_web', { p_pedido_id: pid });
  expect(v2.status).toBeGreaterThanOrEqual(400);
  expect(mensaje(v2)).toMatch(/CONFLICTO: el total vigente \(S\/ [\d.]+\) ya no coincide con el que la clienta pagó/);
  expect((await estadoBD(e)).ventas).toBe(0);
});

// ---------- 8. porcentaje con tope, compra mínima, costo desconocido y cero confirmado (HTTP real) ----------
test('QA-054 · HTTP: porcentaje con tope, compra mínima, costo desconocido y cero confirmado', async ({ request }) => {
  const p = E.preview;
  const c = await sesion(request, p.email);
  const vista = async (cupon) => (await rpc(request, c.token, 'vista_previa_cupon_pedido', { p_codigo: cupon.codigo, p_producto_ids: [p.productoId] })).cuerpo[0];
  const [pct, minimo, tope] = p.cupones;
  const a = await vista(pct); expect(a.valido).toBe(true); expect(Number(a.descuento)).toBe(5); // el tope manda (25 → 5)
  const b = await vista(minimo); expect(b.valido).toBe(false); expect(b.motivo).toMatch(/compra mínima de S\/ 60/);
  const d = await vista(tope); expect(d.valido).toBe(false); expect(d.motivo).toMatch(GLOBAL); // 100 % con tope 45 > máximo 40
  // costo desconocido: motivo neutro, sin revelar el costo ni el producto
  const u = E.desconocido; const cu = await sesion(request, u.email);
  const vu = (await rpc(request, cu.token, 'vista_previa_cupon_pedido', { p_codigo: u.cupones[0].codigo, p_producto_ids: [u.productoId] })).cuerpo[0];
  expect(vu.valido).toBe(false); expect(vu.motivo).toMatch(/por ahora/);
  expect(JSON.stringify(vu)).not.toMatch(/costo|administrador|TEST ENS/i);
  const peticion = await rpc(request, cu.token, 'confirmar_pedido_productos', {
    p_producto_ids: [u.productoId], p_tipo_entrega: 'RECOJO_TIENDA', p_fecha_entrega: await sqlJson(`select to_json((now() at time zone 'America/Lima')::date + 1)`),
    p_hora_entrega: '11:00', p_metodo_pago: 'YAPE', p_comprobante_url: 'ficticio/c.jpg', p_codigo_cupon: u.cupones[0].codigo,
  });
  expect(peticion.status).toBeGreaterThanOrEqual(400);
  expect(mensaje(peticion)).not.toMatch(/costo|administrador/i);
  // cero CONFIRMADO: el cupón se acepta
  const z = E.cero; const cz = await sesion(request, z.email);
  const vz = (await rpc(request, cz.token, 'vista_previa_cupon_pedido', { p_codigo: z.cupones[0].codigo, p_producto_ids: [z.productoId] })).cuerpo[0];
  expect(vz.valido, vz.motivo).toBe(true); expect(Number(vz.descuento)).toBe(5);
  // privacidad: la clienta no lee las tablas de protección ni el costo de compra
  for (const t of ['productos_proteccion', 'servicios_proteccion', 'recompensas_venta_proteccion']) {
    const r = await tabla(request, cz.token, `${t}?select=*`);
    expect(r.cuerpo, `la clienta no ve ${t}`).toEqual([]);
  }
  const costo = await tabla(request, cz.token, `productos?id=eq.${z.productoId}&select=costo`);
  expect(costo.status, 'productos.costo sin SELECT de columna').toBeGreaterThanOrEqual(400);
});
