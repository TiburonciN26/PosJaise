import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import { sufijoUnico, login, logout, formWithTitle, createAttention, createService, createProduct, abrirBuscadorCitas } from './helpers.mjs';
import { isolatedClient } from './phase2-helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test('QA-003: stock decimal debe rechazarse, nunca truncarse', async ({ page, data }, info) => {
  knownIssue(info, 'QA-003');
  await login(page, 'ADMINISTRADOR', data);
  // Ficha PROPIA del caso (stock 10, nombre y código únicos): no depende de ventas ni ediciones de otras corridas
  // sobre la ficha global, y el stock inicial no se fuerza en ningún dato compartido.
  const sufijo = sufijoUnico();
  const propio = { productName: `${data.prefix} Q003 ${sufijo}`, barcode: `${data.barcode}-Q003-${sufijo}`, initialStock: 10 };
  await createProduct(page, propio);
  const escrituras = [];
  page.on('response', (r) => {
    if (r.url().includes('/rest/v1/productos?') && ['PATCH', 'POST'].includes(r.request().method()) && r.status() < 300) escrituras.push(r.request().method());
  });
  await page.goto('/inventario');
  await page.getByPlaceholder('Buscar producto...').fill(propio.productName);
  await page.getByRole('row').filter({ has: page.getByText(propio.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
  const form = formWithTitle(page, 'Editar producto');
  await expect(form.getByLabel('Stock actual', { exact: false })).toHaveValue('10');
  await form.getByLabel('Stock actual', { exact: false }).fill('2.7');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardando...', exact: true })).toHaveCount(0);
  const rejected = (await form.count()) > 0;
  if (rejected) await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await page.getByPlaceholder('Buscar producto...').fill(propio.productName);
  await page.getByRole('row').filter({ has: page.getByText(propio.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
  const reopened = formWithTitle(page, 'Editar producto');
  const actual = await reopened.getByLabel('Stock actual', { exact: false }).inputValue();
  const enBd = await h.json(`select to_json(stock_actual) from public.productos where id='${propio.productId}'`);
  await info.attach('stock-observado', { body: Buffer.from(JSON.stringify({ entered: 2.7, before: 10, persisted: actual, persistedDb: enBd, rejected, escriturasExitosas: escrituras })), contentType: 'application/json' });
  if (actual !== '10') expect(actual, 'La reproducción conocida trunca 2.7 a 2; otro resultado requiere investigación').toBe('2');
  // Evidence collected before marking failure. Test asserts rejection/preservation.
  expectKnownFailure('QA-003');
  expect(actual, 'El valor inválido no debe cambiar el stock anterior').toBe('10');
  expect(Number(enBd), 'ni en la base de datos').toBe(10);
  expect(escrituras, 'la entrada inválida no debe producir escrituras exitosas').toEqual([]);
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

test('QA-010: historial de atención debe tener un día válido', async ({ page, browser, data }, info) => {
  knownIssue(info, 'QA-010');
  // Servicio y atención PROPIOS del caso (nombre único): la ficha global puede tener otras atenciones de la misma
  // clienta, y aquí hay que identificar LA atención de este caso, no cualquiera con ese servicio.
  const propio = { ...data, serviceName: `${data.prefix} Q010 ${sufijoUnico()}` };
  await login(page, 'ADMINISTRADOR', propio);
  await createService(page, propio);
  await createAttention(page, propio, '10:20');
  await logout(page);
  await login(page, 'CLIENTE', data);
  await page.goto('/historial');
  const registro = page.getByText(propio.serviceName, { exact: true });
  await expect(registro).toHaveCount(1);
  await page.reload();
  await expect(registro).toHaveCount(1);
  // La fecha de ESA atención (misma tarjeta) debe ser un día válido: se acota a la tarjeta que contiene el servicio.
  const tarjeta = page.locator('div, li, article').filter({ has: registro }).last();
  const textoTarjeta = await tarjeta.innerText();
  const text = await page.locator('body').innerText();
  expectKnownFailure('QA-010');
  expect(textoTarjeta, 'la fecha de la atención del caso').not.toContain('NaN');
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
    await (await abrirBuscadorCitas(page)).fill(unico.serviceName);
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
  const { localNetworkOnly } = await import('./local-safety.mjs');
  // Promoción PROPIA del caso, con vigencia (hoy) y título únicos: la de la preparación global puede estar inactiva
  // por una corrida anterior. La clienta aislada no tiene cupones previos, así que el único cupón posible es el reclamado.
  const own = await isolatedClient(browser, data, 'Q005');
  const titulo = `${data.prefix} Promoción Q005 ${sufijoUnico()}`;
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  await localNetworkOnly(adminContext);
  const admin = await adminContext.newPage();
  let promocionId = null;
  try {
    await login(admin, 'ADMINISTRADOR', data);
    await admin.goto('/promociones');
    await admin.getByRole('button', { name: 'Nueva promoción', exact: true }).filter({ visible: true }).click();
    const promo = formWithTitle(admin, 'Nueva promoción');
    await promo.getByLabel('Título', { exact: false }).fill(titulo);
    await promo.getByLabel('Porcentaje', { exact: false }).fill('15');
    await promo.getByLabel('Vigente hasta', { exact: true }).fill(data.today);
    await promo.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(promo).toHaveCount(0);
    promocionId = await h.json(`select to_json(id) from public.promociones where titulo='${titulo}'`);
    expect(promocionId, 'la promoción del caso existe').toBeTruthy();
    // Prioridad aislada: Inicio muestra la promoción de vencimiento más próximo. La promoción de la preparación
    // global (de ESTA corrida, mismo día) la empataría: ese es el único dato que este caso ya desactivaba por UI al
    // terminar, así que se desactiva igual antes de reclamar. Cualquier OTRA promoción vigente que anteceda
    // invalida la preparación (se falla con mensaje claro; no se toca lo que no es de este caso).
    // Solo compiten las promociones VIGENTES hoy (misma regla que la política promociones_select_web): una vencida
    // (vigente_hasta < hoy) no se muestra en Inicio y no debe invalidar la preparación.
    const consultaAntecesoras = (excluirTitulo) => h.json(`select coalesce(json_agg(titulo), '[]'::json) from public.promociones where id <> '${promocionId}' and activo and vigente_hasta is not null and vigente_hasta >= '${data.today}' and vigente_hasta <= '${data.today}' and (vigente_desde is null or vigente_desde <= '${data.today}') and titulo <> '${excluirTitulo}'`);
    const desactivar = async (tituloPromocion) => {
      await admin.goto('/promociones');
      const tarjeta = admin.locator('div.rounded-lg.border').filter({ has: admin.getByText(tituloPromocion, { exact: true }) }).filter({ has: admin.getByRole('button', { name: 'Editar', exact: true }) }).last();
      await admin.getByText(tituloPromocion, { exact: true }).click();
      await tarjeta.getByRole('button', { name: 'Editar', exact: true }).click();
      const edicion = formWithTitle(admin, 'Editar promoción');
      await edicion.getByRole('button', { name: 'Inactiva', exact: true }).click();
      await edicion.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await expect(edicion).toHaveCount(0);
    };
    if (data.promotionName && Number(await h.json(`select to_json(count(*)) from public.promociones where titulo='${data.promotionName}' and activo`)) > 0) {
      await desactivar(data.promotionName);
    }
    expect(await consultaAntecesoras(titulo), 'precondición: ninguna otra promoción vigente vence antes o el mismo día').toEqual([]);

    await login(page, 'CLIENTE', own);
    await page.goto('/inicio');
    await expect(page.getByText(titulo, { exact: true })).toBeVisible();
    const result = page.waitForResponse(r => r.url().includes('/rpc/reclamar_cupon_promocion'));
    await page.getByRole('button', { name: 'Reclamar cupón', exact: true }).click();
    const response = await result;
    const body = await response.json();
    await info.attach('rpc-result', { body: Buffer.from(JSON.stringify({ status: response.status(), body })), contentType: 'application/json' });
    if (!response.ok()) {
      expect(body.message).toContain('column reference "id" is ambiguous');
      await expect(page.getByText('column reference "id" is ambiguous', { exact: true })).toBeVisible();
    } else {
      // El cupón reclamado corresponde a ESTA promoción y a esta clienta (por ID, no por texto).
      const cupones = await h.json(`select to_json(count(*)) from public.cupones where promocion_id='${promocionId}' and cliente_id=(select id from public.clientes where telefono='${own.phone}')`);
      expect(Number(cupones), 'un cupón de la promoción del caso para la clienta del caso').toBe(1);
    }
    // Se desactiva SOLO la promoción de este caso (por la UI) para no tapar a la de corridas posteriores.
    await desactivar(titulo);
    expectKnownFailure('QA-005');
    expect(response.ok(), 'Reclamar debe completar la transacción').toBeTruthy();
  } finally {
    // Limpieza GARANTIZADA y acotada: solo la promoción de ESTE caso, por su ID (aunque el caso falle antes de la UI).
    await adminContext.close();
    if (promocionId) {
      const r = await h.admin(`update public.promociones set activo = false where id = '${promocionId}' and activo;`);
      const sigue = await h.json(`select to_json(activo) from public.promociones where id = '${promocionId}'`);
      // Si la limpieza falla, el caso falla (no se silencia); si el caso ya había fallado, Playwright conserva ambos errores.
      expect.soft(r.ok && sigue === false, `limpieza de la promoción propia ${promocionId}: ${r.ok ? 'sigue activa' : String(r.err).split(String.fromCharCode(10))[0]}`).toBeTruthy();
    }
  }
});

test('QA-009: verificar pago Yape del pedido aislado debe crear venta', async ({ page, browser, data }, info) => {
  test.setTimeout(120_000);
  knownIssue(info, 'QA-009');
  const { localNetworkOnly } = await import('./local-safety.mjs');
  // Clienta, producto y pedido PROPIOS del caso: la clienta global puede tener otros pedidos. El pedido se
  // identifica por el ID que devuelve confirmar_pedido_productos (no por nombre ni first()).
  const own = await isolatedClient(browser, data, 'Q009');
  const sufijo = sufijoUnico();
  const propio = { productName: `${data.prefix} Q009 ${sufijo}`, barcode: `${data.barcode}-Q009-${sufijo}`, initialStock: 10 };
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  await localNetworkOnly(adminContext);
  const admin = await adminContext.newPage();
  try {
    await login(admin, 'ADMINISTRADOR', data);
    await createProduct(admin, propio);
    await login(page, 'CLIENTE', own);
    await page.goto(`/productos/${propio.productId}`);
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
    const envio = await submitted;
    expect(envio.ok()).toBeTruthy();
    const pedidoId = await envio.json();
    expect(typeof pedidoId, 'la RPC devuelve el ID del pedido creado').toBe('string');
    await expect(page).toHaveURL(/\/inicio$/);
    expect(Number(await h.json(`select to_json(count(*)) from public.pedidos_web where cliente_id=(select id from public.clientes where telefono='${own.phone}')`)), 'un único pedido de la clienta del caso').toBe(1);

    await admin.goto('/pedidos-web');
    await admin.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
    await admin.getByRole('button').filter({ hasText: own.clientName }).click();
    const verified = admin.waitForResponse(r => r.url().includes('/rpc/verificar_pago_pedido_web'));
    await admin.getByRole('button', { name: 'Verificar pago', exact: true }).click();
    const response = await verified;
    const status = response.status();
    const body = await response.json();
    await info.attach('verificar-pago', { body: Buffer.from(JSON.stringify({ status, body })), contentType: 'application/json' });
    if (!response.ok()) {
      expect(body.message).toContain('ventas_metodo_pago_check');
      await expect(admin.getByText(/ventas_metodo_pago_check/)).toBeVisible();
    }
    await info.attach('pedido-error', { body: await admin.screenshot({ fullPage: true }), contentType: 'image/png' });
    await admin.reload();
    await admin.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
    await admin.getByRole('button').filter({ hasText: own.clientName }).click();
    if (!response.ok()) await expect(admin.getByRole('button', { name: 'Verificar pago', exact: true })).toBeVisible();
    else await expect(admin.getByRole('button', { name: 'Marcar entregado', exact: true })).toBeVisible();
    // Por ID del pedido creado: si la verificación funcionó, ESE pedido quedó verificado y con venta.
    if (response.ok()) {
      expect(await h.json(`select to_json(venta_id is not null and pago_verificado) from public.pedidos_web where id='${pedidoId}'`), 'el pedido del caso quedó verificado y con venta').toBe(true);
    }
    expectKnownFailure('QA-009');
    expect(status).toBe(200);
  } finally { await adminContext.close(); }
});
