import { test, expect, knownIssue } from './fixtures.mjs';
import { sufijoUnico, login, visibleButton, formWithTitle, createProduct } from './helpers.mjs';
import { isolatedClient, qaContext } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';

// Regresión de QA-025..029 (Supabase Local TEST, datos ficticios, sin pagos reales).
// Cada caso afirma el comportamiento CORRECTO: falla con el defecto y pasa con la corrección.

function watchApiKey(page) {
  const box = { key: null };
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) box.key = k;
  });
  return box;
}

// Llamada REST/RPC con la sesión real de la página (mismas RLS que la app).
async function rest(page, box, method, path, body) {
  return page.evaluate(async ({ method, path, body, key, base }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const token = JSON.parse(localStorage.getItem(storageKey)).access_token;
    const r = await fetch(base + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* cuerpo vacío */ }
    return { status: r.status, json };
  }, { method, path, body, key: box.key, base: supabaseURL });
}

async function createOwnProduct(browser, data, tag) {
  const ctx = await qaContext(browser);
  try {
    const page = await ctx.newPage();
    const sufijo = sufijoUnico();
    const product = { productName: `${data.prefix} ${tag} Producto ${sufijo}`, barcode: `${data.barcode}-${tag}-${sufijo}`, initialStock: 10 };
    await login(page, 'ADMINISTRADOR', data);
    await createProduct(page, product);
    return product;
  } finally {
    await ctx.close();
  }
}

// Pedido de recojo con captura ficticia (no hay pago real).
async function placeOrder(browser, data, own, product) {
  const ctx = await qaContext(browser);
  try {
    const page = await ctx.newPage();
    await login(page, 'CLIENTE', own);
    await page.goto(`/productos/${product.productId}`);
    await page.getByRole('button', { name: /^Agregar al carrito/ }).filter({ visible: true }).first().click();
    await page.goto('/carrito');
    await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
    await page.getByRole('button', { name: 'Elige el día', exact: true }).click();
    const day = data.tomorrow; // siguiente día de atención (sin domingos), ver global-setup
    if (day.slice(0, 7) !== data.today.slice(0, 7)) await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click();
    await page.getByRole('button', { name: String(Number(day.slice(-2))), exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Elige la hora', exact: true }).click();
    await page.getByRole('button', { name: '11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Yape', exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: `${data.prefix}-NO-PAGO.png`, mimeType: 'image/png', buffer: await page.screenshot() });
    const submitted = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
    await page.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
    expect((await submitted).ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/inicio$/);
  } finally {
    await ctx.close();
  }
}

async function openOrder(admin, own) {
  await admin.goto('/pedidos-web');
  await admin.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
  const card = admin.getByRole('button').filter({ hasText: own.clientName });
  await card.click();
  return card;
}

async function verifyPayment(admin, own) {
  await openOrder(admin, own);
  const verified = admin.waitForResponse((r) => r.url().includes('/rpc/verificar_pago_pedido_web'));
  await admin.getByRole('button', { name: 'Verificar pago', exact: true }).click();
  const response = await verified;
  expect(response.ok(), 'verificar pago').toBeTruthy();
  return response.json();
}

test('QA-027: anular la venta de un pedido web cancela el pedido y bloquea la entrega', async ({ page, browser, data }, info) => {
  test.setTimeout(300_000);
  knownIssue(info, 'QA-027');
  const own = await isolatedClient(browser, data, 'Q027');
  const product = await createOwnProduct(browser, data, 'Q027');
  await placeOrder(browser, data, own, product);

  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const ventaId = await verifyPayment(page, own);
  // Pestaña "vieja": sigue mostrando el pedido LISTO con Marcar entregado.
  await expect(page.getByRole('button', { name: 'Marcar entregado', exact: true })).toBeVisible();
  const stock = async () => (await rest(page, key, 'GET', `/rest/v1/productos_vista?id=eq.${product.productId}&select=stock_actual`)).json[0].stock_actual;
  expect(await stock()).toBe(9);

  // Anulación por la interfaz de Historial (otra pestaña de la misma sesión).
  const historial = await page.context().newPage();
  const sale = (await rest(page, key, 'GET', `/rest/v1/ventas?id=eq.${ventaId}&select=codigo`)).json[0];
  await historial.goto('/historial');
  await historial.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);
  await historial.getByText(sale.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
  await visibleButton(historial, 'Anular venta').click();
  await visibleButton(historial, 'Sí, anular').click();
  await expect(historial.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();

  expect(await stock(), 'el stock se repone al anular').toBe(10);
  const order = (await rest(page, key, 'GET', `/rest/v1/pedidos_web?venta_id=eq.${ventaId}&select=id,estado,pago_verificado`)).json[0];
  expect(order.estado, 'el pedido ya no puede seguir LISTO con su venta anulada').toBe('CANCELADO');
  expect(order.pago_verificado, 'el pago sí se verificó: no se reescribe').toBe(true);

  // Pestaña vieja: Marcar entregado debe fallar con el motivo y refrescar el estado.
  await page.getByRole('button', { name: 'Marcar entregado', exact: true }).click();
  await expect(page.getByText(/venta de este pedido está anulada/)).toBeVisible();

  // Recarga: el pedido figura Cancelado y ya no ofrece entregar ni verificar.
  await page.reload();
  await openOrder(page, own);
  await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar entregado', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verificar pago', exact: true })).toHaveCount(0);

  // Backend (no solo ocultar el botón): ni LISTO ni ENTREGADO, y la segunda anulación se rechaza.
  for (const estado of ['ENTREGADO', 'LISTO']) {
    const intento = await rest(page, key, 'PATCH', `/rest/v1/pedidos_web?id=eq.${order.id}`, { estado });
    expect(intento.status, `PATCH a ${estado}`).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(intento.json)).toContain('anulada');
  }
  const segunda = await rest(page, key, 'POST', '/rest/v1/rpc/anular_venta', { p_venta_id: ventaId });
  expect(segunda.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(segunda.json)).toContain('ya está anulada');
  expect(await stock(), 'la segunda anulación no repone stock otra vez').toBe(10);
  const final = (await rest(page, key, 'GET', `/rest/v1/pedidos_web?id=eq.${order.id}&select=estado`)).json[0];
  expect(final.estado).toBe('CANCELADO');

  // La clienta ve el pedido cancelado.
  const ctx = await qaContext(browser);
  try {
    const cliente = await ctx.newPage();
    await login(cliente, 'CLIENTE', own);
    await cliente.goto('/mi-perfil/pedidos');
    await expect(cliente.getByText('Cancelado', { exact: true })).toBeVisible();
    await expect(cliente.getByText('Entregado', { exact: true })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

const IMPORTES_INVALIDOS = [
  ['5abc', '12'], ['5', '12abc'], ['5 abc', '12'], ['1e1', '12'], ['5', '0x10'], ['5', '1,5'],
  ['5', '12.345'], ['5.999', '12'], ['Infinity', '12'], ['5', 'Infinity'], ['abc', '12'],
  ['-1', '12'], ['', '12'], ['5', ''], ['5', '0'], ['5', '-3'],
];

test('QA-028: costo y precio rechazan textos parcialmente numéricos y guardan solo el valor completo', async ({ page, data }, info) => {
  test.setTimeout(150_000);
  knownIssue(info, 'QA-028');
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const sufijo = sufijoUnico();
  const nombre = `${data.prefix} Q028 Importes ${sufijo}`;
  const barcode = `${data.barcode}-Q028-${sufijo}`;
  let escrituras = 0;
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/productos?') && ['POST', 'PATCH'].includes(r.method())) escrituras += 1;
  });

  await page.goto('/inventario');
  await visibleButton(page, 'Nuevo producto').first().click();
  let form = formWithTitle(page, 'Nuevo producto');
  await form.getByLabel('Nombre', { exact: false }).fill(nombre);
  await form.getByLabel('Código de barras', { exact: true }).fill(barcode);
  await form.getByLabel('Stock inicial', { exact: false }).fill('1');
  for (const [costo, precio] of IMPORTES_INVALIDOS) {
    await form.getByLabel('Costo', { exact: false }).fill(costo);
    await form.getByLabel('Precio de venta', { exact: false }).fill(precio);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form.getByText(/^(El costo|El precio de venta) debe ser/), `costo=${JSON.stringify(costo)} precio=${JSON.stringify(precio)}`).toBeVisible();
  }
  // Precio antes con texto parcial
  await form.getByLabel('Costo', { exact: false }).fill('5');
  await form.getByLabel('Precio de venta', { exact: false }).fill('12');
  await form.getByLabel('Precio antes de la oferta', { exact: false }).fill('15abc');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form.getByText(/^El precio antes debe ser/)).toBeVisible();
  await form.getByLabel('Precio antes de la oferta', { exact: false }).fill('');
  expect(escrituras, 'ningún valor inválido llegó al servidor').toBe(0);

  // Valores válidos: costo decimal, precio con dos decimales
  await form.getByLabel('Costo', { exact: false }).fill('5.5');
  await form.getByLabel('Precio de venta', { exact: false }).fill('12.50');
  const created = page.waitForResponse((r) => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const creado = await created;
  expect(creado.ok()).toBeTruthy();
  expect(creado.request().postDataJSON()).toMatchObject({ costo: 5.5, precio: 12.5 });
  await expect(form).toHaveCount(0);

  const leer = async () => (await rest(page, key, 'GET', `/rest/v1/productos_vista?codigo_barras=eq.${barcode}&select=costo,precio`)).json[0];
  expect(Number((await leer()).costo)).toBe(5.5);
  expect(Number((await leer()).precio)).toBe(12.5);

  // Edición tras recarga: valores persistidos íntegros; texto parcial rechazado; costo 0 admisible
  await page.reload();
  await page.getByPlaceholder('Buscar producto...').fill(nombre);
  const fila = () => page.getByRole('row').filter({ has: page.getByText(nombre, { exact: true }) });
  await fila().getByRole('button', { name: 'Editar', exact: true }).click();
  form = formWithTitle(page, 'Editar producto');
  await expect(form.getByLabel('Costo', { exact: false })).toHaveValue('5.5');
  await expect(form.getByLabel('Precio de venta', { exact: false })).toHaveValue('12.5');
  const antes = escrituras;
  await form.getByLabel('Costo', { exact: false }).fill('2foo');
  await form.getByLabel('Precio de venta', { exact: false }).fill('8xyz');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(form.getByText(/^(El costo|El precio de venta) debe ser/)).toBeVisible();
  expect(escrituras, 'la edición inválida no se envió').toBe(antes);
  await form.getByLabel('Costo', { exact: false }).fill('0');
  await form.getByLabel('Precio de venta', { exact: false }).fill('8.25');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.reload();
  const editado = await leer();
  expect(Number(editado.costo)).toBe(0);
  expect(Number(editado.precio)).toBe(8.25);
});

test('QA-025: Estadísticas rotula Ingreso neto y coincide con Dashboard (bruto − descuentos)', async ({ page, browser, data }, info) => {
  test.setTimeout(180_000);
  knownIssue(info, 'QA-025');
  await login(page, 'ADMINISTRADOR', data);
  const product = await createOwnProduct(browser, data, 'Q025');
  // Venta ficticia por la interfaz del POS: 10 u. × S/1 = 10, descuento porcentual 20 (S/2), pago Yape.
  await page.goto('/ventas');
  await page.getByRole('searchbox').first().fill(product.productName);
  await page.getByRole('button', { name: new RegExp(product.productName) }).click();
  for (let i = 1; i < 10; i++) await page.getByRole('button', { name: '+', exact: true }).click();
  await page.getByLabel('Porcentaje de descuento', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const confirmada = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  expect((await confirmada).ok()).toBeTruthy();
  await page.reload(); // la impresión nativa automática es esperada; se recarga para continuar
  const monto = (texto) => Number(texto.replace(/[^\d.]/g, ''));

  await page.goto('/dashboard');
  const fila = (etiqueta) => page.getByText(etiqueta, { exact: true }).first().locator('xpath=following-sibling::span').first();
  await expect(fila('Ingreso bruto')).toBeVisible();
  const bruto = monto(await fila('Ingreso bruto').innerText());
  const descuentos = monto(await fila('Descuentos').innerText());
  expect(descuentos, 'el descuento de la venta ficticia debe verse').toBeGreaterThanOrEqual(2);
  // QA-031: el envío cobrado (ventas con delivery) es una línea propia; el neto sigue siendo sum(ventas.total).
  const envio = monto(await fila('Envío cobrado').innerText());
  const neto = Math.round((bruto - descuentos + envio) * 100) / 100;

  await page.goto('/estadisticas');
  const tarjeta = page.getByText('Ingreso neto', { exact: true }).first();
  await expect(tarjeta, 'la tarjeta se llama Ingreso neto').toBeVisible();
  await expect(page.getByText('Ingreso bruto', { exact: true }), 'Estadísticas no usa el nombre de Dashboard para otro importe').toHaveCount(0);
  const valor = monto(await tarjeta.locator('xpath=following-sibling::p').first().innerText());
  expect(valor, 'ingreso neto de Estadísticas = bruto − descuentos + envío de Dashboard (mismo período)').toBeCloseTo(neto, 2);
});

test.describe('QA-029: condiciones de adelanto y plazo sin marcadores', () => {
  async function abrirServicio(page, data, negocio) {
    let pedidos = 0;
    if (negocio) {
      await page.route('**/rest/v1/estado_negocio*', async (route) => {
        pedidos += 1;
        const respuesta = await route.fetch();
        const cuerpo = await respuesta.json();
        if (negocio.retraso) await new Promise((r) => setTimeout(r, negocio.retraso));
        await route.fulfill({ response: respuesta, json: { ...cuerpo, ...negocio.valores } });
      });
    }
    await login(page, 'CLIENTE', data);
    await page.goto(`/servicios/${data.serviceId}`);
    await expect(page.getByText('Adelanto obligatorio para separar tu cita', { exact: true })).toBeVisible();
    return () => pedidos;
  }
  const sinMarcadores = (page) => expect(page.locator('body')).not.toContainText(/\[S\/ X\]|\[24 h\]|\[[^\]]*\]/);

  test('configuración ausente (estado real de Local): texto claro sin inventar monto ni plazo', async ({ page, data }, info) => {
    knownIssue(info, 'QA-029');
    await abrirServicio(page, data, null);
    await expect(page.getByText(/Cambios o cancelación: consulta el plazo con el negocio/)).toBeVisible();
    await expect(page.getByText(/se paga el total del servicio por adelantado/)).toBeVisible();
    await sinMarcadores(page);
    await expect(page.locator('body')).not.toContainText(/hasta 24 h|hasta \d+ h antes/);
    await page.reload();
    await expect(page.getByText('Adelanto obligatorio para separar tu cita', { exact: true })).toBeVisible();
    await sinMarcadores(page);
  });

  for (const [titulo, valores, adelanto, plazo] of [
    ['configuración presente', { adelanto_minimo: 15.5, cancelacion_plazo_horas: 24 }, 'S/ 15.50', 'hasta 24 h antes'],
    ['valores límite mínimos', { adelanto_minimo: 0.01, cancelacion_plazo_horas: 1 }, 'S/ 0.01', 'hasta 1 h antes'],
    ['valores límite altos', { adelanto_minimo: 99999999.99, cancelacion_plazo_horas: 720 }, 'S/ 99999999.99', 'hasta 720 h antes'],
  ]) {
    test(titulo, async ({ page, data }, info) => {
      knownIssue(info, 'QA-029');
      await abrirServicio(page, data, { valores });
      await expect(page.getByText(`Deja el mínimo de ${adelanto} o paga el total`, { exact: false })).toBeVisible();
      await expect(page.getByText(`Cambios o cancelación ${plazo}`, { exact: true })).toBeVisible();
      await sinMarcadores(page);
    });
  }

  test('carga tardía: mientras llega la configuración no se publica ningún marcador ni condición provisional', async ({ page, data }, info) => {
    knownIssue(info, 'QA-029');
    await page.route('**/rest/v1/estado_negocio*', async (route) => {
      const respuesta = await route.fetch();
      const cuerpo = await respuesta.json();
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ response: respuesta, json: { ...cuerpo, adelanto_minimo: 15.5, cancelacion_plazo_horas: 24 } });
    });
    await login(page, 'CLIENTE', data);
    await page.goto(`/servicios/${data.serviceId}`);
    // Muestreo durante la espera: nunca un marcador ni una condición "por defecto" provisional.
    const inicio = Date.now();
    let muestras = 0;
    while (Date.now() - inicio < 2500) {
      const texto = await page.evaluate(() => document.body.innerText);
      expect(texto).not.toMatch(/\[S\/ X\]|\[24 h\]/);
      expect(texto).not.toContain('se paga el total del servicio por adelantado');
      expect(texto).not.toContain('consulta el plazo con el negocio');
      muestras += 1;
      await page.waitForTimeout(100);
    }
    expect(muestras).toBeGreaterThan(10);
    await expect(page.getByText('Deja el mínimo de S/ 15.50 o paga el total', { exact: false })).toBeVisible({ timeout: 15_000 });
    await sinMarcadores(page);
  });
});

test('QA-026: reseña de producto pendiente se modera desde Reseñas y la publicación respeta la aprobación', async ({ page, browser, data }, info) => {
  test.setTimeout(360_000);
  knownIssue(info, 'QA-026');
  const own = await isolatedClient(browser, data, 'Q026');
  const product = await createOwnProduct(browser, data, 'Q026');
  await placeOrder(browser, data, own, product);

  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  await verifyPayment(page, own);
  await page.getByRole('button', { name: 'Marcar entregado', exact: true }).click();
  await expect(page.getByText('Pedido actualizado.', { exact: true })).toBeVisible();

  const comentario = `${data.prefix} Q026 reseña ficticia, no es una compra real`;
  const ctx = await qaContext(browser);
  try {
    const cliente = await ctx.newPage();
    const claveCliente = watchApiKey(cliente);
    await login(cliente, 'CLIENTE', own);
    const abrirProducto = async () => {
      await cliente.goto(`/productos/${product.productId}`);
      await cliente.getByRole('heading', { name: 'Lo que dicen nuestras clientas' }).waitFor();
    };
    await abrirProducto();
    await cliente.getByRole('button', { name: /Escribir una reseña/ }).click();
    await cliente.getByRole('button', { name: '5 estrellas', exact: true }).click();
    await cliente.getByPlaceholder('Cuéntanos cómo te fue (opcional)').fill(comentario);
    const guardada = cliente.waitForResponse((r) => r.url().includes('/rpc/guardar_mi_resena_producto'));
    await cliente.getByRole('button', { name: 'Enviar reseña', exact: true }).click();
    expect((await guardada).ok()).toBeTruthy();
    await abrirProducto();
    await expect(cliente.getByText('Tu reseña está en revisión antes de publicarse.')).toBeVisible();
    await expect(cliente.getByText(comentario)).toHaveCount(0);

    // Administración: la reseña PENDIENTE es accesible y rotulada con su producto.
    await page.goto('/resenas-web');
    await page.getByPlaceholder('Buscar por clienta, producto o servicio...').fill(own.clientName);
    const tarjeta = page.getByRole('button').filter({ hasText: own.clientName });
    await expect(tarjeta, 'la reseña de producto aparece para moderar').toBeVisible();
    await expect(tarjeta).toContainText(`Producto: ${product.productName}`);
    await expect(tarjeta).toContainText('Pendiente');
    await tarjeta.click();
    await expect(page.getByText(comentario, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(page.getByText('Reseña publicada.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByPlaceholder('Buscar por clienta, producto o servicio...').fill(own.clientName);
    await expect(page.getByRole('button').filter({ hasText: own.clientName })).toContainText('Publicada');

    // Pública solo tras aprobar.
    await abrirProducto();
    await expect(cliente.getByText(comentario)).toBeVisible();

    // Quitar de la Web (mismo flujo que las reseñas generales).
    await page.getByRole('button').filter({ hasText: own.clientName }).click();
    await page.getByRole('button', { name: 'Quitar de la Web', exact: true }).click();
    await expect(page.getByText('Reseña rechazada.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByPlaceholder('Buscar por clienta, producto o servicio...').fill(own.clientName);
    await expect(page.getByRole('button').filter({ hasText: own.clientName })).toContainText('No publicada');
    await abrirProducto();
    await expect(cliente.getByText(comentario)).toHaveCount(0);

    // Permisos: la clienta no puede aprobar su propia reseña (RLS: solo administración actualiza).
    const reseñas = (await rest(page, key, 'GET', `/rest/v1/resenas_producto?producto_id=eq.${product.productId}&select=id,estado`)).json;
    expect(reseñas).toHaveLength(1);
    const intento = await rest(cliente, claveCliente, 'PATCH', `/rest/v1/resenas_producto?id=eq.${reseñas[0].id}`, { estado: 'APROBADA' });
    expect(intento.json ?? []).toEqual([]);
    const despues = (await rest(page, key, 'GET', `/rest/v1/resenas_producto?id=eq.${reseñas[0].id}&select=estado`)).json[0];
    expect(despues.estado, 'la clienta no pudo autoaprobarse').toBe('RECHAZADA');
  } finally {
    await ctx.close();
  }

  // Personal sin rol de administración: no ve ni modera reseñas pendientes.
  const ctxCajera = await qaContext(browser);
  try {
    const cajera = await ctxCajera.newPage();
    const claveCajera = watchApiKey(cajera);
    await login(cajera, 'CAJERA', data);
    const lectura = await rest(cajera, claveCajera, 'GET', `/rest/v1/resenas_producto?producto_id=eq.${product.productId}&select=id`);
    expect(lectura.json ?? []).toEqual([]);
    const escritura = await rest(cajera, claveCajera, 'PATCH', `/rest/v1/resenas_producto?producto_id=eq.${product.productId}`, { estado: 'APROBADA' });
    expect(escritura.json ?? []).toEqual([]);
  } finally {
    await ctxCajera.close();
  }
});
