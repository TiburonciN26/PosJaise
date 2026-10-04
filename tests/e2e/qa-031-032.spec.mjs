import { test, expect, knownIssue } from './fixtures.mjs';
import { sufijoUnico, login, visibleButton, formWithTitle, createProduct, createService } from './helpers.mjs';
import { isolatedClient, qaContext, testImage } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';

// Regresión de QA-031 (Dashboard separa el envío de los descuentos) y QA-032 (moderación de
// reseñas de servicio). Supabase Local TEST, datos ficticios, sin pagos reales.

function watchApiKey(page) {
  const box = { key: null };
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) box.key = k;
  });
  return box;
}

async function rest(page, box, method, path, body) {
  return page.evaluate(async ({ method, path, body, key, base }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const sesion = JSON.parse(localStorage.getItem(storageKey));
    const r = await fetch(base + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${sesion.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* cuerpo vacío */ }
    return { status: r.status, json, userId: sesion.user.id };
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

const monto = (texto) => Number(texto.replace(/[^\d.]/g, ''));
const redondear = (n) => Math.round(n * 100) / 100;

// Dashboard (RPC real + filas de la interfaz) y tarjeta de Estadísticas del mismo período (Este mes).
async function leerFinanzas(page) {
  const rpc = page.waitForResponse((r) => r.url().includes('/rpc/resumen_dashboard'));
  await page.goto('/dashboard');
  const fila = (await (await rpc).json())[0];
  await expect(page.getByText('Resumen del período', { exact: true })).toBeVisible();
  const ui = async (etiqueta) => monto(await page.getByText(etiqueta, { exact: true }).first().locator('xpath=following-sibling::span').first().innerText());
  const filas = { descuentos: await ui('Descuentos') };
  if (fila.envio_cobrado !== undefined) filas.envio = await ui('Envío cobrado');
  await page.goto('/estadisticas');
  const tarjeta = page.getByText('Ingreso neto', { exact: true }).first();
  await expect(tarjeta).toBeVisible();
  const neto = monto(await tarjeta.locator('xpath=following-sibling::p').first().innerText());
  return { fila, filas, neto };
}

test('QA-031: el envío no se resta de los descuentos y el neto de Dashboard sigue cuadrando con Estadísticas', async ({ page, browser, data }, info) => {
  test.setTimeout(360_000);
  knownIssue(info, 'QA-031');
  const own = await isolatedClient(browser, data, 'Q031');
  const product = await createOwnProduct(browser, data, 'Q031');
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const antes = await leerFinanzas(page);

  // Pedido DELIVERY de la clienta aislada (dirección y comprobante ficticios).
  const ctx = await qaContext(browser);
  let costoEnvio;
  try {
    const cliente = await ctx.newPage();
    await login(cliente, 'CLIENTE', own);
    await cliente.goto('/mi-perfil/direcciones');
    await visibleButton(cliente, 'Agregar').click();
    const form = cliente.locator('form').filter({ has: cliente.locator('#direccion-etiqueta') });
    await form.getByLabel('Etiqueta', { exact: false }).fill('TEST Delivery');
    await form.getByLabel('Dirección', { exact: false }).fill('TEST Calle ficticia 431');
    await form.getByRole('checkbox', { name: 'Usar como predeterminada', exact: true }).check();
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form).toHaveCount(0);
    await cliente.goto(`/productos/${product.productId}`);
    await cliente.getByRole('button', { name: /^Agregar al carrito/ }).filter({ visible: true }).first().click();
    const zonasCargadas = cliente.waitForResponse((r) => r.url().includes('/rest/v1/zonas_delivery'));
    await cliente.goto('/carrito');
    const zonas = await (await zonasCargadas).json();
    test.skip(!zonas.length, 'No hay zonas de delivery configuradas; no se cambia configuración.');
    costoEnvio = Number(zonas[0].costo);
    await expect(cliente.getByText('TEST Calle ficticia 431', { exact: true })).toBeVisible();
    await cliente.getByLabel('Zona', { exact: true }).selectOption(zonas[0].id);
    await visibleButton(cliente, 'Elige el día').click();
    await cliente.getByRole('button', { name: String(Number(data.tomorrow.slice(-2))), exact: true }).filter({ visible: true }).first().click();
    await visibleButton(cliente, 'Elige la hora').click();
    await visibleButton(cliente, '11:00').click();
    await cliente.locator('input[type=file]').setInputFiles(await testImage(cliente));
    await expect(cliente.getByText('Captura adjunta', { exact: true })).toBeVisible();
    const enviada = cliente.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
    await cliente.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
    expect((await enviada).ok()).toBeTruthy();
  } finally {
    await ctx.close();
  }

  // Administración verifica el pago: nace la venta (ítems S/1 + envío).
  await page.goto('/pedidos-web');
  await page.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
  await page.getByRole('button').filter({ hasText: own.clientName }).click();
  const verificada = page.waitForResponse((r) => r.url().includes('/rpc/verificar_pago_pedido_web'));
  await page.getByRole('button', { name: 'Verificar pago', exact: true }).click();
  const ventaId = await (await verificada).json();

  const durante = await leerFinanzas(page);
  expect(redondear(Number(durante.fila.descuentos) - Number(antes.fila.descuentos)), 'una venta con envío y sin descuento no cambia los descuentos').toBe(0);
  expect(redondear(Number(durante.fila.envio_cobrado) - Number(antes.fila.envio_cobrado)), 'el envío cobrado se muestra aparte').toBe(costoEnvio);
  expect(redondear(durante.filas.descuentos - antes.filas.descuentos)).toBe(0);
  expect(redondear(durante.filas.envio - antes.filas.envio)).toBe(costoEnvio);
  const netoDashboard = (f) => redondear(Number(f.ingreso_productos) + Number(f.ingreso_servicios) - Number(f.descuentos) + Number(f.envio_cobrado));
  expect(netoDashboard(durante.fila), 'neto de Dashboard = Ingreso neto de Estadísticas').toBe(durante.neto);
  expect(redondear(durante.neto - antes.neto), 'el neto sube lo vendido más el envío').toBe(redondear(1 + costoEnvio));

  // Recarga: mismos valores.
  const recarga = await leerFinanzas(page);
  expect(Number(recarga.fila.descuentos)).toBe(Number(durante.fila.descuentos));
  expect(Number(recarga.fila.envio_cobrado)).toBe(Number(durante.fila.envio_cobrado));

  // Anulación: la venta y su envío salen del período y los descuentos no cambian.
  const venta = (await rest(page, key, 'GET', `/rest/v1/ventas?id=eq.${ventaId}&select=codigo`)).json[0];
  const historial = await page.context().newPage();
  await historial.goto('/historial');
  await historial.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo);
  await historial.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
  await visibleButton(historial, 'Anular venta').click();
  await visibleButton(historial, 'Sí, anular').click();
  await expect(historial.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
  const final = await leerFinanzas(page);
  expect(Number(final.fila.descuentos)).toBe(Number(antes.fila.descuentos));
  expect(Number(final.fila.envio_cobrado)).toBe(Number(antes.fila.envio_cobrado));
  expect(final.neto).toBe(antes.neto);
});

test('QA-032: reseña de servicio pendiente se modera desde Reseñas y la publicación respeta la aprobación', async ({ page, browser, data }, info) => {
  test.setTimeout(420_000);
  knownIssue(info, 'QA-032');
  const own = await isolatedClient(browser, data, 'Q032');
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const adminId = (await rest(page, key, 'GET', '/rest/v1/asistentes?select=id&limit=1')).userId;

  // La cita solo la completa la persona asignada: ficha de asistente vinculada a la cuenta ADMIN QA.
  const fichas = (await rest(page, key, 'GET', `/rest/v1/asistentes?usuario_id=eq.${adminId}&select=id,nombres_completos`)).json;
  let ficha = fichas[0]?.nombres_completos;
  if (!ficha) {
    ficha = `${data.prefix} Q032 Ficha`;
    await page.goto('/asistentes');
    await visibleButton(page, 'Nueva asistente').first().click();
    const form = formWithTitle(page, 'Nueva asistente');
    await form.getByLabel('Nombres completos', { exact: false }).fill(ficha);
    await form.getByLabel('Cuenta de acceso', { exact: true }).selectOption(adminId);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form).toHaveCount(0);
  }

  // Nombre ÚNICO por ejecución: con QA_REUSE_FIXTURES el servicio de una corrida anterior seguía en la lista
  // y first() elegía ese mientras se consultaba el ID del nuevo.
  const servicio = { serviceName: `${data.prefix} Q032 Servicio ${Date.now().toString(36)}` };
  await createService(page, servicio);

  await page.goto('/citas');
  await visibleButton(page, 'Nueva cita').first().click();
  const formCita = formWithTitle(page, 'Nueva cita');
  await formCita.getByPlaceholder('Buscar cliente...').fill(own.clientName);
  await formCita.getByRole('button', { name: own.clientName, exact: true }).click();
  await formCita.getByPlaceholder('Buscar servicio...').fill(servicio.serviceName);
  const sugerenciaServicio = formCita.getByRole('button', { name: new RegExp(`^${servicio.serviceName} \\d+ min$`) });
  await expect(sugerenciaServicio).toHaveCount(1);
  await sugerenciaServicio.click();
  await expect(formCita.getByText(servicio.serviceName, { exact: true })).toBeVisible(); // línea agregada antes de Agendar
  await formCita.getByLabel('Asistente', { exact: true }).selectOption({ label: ficha });
  const dia = new Date(`${data.today}T12:00:00-05:00`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(dia);
  await formCita.getByLabel('Fecha y hora', { exact: false }).fill(`${fecha}T10:00`);
  const creada = page.waitForResponse((r) => r.url().includes('/rpc/guardar_cita_pos'));
  await formCita.getByRole('button', { name: 'Agendar', exact: true }).click();
  expect((await creada).ok()).toBeTruthy();
  await expect(formCita).toHaveCount(0);

  // Abrir la cita y completarla por la interfaz.
  await page.reload();
  await page.getByRole('button', { name: /^(Mostrar|Ocultar) canceladas$/ }).filter({ visible: true }).waitFor();
  if (fecha.slice(0, 7) !== data.today.slice(0, 7)) {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    await page.getByRole('button', { name: new RegExp(`^${meses[Number(data.today.slice(5, 7)) - 1]} ${data.today.slice(0, 4)}$`, 'i') }).click();
    await page.getByRole('button', { name: new RegExp(`^${meses[Number(fecha.slice(5, 7)) - 1]}$`, 'i') }).click();
  }
  await visibleButton(page, 'Buscar citas').click();
  await page.getByPlaceholder('Buscar por cliente o servicio...').fill(servicio.serviceName);
  await page.getByRole('button').filter({ hasText: own.clientName }).filter({ hasText: servicio.serviceName }).filter({ visible: true }).click();
  await visibleButton(page, 'Completar').click();
  const completada = page.waitForResponse((r) => r.request().method() !== 'GET' && /rpc\/completar|registro_servicios|citas\?/.test(r.url()));
  await visibleButton(page, 'Confirmar y completar').click();
  expect((await completada).ok()).toBeTruthy();
  await expect.poll(async () => (await rest(page, key, 'GET', `/rest/v1/citas?cliente_id=not.is.null&select=estado,cita_servicios!inner(servicio_id)&cita_servicios.servicio_id=eq.${servicio.serviceId}`)).json?.[0]?.estado).toBe('COMPLETADA');

  // La clienta reseña el servicio.
  const comentario = `${data.prefix} Q032 reseña de servicio ficticia, no real`;
  const ctx = await qaContext(browser);
  try {
    const cliente = await ctx.newPage();
    const claveCliente = watchApiKey(cliente);
    await login(cliente, 'CLIENTE', own);
    const abrirServicio = async () => {
      await cliente.goto(`/servicios/${servicio.serviceId}`);
      await cliente.getByRole('heading', { name: 'Lo que dicen nuestras clientas' }).waitFor();
    };
    await abrirServicio();
    await cliente.getByRole('button', { name: /Escribir una reseña/ }).click();
    await cliente.getByRole('button', { name: '5 estrellas', exact: true }).click();
    await cliente.getByPlaceholder('Cuéntanos cómo te fue (opcional)').fill(comentario);
    const guardada = cliente.waitForResponse((r) => r.url().includes('/rpc/guardar_mi_resena_servicio'));
    await cliente.getByRole('button', { name: 'Enviar reseña', exact: true }).click();
    expect((await guardada).ok()).toBeTruthy();
    await abrirServicio();
    await expect(cliente.getByText('Tu reseña está en revisión antes de publicarse.')).toBeVisible();
    await expect(cliente.getByText(comentario)).toHaveCount(0);

    // Administración: la reseña PENDIENTE es accesible y rotulada con su servicio.
    await page.goto('/resenas-web');
    await page.getByPlaceholder(/^Buscar por clienta/).fill(own.clientName);
    const tarjeta = page.getByRole('button').filter({ hasText: own.clientName });
    await expect(tarjeta, 'la reseña de servicio aparece para moderar').toBeVisible();
    await expect(tarjeta).toContainText(`Servicio: ${servicio.serviceName}`);
    await expect(tarjeta).toContainText('Pendiente');
    await tarjeta.click();
    await expect(page.getByText(comentario, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(page.getByText('Reseña publicada.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByPlaceholder(/^Buscar por clienta/).fill(own.clientName);
    await expect(page.getByRole('button').filter({ hasText: own.clientName })).toContainText('Publicada');

    // Pública solo tras aprobar.
    await abrirServicio();
    await expect(cliente.getByText(comentario)).toBeVisible();

    // Quitar de la Web.
    await page.getByRole('button').filter({ hasText: own.clientName }).click();
    await page.getByRole('button', { name: 'Quitar de la Web', exact: true }).click();
    await expect(page.getByText('Reseña rechazada.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByPlaceholder(/^Buscar por clienta/).fill(own.clientName);
    await expect(page.getByRole('button').filter({ hasText: own.clientName })).toContainText('No publicada');
    await abrirServicio();
    await expect(cliente.getByText(comentario)).toHaveCount(0);

    // Permisos: la clienta no puede autoaprobarse.
    const reseñas = (await rest(page, key, 'GET', `/rest/v1/resenas_servicio?servicio_id=eq.${servicio.serviceId}&select=id,estado`)).json;
    expect(reseñas).toHaveLength(1);
    const intento = await rest(cliente, claveCliente, 'PATCH', `/rest/v1/resenas_servicio?id=eq.${reseñas[0].id}`, { estado: 'APROBADA' });
    expect(intento.json ?? []).toEqual([]);
    const despues = (await rest(page, key, 'GET', `/rest/v1/resenas_servicio?id=eq.${reseñas[0].id}&select=estado`)).json[0];
    expect(despues.estado, 'la clienta no pudo autoaprobarse').toBe('RECHAZADA');
  } finally {
    await ctx.close();
  }

  // Personal sin rol de administración: no lee ni modifica reseñas pendientes.
  const ctxCajera = await qaContext(browser);
  try {
    const cajera = await ctxCajera.newPage();
    const claveCajera = watchApiKey(cajera);
    await login(cajera, 'CAJERA', data);
    const lectura = await rest(cajera, claveCajera, 'GET', `/rest/v1/resenas_servicio?servicio_id=eq.${servicio.serviceId}&select=id`);
    expect(lectura.json ?? []).toEqual([]);
    const escritura = await rest(cajera, claveCajera, 'PATCH', `/rest/v1/resenas_servicio?servicio_id=eq.${servicio.serviceId}`, { estado: 'APROBADA' });
    expect(escritura.json ?? []).toEqual([]);
  } finally {
    await ctxCajera.close();
  }
});
