import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import { login, formWithTitle, createAttention, createService } from './helpers.mjs';

test('QA-003: stock decimal debe rechazarse, nunca truncarse', async ({ page, data }, info) => {
  knownIssue(info, 'QA-003');
  await login(page, 'ADMINISTRADOR', data);
  await page.goto('/inventario');
  await page.getByPlaceholder('Buscar producto...').fill(data.productName);
  await page.getByRole('row').filter({ has: page.getByText(data.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
  const form = formWithTitle(page, 'Editar producto');
  await expect(form.getByLabel('Stock actual', { exact: false })).toHaveValue('10');
  await form.getByLabel('Stock actual', { exact: false }).fill('2.7');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardando...', exact: true })).toHaveCount(0);
  const rejected = (await form.count()) > 0;
  if (rejected) await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await page.getByPlaceholder('Buscar producto...').fill(data.productName);
  await page.getByRole('row').filter({ has: page.getByText(data.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
  const reopened = formWithTitle(page, 'Editar producto');
  const actual = await reopened.getByLabel('Stock actual', { exact: false }).inputValue();
  await info.attach('stock-observado', { body: Buffer.from(JSON.stringify({ entered: 2.7, before: 10, persisted: actual, rejected })), contentType: 'application/json' });
  if (actual !== '10') expect(actual, 'La reproducción conocida trunca 2.7 a 2; otro resultado requiere investigación').toBe('2');
  // Evidence collected before marking failure. Test asserts rejection/preservation.
  expectKnownFailure('QA-003');
  expect(actual, 'El valor inválido no debe cambiar el stock anterior').toBe('10');
});

test('QA-006: teléfono alfabético debe rechazarse', async ({ page, data }, info) => {
  knownIssue(info, 'QA-006');
  await login(page, 'CLIENTE', data);
  await page.goto('/mi-perfil');
  await expect(page.getByText(data.clientName, { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#perfil-nombre')).toHaveValue(data.clientName);
  await page.getByLabel('Teléfono', { exact: true }).fill(`TEST-abc-${data.runId}`);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardando...', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(data.clientName, { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const actual = await page.getByLabel('Teléfono', { exact: true }).inputValue();
  await info.attach('telefono-observado', { body: Buffer.from(JSON.stringify({ name: data.clientName, entered: `TEST-abc-${data.runId}`, persisted: actual, original: data.phone })), contentType: 'application/json' });
  // Restore this run's fictional phone via UI even when the assertion fails.
  await page.getByLabel('Teléfono', { exact: true }).fill(data.phone);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Perfil guardado.', { exact: true })).toBeVisible();
  expectKnownFailure('QA-006');
  expect(actual).toBe(data.phone);
});

test('QA-007: detalle público no debe mostrar marcadores pendientes', async ({ page, data }, info) => {
  knownIssue(info, 'QA-007');
  await login(page, 'CLIENTE', data);
  await page.goto(`/productos/${data.productId}`);
  await expect(page.getByRole('heading', { name: data.productName })).toBeVisible();
  const text = await page.locator('body').innerText();
  expectKnownFailure('QA-007');
  expect(text).not.toMatch(/\[ZONA\]|\[S\/ X\]|\[1–2 días\]|\[7 días\]/);
});

test('QA-008: cliente sin compra/reseña no debe ver Editar tu reseña', async ({ page, data }, info) => {
  knownIssue(info, 'QA-008');
  await login(page, 'CLIENTE', data);
  await page.goto(`/productos/${data.productId}`);
  await expect(page.getByRole('heading', { name: data.productName })).toBeVisible();
  await expect(page.getByRole('button', { name: /Editar tu reseña|Escribir una reseña/ })).toBeVisible();
  expectKnownFailure('QA-008');
  await expect(page.getByRole('button', { name: 'Editar tu reseña', exact: true })).toHaveCount(0);
});

test('QA-008 seguridad: backend rechaza reseña sin compra entregada', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto(`/productos/${data.productId}`);
  await page.getByRole('button', { name: /Editar tu reseña|Escribir una reseña/ }).click();
  await page.getByRole('button', { name: '5 estrellas', exact: true }).click();
  await page.getByPlaceholder('Cuéntanos cómo te fue (opcional)').fill(`${data.prefix} reseña no autorizada TEST`);
  await page.getByRole('button', { name: 'Enviar reseña', exact: true }).click();
  await expect(page.getByText('Solo pueden reseñar las clientas que ya compraron este producto.', { exact: true }).first()).toBeVisible();
  // Distinguish the static eligibility caption from the RPC rejection itself.
  await expect(page.getByText('Solo pueden reseñar las clientas que ya compraron este producto.', { exact: true })).toHaveCount(2);
});

test('QA-010: historial de atención debe tener un día válido', async ({ page, data }, info) => {
  knownIssue(info, 'QA-010');
  await login(page, 'CLIENTE', data);
  await page.goto('/historial');
  await expect(page.getByText(data.serviceName, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(data.serviceName, { exact: true })).toBeVisible();
  const text = await page.locator('body').innerText();
  expectKnownFailure('QA-010');
  expect(text).not.toContain('NaN');
});

test('QA-011: modo clienta de cajera no debe incluir atención del CLIENTE aislado', async ({ page, data }, info) => {
  knownIssue(info, 'QA-011');
  await login(page, 'CAJERA', data);
  await page.getByRole('button', { name: 'Menú de usuario', exact: true }).click();
  await page.getByRole('button', { name: 'Mi perfil de clienta', exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto('/historial');
  await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).waitFor();
  await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0);
  expectKnownFailure('QA-011');
  await expect(page.getByText(data.serviceName, { exact: true })).toHaveCount(0);
});

test('QA-012: dos atenciones del mismo día deben contar una visita', async ({ page, browser, data }, info) => {
  knownIssue(info, 'QA-012');
  await login(page, 'CLIENTE', data);
  await page.goto('/fidelizacion');
  await expect(page.getByText('1 de 5 visitas', { exact: true })).toBeVisible();
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  const { localNetworkOnly } = await import('./local-safety.mjs');
  await localNetworkOnly(adminContext);
  try {
    const admin = await adminContext.newPage();
    await login(admin, 'ADMINISTRADOR', data);
    await createAttention(admin, data, '10:45');
  } finally { await adminContext.close(); }
  await page.reload();
  await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver historial de visitas', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0);
  // Recompensas muestra un esqueleto (no el texto "Cargando..."): se espera al dato real antes de leer.
  await expect(page.getByText('1 de 5 visitas', { exact: true })).toBeVisible();
  const loyalty = await page.locator('body').innerText();
  // Recompensas carga mis_puntos en cualquier subpestaña: se espera a que terminen las consultas de la
  // pantalla anterior para no capturar una respuesta cuyo cuerpo se descarta al navegar (error del arnés).
  await page.waitForLoadState('networkidle');
  const pointsResult = page.waitForResponse(r => r.url().includes('/rpc/mis_puntos'));
  await page.goto('/mis-puntos');
  const points = await (await pointsResult).json();
  expect(points).toHaveLength(1);
  expect(typeof points[0].puntos).toBe('number');
  await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0);
  await info.attach('visitas-puntos', { body: Buffer.from(JSON.stringify({ loyalty, points })), contentType: 'application/json' });
  expectKnownFailure('QA-012');
  // Both observations come from real UI data requests; no RPC is called by tests.
  expect.soft(points[0].puntos, 'Dos atenciones del día deben contar un solo punto por visita').toBe(1);
  expect(loyalty).toContain('1 de 5 visitas');
});

test('QA-004: interrupción tras borrar líneas debe conservar servicios', async ({ page, data }, info) => {
  knownIssue(info, 'QA-004');
  await login(page, 'ADMINISTRADOR', data);
  // Servicio ÚNICO por ejecución del caso: con fixtures reutilizados (QA_REUSE_FIXTURES) varias citas de la
  // misma clienta comparten el servicio del fixture y la búsqueda por clienta devolvía dos. Se prepara ANTES
  // de abrir el modal y la cita se identifica por este servicio.
  const unico = { serviceName: `${data.prefix} Q004 ${Date.now().toString(36)}` };
  await createService(page, unico);
  await page.goto('/citas');
  await page.getByRole('button', { name: 'Nueva cita', exact: true }).filter({ visible: true }).click();
  const form = formWithTitle(page, 'Nueva cita');
  await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);
  await form.getByRole('button', { name: data.clientName, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(unico.serviceName);
  const sugerencia = form.getByRole('button', { name: new RegExp(`^${unico.serviceName} \\d+ min$`) });
  await expect(sugerencia).toHaveCount(1);
  await sugerencia.click();
  await expect(form.getByText(unico.serviceName, { exact: true })).toBeVisible();
  // Create a separate future appointment; do not reuse manual-audit records.
  const date = new Date(`${data.today}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + 2);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(date);
  await form.getByLabel('Fecha y hora', { exact: false }).fill(`${day}T14:15`);
  await form.getByLabel('Nota', { exact: true }).fill(`${data.prefix} QA-004`);
  await form.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(form).toHaveCount(0);
  async function findAppointment() {
    // App uses "septiembre" whereas Intl es-PE uses "setiembre".
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const currentName = `${months[Number(data.today.slice(5, 7)) - 1]} ${data.today.slice(0, 4)}`;
    const targetMonth = months[Number(day.slice(5, 7)) - 1];
    if (day.slice(0, 7) !== data.today.slice(0, 7)) {
      await page.getByRole('button', { name: new RegExp(`^${currentName}$`, 'i') }).click();
      await page.getByRole('button', { name: new RegExp(`^${targetMonth}$`, 'i') }).click();
    }
    await page.getByRole('button', { name: 'Buscar citas', exact: true }).click();
    await page.getByPlaceholder('Buscar por cliente o servicio...').fill(unico.serviceName);
    const cita = page.getByRole('button').filter({ hasText: data.clientName }).filter({ hasText: unico.serviceName }).filter({ visible: true });
    await expect(cita, 'una sola cita con el servicio único de este caso').toHaveCount(1);
    await cita.click();
  }
  await findAppointment();
  await page.getByRole('button', { name: 'Editar', exact: true }).filter({ visible: true }).click();
  const editing = formWithTitle(page, 'Editar cita');
  await expect(editing.getByText(unico.serviceName, { exact: true })).toBeVisible();
  await editing.getByLabel('Fecha y hora', { exact: false }).fill(`${day}T15:15`);
  // Guardar una cita ahora es UN solo RPC atómico (guardar_cita_pos, migración
  // 20261002000001): no hay un DELETE intermedio que pueda quedar confirmado
  // sin su INSERT. La interrupción equivalente: el servidor ejecuta el RPC real
  // (route.fetch) pero la respuesta se pierde y la página se recarga, como un
  // corte de red justo después de "Guardar cambios". No se simula ningún éxito
  // ni error: la petición llega de verdad al servidor.
  let reenviado;
  const respuesta = new Promise(resolve => { reenviado = resolve; });
  await page.route('**/rest/v1/rpc/guardar_cita_pos*', async route => {
    const real = await route.fetch();
    reenviado(real.status());
    await route.abort('aborted');
  });
  await editing.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  expect(await respuesta, 'El RPC real debe haber llegado al servidor y respondido OK').toBeLessThan(300);
  await page.reload();
  await page.unroute('**/rest/v1/rpc/guardar_cita_pos*');
  await findAppointment();
  const body = await page.locator('body').innerText();
  await info.attach('interrupcion-real', { body: Buffer.from(JSON.stringify({ prefix: data.prefix, date: day, rpcResponded: true, reloaded: true, observed: body })), contentType: 'application/json' });
  expectKnownFailure('QA-004');
  await expect(page.getByText(unico.serviceName, { exact: true }).filter({ visible: true })).not.toHaveCount(0);
});

test('QA-005: reclamar promoción debe guardar un cupón sin error SQL', async ({ page, browser, data }, info) => {
  knownIssue(info, 'QA-005');
  await login(page, 'CLIENTE', data);
  await page.goto('/inicio');
  await expect(page.getByText(data.promotionName, { exact: true })).toBeVisible();
  const result = page.waitForResponse(r => r.url().includes('/rpc/reclamar_cupon_promocion'));
  await page.getByRole('button', { name: 'Reclamar cupón', exact: true }).click();
  const response = await result;
  const body = await response.json();
  await info.attach('rpc-result', { body: Buffer.from(JSON.stringify({ status: response.status(), body })), contentType: 'application/json' });
  if (!response.ok()) {
    expect(body.message).toContain('column reference "id" is ambiguous');
    await expect(page.getByText('column reference "id" is ambiguous', { exact: true })).toBeVisible();
  }
  // Deactivate only this run's promotion through UI to avoid masking subsequent
  // runs' promotion on Inicio. No existing promotion/config is changed.
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  const { localNetworkOnly } = await import('./local-safety.mjs');
  await localNetworkOnly(adminContext);
  try {
    const admin = await adminContext.newPage();
    await login(admin, 'ADMINISTRADOR', data);
    await admin.goto('/promociones');
    const card = admin.locator('div.rounded-lg.border').filter({ has: admin.getByText(data.promotionName, { exact: true }) }).filter({ has: admin.getByRole('button', { name: 'Editar', exact: true }) }).last();
    await admin.getByText(data.promotionName, { exact: true }).click();
    await card.getByRole('button', { name: 'Editar', exact: true }).click();
    const editing = formWithTitle(admin, 'Editar promoción');
    await editing.getByRole('button', { name: 'Inactiva', exact: true }).click();
    await editing.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(editing).toHaveCount(0);
  } finally { await adminContext.close(); }
  expectKnownFailure('QA-005');
  expect(response.ok(), 'Reclamar debe completar la transacción').toBeTruthy();
});

test('QA-009: verificar pago Yape del pedido aislado debe crear venta', async ({ page, browser, data }, info) => {
  test.setTimeout(90_000);
  knownIssue(info, 'QA-009');
  await login(page, 'CLIENTE', data);
  await page.goto(`/productos/${data.productId}`);
  await page.getByRole('button', { name: /^Agregar al carrito/ }).click();
  await page.goto('/carrito');
  await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
  await page.getByRole('button', { name: 'Elige el día', exact: true }).click();
  // Choose tomorrow; no payment is made. The upload is a generated screenshot.
  const day = data.tomorrow; // siguiente día de atención (sin domingos), ver global-setup
  if (day.slice(0, 7) !== data.today.slice(0, 7)) await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click();
  await page.getByRole('button', { name: String(Number(day.slice(-2))), exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Elige la hora', exact: true }).click();
  await page.getByRole('button', { name: '11:00', exact: true }).click();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const proof = await page.screenshot();
  await page.locator('input[type="file"]').setInputFiles({ name: `${data.prefix}-NO-PAGO.png`, mimeType: 'image/png', buffer: proof });
  const submitted = page.waitForResponse(r => r.url().includes('/rpc/confirmar_pedido_productos'));
  await page.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
  expect((await submitted).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/inicio$/);
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  const { localNetworkOnly } = await import('./local-safety.mjs');
  await localNetworkOnly(adminContext);
  let status;
  try {
    const admin = await adminContext.newPage();
    await login(admin, 'ADMINISTRADOR', data);
    await admin.goto('/pedidos-web');
    await admin.getByPlaceholder('Buscar por clienta...').fill(data.clientName);
    await admin.getByRole('button').filter({ hasText: data.clientName }).click();
    const verified = admin.waitForResponse(r => r.url().includes('/rpc/verificar_pago_pedido_web'));
    await admin.getByRole('button', { name: 'Verificar pago', exact: true }).click();
    const response = await verified;
    status = response.status();
    const body = await response.json();
    await info.attach('verificar-pago', { body: Buffer.from(JSON.stringify({ status, body })), contentType: 'application/json' });
    if (!response.ok()) {
      expect(body.message).toContain('ventas_metodo_pago_check');
      await expect(admin.getByText(/ventas_metodo_pago_check/)).toBeVisible();
    }
    await info.attach('pedido-error', { body: await admin.screenshot({ fullPage: true }), contentType: 'image/png' });
    await admin.reload();
    await admin.getByPlaceholder('Buscar por clienta...').fill(data.clientName);
    await admin.getByRole('button').filter({ hasText: data.clientName }).click();
    if (!response.ok()) await expect(admin.getByRole('button', { name: 'Verificar pago', exact: true })).toBeVisible();
    else await expect(admin.getByRole('button', { name: 'Marcar entregado', exact: true })).toBeVisible();
  } finally { await adminContext.close(); }
  expectKnownFailure('QA-009');
  expect(status).toBe(200);
});
