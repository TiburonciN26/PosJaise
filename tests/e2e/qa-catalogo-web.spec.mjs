// Separación POS / Web de Servicios y Productos, en la interfaz: formularios POS simples, «Editar en Web» (solo
// ADMINISTRADOR), Web → Catálogo → Productos / Servicios, guardado alternado sin pérdida, retorno con borrador pendiente,
// permisos y acceso directo por URL. Solo Supabase Local TEST; login por la interfaz normal. Las fichas se crean por la
// propia interfaz POS (createProduct / createService); la base solo se LEE para comprobar lo persistido.
// Requiere QA_TEST_PASSWORD solo en el proceso. NO ejecutado en la sesión en que se escribió (sin contraseña).
import { test, expect } from './fixtures.mjs';
import { campoNombreServicio, sufijoUnico, login, logout, visibleButton, formWithTitle, createProduct, createService } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await h.verificarLocalTest();
});

async function productoPropio(page, data, etiqueta) {
  const sufijo = sufijoUnico();
  const p = { productName: `${data.prefix} ${etiqueta} ${sufijo}`, barcode: `${data.barcode}-${etiqueta}-${sufijo}`, initialStock: 6 };
  await createProduct(page, p);
  return p;
}
async function servicioPropio(page, data, etiqueta) {
  const s = { ...data, serviceName: `${data.prefix} ${etiqueta} ${sufijoUnico()}` };
  await createService(page, s);
  return s;
}
async function abrirEdicionProducto(page, p) {
  await page.goto('/inventario');
  await page.getByPlaceholder('Buscar producto...').fill(p.productName);
  await page.getByRole('row').filter({ has: page.getByText(p.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
  return formWithTitle(page, 'Editar producto');
}
async function abrirEdicionServicio(page, s) {
  await page.goto('/servicios');
  await page.getByPlaceholder('Buscar servicio...').fill(s.serviceName);
  await page.getByRole('row').filter({ hasText: s.serviceName }).getByRole('button', { name: 'Editar', exact: true }).click();
  return formWithTitle(page, 'Editar servicio');
}

test('POS: Nuevo producto y Nuevo servicio solo piden campos operativos (sin contenido Web) y se crean con Web vacío', async ({ page, data }) => {
  await login(page, 'ADMINISTRADOR', data);
  await page.goto('/inventario');
  await visibleButton(page, 'Nuevo producto').first().click();
  const fp = formWithTitle(page, 'Nuevo producto');
  for (const web of ['Descripción', 'Precio antes de la oferta', 'Contenido', 'Rinde', 'Frecuencia de uso', 'Foto']) {
    await expect(fp.getByText(web, { exact: true }), `«${web}» no va en el POS`).toHaveCount(0);
  }
  for (const pos of ['Nombre', 'Código de barras', 'Categoría', 'Subcategoría', 'Costo', 'Precio de venta', 'Proveedor']) {
    await expect(fp.getByText(pos, { exact: false }).first()).toBeVisible();
  }
  await expect(fp.getByRole('button', { name: 'Editar en Web', exact: true })).toHaveCount(0); // ficha nueva: nada que abrir
  await fp.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.goto('/servicios');
  await visibleButton(page, 'Nuevo servicio').first().click();
  const fs = formWithTitle(page, 'Nuevo servicio');
  for (const web of ['Descripción', 'El resultado dura', 'Foto', 'Galería (Resultado / Antes / Después)']) {
    await expect(fs.getByText(web, { exact: true }), `«${web}» no va en el POS`).toHaveCount(0);
  }
  await expect(fs.getByText('El precio puede variar', { exact: false })).toHaveCount(0);
  await expect(fs.getByText('Se puede hacer a domicilio', { exact: false })).toHaveCount(0);
  await fs.getByRole('button', { name: 'Cancelar', exact: true }).click();

  const p = await productoPropio(page, data, 'PW1');
  const s = await servicioPropio(page, data, 'PW1');
  expect(await h.json(`select to_json(descripcion is null and precio_antes is null and not destacado and especificaciones = '[]'::jsonb) from public.productos where id='${p.productId}'`)).toBe(true);
  expect(await h.json(`select to_json(descripcion is null and not precio_variable and not a_domicilio and pasos = '[]'::jsonb) from public.servicios where id='${s.serviceId}'`)).toBe(true);
});

test('«Editar en Web» (ADMIN): abre la MISMA ficha por ID, el borrador POS sigue ahí al volver y no se guarda ni se descarta', async ({ page, data }) => {
  await login(page, 'ADMINISTRADOR', data);
  const p = await productoPropio(page, data, 'PW2');
  const form = await abrirEdicionProducto(page, p);
  await form.getByLabel('Proveedor', { exact: true }).fill('Borrador sin guardar');
  await form.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalogo-web\\?tab=productos&id=${p.productId}&desde=/inventario`));
  const web = formWithTitle(page, 'Contenido Web del producto');
  await expect(web).toBeVisible();
  await expect(web.getByText(p.productName, { exact: false }).first()).toBeVisible();
  // El modal Web bloquea el fondo (correcto): se cierra con Cancelar, se espera a que desaparezca y recién entonces se pulsa el enlace.
  await web.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(web).toHaveCount(0);
  await page.getByRole('link', { name: /Volver a Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventario/);
  const formVuelta = formWithTitle(page, 'Editar producto');
  await expect(formVuelta.getByLabel('Proveedor', { exact: true })).toHaveValue('Borrador sin guardar'); // borrador conservado
  expect(await h.json(`select to_json(proveedor) from public.productos where id='${p.productId}'`), 'no se guardó en silencio').toBeNull();
});

test('Web → Catálogo → Productos: editar contenido, guardar, recargar y verlo en el portal; el POS conserva sus campos', async ({ page, browser, data }) => {
  test.setTimeout(150_000);
  await login(page, 'ADMINISTRADOR', data);
  const p = await productoPropio(page, data, 'PW3');
  await page.goto(`/catalogo-web?tab=productos&id=${p.productId}`);
  const web = formWithTitle(page, 'Contenido Web del producto');
  await expect(web).toBeVisible();
  const texto = `Descripción web ${sufijoUnico()}`;
  await web.getByLabel('Descripción', { exact: true }).fill(texto);
  await web.getByLabel('Contenido', { exact: true }).fill('250 ml');
  const guardado = page.waitForResponse((r) => r.url().includes('/rest/v1/productos?') && r.request().method() === 'PATCH');
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  expect((await guardado).ok()).toBeTruthy();
  await expect(web).toHaveCount(0);
  await page.reload();
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${p.productId}'`)).toBe(texto);
  // El POS conserva lo suyo (nombre, código, precio real, stock) y ve el mismo precio.
  const fila = await h.json(`select row_to_json(t) from (select nombre, codigo_barras, precio, stock_actual from public.productos where id='${p.productId}') t`);
  expect(fila).toMatchObject({ nombre: p.productName, codigo_barras: p.barcode, stock_actual: 6 });
  expect(Number(fila.precio)).toBe(1);
  // Reflejo en el portal (CLIENTE).
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  try {
    const { localNetworkOnly } = await import('./local-safety.mjs');
    await localNetworkOnly(ctx);
    const cliente = await ctx.newPage();
    await login(cliente, 'CLIENTE', data);
    await cliente.goto(`/productos/${p.productId}`);
    await expect(cliente.getByText(texto, { exact: false }).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('guardado alternado POS ↔ Web sin pérdida de campos (producto y servicio)', async ({ page, data }) => {
  test.setTimeout(150_000);
  await login(page, 'ADMINISTRADOR', data);
  const p = await productoPropio(page, data, 'PW4');
  // Web primero…
  await page.goto(`/catalogo-web?tab=productos&id=${p.productId}`);
  let web = formWithTitle(page, 'Contenido Web del producto');
  await web.getByLabel('Descripción', { exact: true }).fill('Texto web del producto');
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(web).toHaveCount(0);
  // …luego POS: cambia el proveedor y guarda…
  let form = await abrirEdicionProducto(page, p);
  await form.getByLabel('Proveedor', { exact: true }).fill('Proveedor alterno');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(form).toHaveCount(0);
  const tras = await h.json(`select row_to_json(t) from (select descripcion, proveedor from public.productos where id='${p.productId}') t`);
  expect(tras, 'guardar POS conserva el contenido Web').toEqual({ descripcion: 'Texto web del producto', proveedor: 'Proveedor alterno' });
  // …y Web otra vez: el POS conserva el proveedor.
  await page.goto(`/catalogo-web?tab=productos&id=${p.productId}`);
  web = formWithTitle(page, 'Contenido Web del producto');
  await web.getByLabel('Descripción', { exact: true }).fill('Texto web v2');
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(web).toHaveCount(0);
  expect(await h.json(`select row_to_json(t) from (select descripcion, proveedor from public.productos where id='${p.productId}') t`)).toEqual({ descripcion: 'Texto web v2', proveedor: 'Proveedor alterno' });

  const s = await servicioPropio(page, data, 'PW4');
  await page.goto(`/catalogo-web?tab=servicios&id=${s.serviceId}`);
  const webS = formWithTitle(page, 'Contenido Web del servicio');
  await expect(webS).toBeVisible();
  await webS.getByLabel('Descripción', { exact: true }).fill('Texto web del servicio');
  await webS.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(webS).toHaveCount(0);
  const formS = await abrirEdicionServicio(page, s);
  await formS.getByLabel('Duración (min)', { exact: true }).fill('55');
  await formS.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(formS).toHaveCount(0);
  expect(await h.json(`select row_to_json(t) from (select descripcion, duracion_min from public.servicios where id='${s.serviceId}') t`)).toEqual({ descripcion: 'Texto web del servicio', duracion_min: 55 });
});

test('servicio: «Editar en Web» abre la ficha por ID, se vuelve a Servicios con el modal POS y la protección sigue en Recompensas Web', async ({ page, data }) => {
  await login(page, 'ADMINISTRADOR', data);
  const s = await servicioPropio(page, data, 'PW5');
  const form = await abrirEdicionServicio(page, s);
  await expect(form.getByRole('button', { name: 'Protección económica (Recompensas Web)', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalogo-web\\?tab=servicios&id=${s.serviceId}&desde=/servicios`));
  const web = formWithTitle(page, 'Contenido Web del servicio');
  await expect(web).toBeVisible();
  // Segunda forma de cerrar el modal Web: Escape. Se espera a que desaparezca antes de pulsar el enlace.
  await page.keyboard.press('Escape');
  await expect(web).toHaveCount(0);
  await page.getByRole('link', { name: /Volver a Servicios/ }).click();
  await expect(page).toHaveURL(/\/servicios/);
  await formWithTitle(page, 'Editar servicio').getByRole('button', { name: 'Protección económica (Recompensas Web)', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/recompensas-web\\?tab=proteccion&servicio=${s.serviceId}`));
  await expect(page.getByLabel('Materiales protegidos (S/)', { exact: false }).first()).toBeVisible();
});

test('validaciones y error de guardado en Web (precio antes, costo a domicilio, fallo de red) sin guardar nada', async ({ page, data }) => {
  test.setTimeout(150_000);
  await login(page, 'ADMINISTRADOR', data);
  const p = await productoPropio(page, data, 'PW6');
  await page.goto(`/catalogo-web?tab=productos&id=${p.productId}`);
  const web = formWithTitle(page, 'Contenido Web del producto');
  let escrituras = 0;
  page.on('request', (r) => { if (r.url().includes('/rest/v1/productos?') && r.method() === 'PATCH') escrituras += 1; });
  await web.getByLabel('Precio antes de la oferta', { exact: false }).fill('15abc');
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(web.getByText(/^El precio antes debe ser/)).toBeVisible();
  await web.getByLabel('Precio antes de la oferta', { exact: false }).fill('0.5'); // menor al precio real (S/1)
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(web.getByText('El precio antes debe ser mayor al precio de venta actual.', { exact: true })).toBeVisible();
  expect(escrituras, 'ningún valor inválido llegó al servidor').toBe(0);
  await web.getByLabel('Precio antes de la oferta', { exact: false }).fill('');
  await web.getByLabel('Descripción', { exact: true }).fill('No debe guardarse');
  await page.route('**/rest/v1/productos?*', (route) => (route.request().method() === 'PATCH' ? route.abort('failed') : route.continue()));
  await web.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(web.getByText('No se pudo guardar el producto. Intenta de nuevo.', { exact: true })).toBeVisible();
  await expect(web).toBeVisible(); // el borrador sigue abierto, no se descartó
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${p.productId}'`)).toBeNull();
  await page.unroute('**/rest/v1/productos?*');

  const s = await servicioPropio(page, data, 'PW6');
  await page.goto(`/catalogo-web?tab=servicios&id=${s.serviceId}`);
  const webS = formWithTitle(page, 'Contenido Web del servicio');
  await webS.getByText('Se puede hacer a domicilio', { exact: false }).click();
  await webS.getByPlaceholder('Costo adicional — vacío o 0 = gratis').fill('-3');
  await webS.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(webS.getByText('El costo a domicilio debe ser un número mayor o igual a 0.', { exact: true })).toBeVisible();
});

test('permisos: CAJERA y ASISTENTE no ven «Editar en Web» ni entran a Catálogo Web por URL; CLIENTE tampoco', async ({ page, data }) => {
  test.setTimeout(150_000);
  await login(page, 'ADMINISTRADOR', data);
  const p = await productoPropio(page, data, 'PW8');
  await logout(page);
  for (const rol of ['CAJERA', 'ASISTENTE', 'CLIENTE']) {
    await login(page, rol, data);
    await page.goto(`/catalogo-web?tab=productos&id=${p.productId}`);
    await expect(page, `${rol}: acceso directo`).not.toHaveURL(/catalogo-web/);
    await expect(page.getByRole('heading', { name: 'Catálogo Web', exact: true })).toHaveCount(0);
    if (rol === 'CAJERA') {
      await page.goto('/inventario');
      await page.getByPlaceholder('Buscar producto...').fill(p.productName);
      await expect(page.getByText('Editar en Web', { exact: true })).toHaveCount(0);
    }
    await logout(page);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// QA-049: la decisión sobre un borrador pendiente debe ser accesible (diálogo propio por encima del modal) y no perder
// nada en silencio. Escenario del defecto: editar A → «Editar en Web» → escribir sin guardar → Atrás → cancelar el modal
// POS de A → editar B → «Editar en Web».
// ---------------------------------------------------------------------------------------------------------------------
const TITULO_CONFLICTO = 'Hay una ficha abierta con cambios sin guardar';
const dialogoConflicto = (page) => page.getByRole('dialog', { name: TITULO_CONFLICTO });

function contarEscrituras(page) {
  const escrituras = [];
  page.on('request', (r) => {
    if (/\/rest\/v1\/(productos|servicios)\?/.test(r.url()) && ['PATCH', 'POST', 'DELETE'].includes(r.method())) {
      escrituras.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  return escrituras;
}

async function irAWebDeProducto(page, p) {
  const form = await abrirEdicionProducto(page, p);
  await form.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  const web = formWithTitle(page, 'Contenido Web del producto');
  await expect(web).toBeVisible();
  await expect(web.getByText(p.productName, { exact: false }).first()).toBeVisible();
  return web;
}

// QA-049 (foco): con la decisión YA cerrada del todo, el foco está dentro del modal que sigue abierto y Tab / Shift+Tab no
// salen de él hacia el fondo. Se espera a que la decisión desaparezca antes de leer el estado estable (un Tab enviado
// justo después del clic podría ocultar la variante).
async function comprobarFocoEstableEn(page, formulario) {
  await expect(dialogoConflicto(page)).toHaveCount(0);
  await expect(formulario.locator(':focus'), 'el foco quedó dentro del modal abierto (no en body)').toHaveCount(1);
  for (const tecla of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(tecla);
    await expect(formulario.locator(':focus'), `tras ${tecla} el foco sigue dentro del modal`).toHaveCount(1);
  }
}

// Llega al conflicto con DOS productos A y B (o producto A y servicio B si `servicioB`).
async function llegarAlConflicto(page, data, { servicioB = false, borradorPosB = false } = {}) {
  const A = await productoPropio(page, data, 'PW9a');
  const B = servicioB ? await servicioPropio(page, data, 'PW9b') : await productoPropio(page, data, 'PW9b');
  const escrituras = contarEscrituras(page);
  const webA = await irAWebDeProducto(page, A);
  await webA.getByLabel('Descripción', { exact: true }).fill('Borrador de A');
  await page.goBack(); // Atrás del navegador: vuelve al POS con el modal POS de A todavía abierto
  await expect(page).toHaveURL(/\/inventario/);
  const posA = formWithTitle(page, 'Editar producto');
  await expect(posA).toBeVisible();
  await posA.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(posA).toHaveCount(0);
  // Navegación DENTRO de la aplicación (sin recargar): una recarga destruiría el borrador de A y no reproduciría el defecto.
  let formB;
  if (servicioB) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page).toHaveURL(/\/servicios/);
    await page.getByPlaceholder('Buscar servicio...').filter({ visible: true }).fill(B.serviceName);
    await page.getByRole('row').filter({ hasText: B.serviceName }).getByRole('button', { name: 'Editar', exact: true }).click();
    formB = formWithTitle(page, 'Editar servicio');
  } else {
    await page.getByPlaceholder('Buscar producto...').filter({ visible: true }).fill(B.productName);
    await page.getByRole('row').filter({ has: page.getByText(B.productName, { exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
    formB = formWithTitle(page, 'Editar producto');
  }
  if (borradorPosB) {
    // Borrador POS de B: la pestaña queda oculta con su modal abierto cuando se pide «Editar en Web».
    if (servicioB) await formB.getByLabel('Duración (min)', { exact: true }).fill('77');
    else await formB.getByLabel('Proveedor', { exact: true }).fill('Borrador POS de B');
  }
  await formB.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  const idPedido = servicioB ? B.serviceId : B.productId;
  expect(idPedido, 'ID explícito según el tipo de B').toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`id=${idPedido}`));
  await expect(dialogoConflicto(page)).toBeVisible();
  return { A, B, escrituras };
}

test('QA-049: la decisión es accesible por ratón (está por encima del overlay) y «Seguir» conserva A sin abrir B ni guardar', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, B, escrituras } = await llegarAlConflicto(page, data);
  const dialogo = dialogoConflicto(page);
  // Foco inicial en la opción segura; el clic llega al botón (no lo intercepta el overlay del modal de A).
  await expect(dialogo.getByRole('button', { name: 'Seguir con la ficha abierta', exact: true })).toBeFocused();
  await dialogo.getByRole('button', { name: 'Seguir con la ficha abierta', exact: true }).click();
  await expect(dialogo).toHaveCount(0);
  const webA = formWithTitle(page, 'Contenido Web del producto');
  await expect(webA).toBeVisible();
  await expect(webA.getByText(A.productName, { exact: false }).first()).toBeVisible(); // sigue siendo A, no B
  await expect(webA.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A'); // borrador conservado
  await expect(page).toHaveURL(new RegExp(`tab=productos&id=${A.productId}`)); // la URL vuelve a describir la ficha abierta
  await comprobarFocoEstableEn(page, webA);
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${A.productId}'`), 'A no se guardó en silencio').toBeNull();
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${B.productId}'`), 'B no se tocó').toBeNull();
  expect(escrituras, 'ninguna escritura involuntaria').toEqual([]);
});

test('QA-049: «Abrir la solicitada» (por teclado) descarta A solo por decisión explícita y abre exactamente B por ID', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, B, escrituras } = await llegarAlConflicto(page, data);
  const dialogo = dialogoConflicto(page);
  await page.keyboard.press('Tab'); // de «Seguir» a «Abrir la solicitada»
  await expect(dialogo.getByRole('button', { name: /^Abrir la solicitada/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialogo).toHaveCount(0);
  const webB = formWithTitle(page, 'Contenido Web del producto');
  await expect(webB).toBeVisible();
  await expect(webB.getByText(B.productName, { exact: false }).first()).toBeVisible();
  await expect(webB.getByText(A.productName, { exact: false })).toHaveCount(0);
  await expect(webB.getByLabel('Descripción', { exact: true })).toHaveValue(''); // el borrador de A no se arrastra a B
  await expect(page).toHaveURL(new RegExp(`id=${B.productId}`));
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${A.productId}'`), 'el borrador descartado de A nunca se guardó').toBeNull();
  expect(escrituras).toEqual([]);
});

test('QA-049: Escape en la decisión equivale a conservar (la ficha abierta no se pierde)', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, escrituras } = await llegarAlConflicto(page, data);
  await page.keyboard.press('Escape');
  await expect(dialogoConflicto(page)).toHaveCount(0);
  const webA = formWithTitle(page, 'Contenido Web del producto');
  await expect(webA).toBeVisible(); // un solo Escape cierra solo la capa de arriba (la decisión)
  await expect(webA.getByText(A.productName, { exact: false }).first()).toBeVisible();
  await expect(webA.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A');
  await expect(page).toHaveURL(new RegExp(`tab=productos&id=${A.productId}`)); // A y su URL se conservan
  await comprobarFocoEstableEn(page, webA);
  expect(escrituras).toEqual([]);
  // Segundo Escape: ahora sí responde la capa de abajo (cerrar el modal Web es una acción explícita del usuario).
  await page.keyboard.press('Escape');
  await expect(webA).toHaveCount(0);
  expect(escrituras, 'cerrar con Escape no guarda').toEqual([]);
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${A.productId}'`)).toBeNull();
});

test('QA-049: con el mismo ID no hay conflicto: «Editar en Web» de A otra vez recupera A con su borrador', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  const A = await productoPropio(page, data, 'PW10');
  const escrituras = contarEscrituras(page);
  const webA = await irAWebDeProducto(page, A);
  await webA.getByLabel('Descripción', { exact: true }).fill('Borrador de A');
  await page.goBack();
  const posA = formWithTitle(page, 'Editar producto');
  await expect(posA).toBeVisible();
  await posA.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  await expect(dialogoConflicto(page)).toHaveCount(0);
  const vuelta = formWithTitle(page, 'Contenido Web del producto');
  await expect(vuelta.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A');
  expect(escrituras).toEqual([]);
});

test('QA-049: producto A y servicio B — «Seguir» conserva A y su pestaña; sin guardar nada', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, B, escrituras } = await llegarAlConflicto(page, data, { servicioB: true });
  await dialogoConflicto(page).getByRole('button', { name: 'Seguir con la ficha abierta', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tab=productos&id=${A.productId}`));
  await expect(formWithTitle(page, 'Contenido Web del producto').getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A');
  await expect(formWithTitle(page, 'Contenido Web del servicio')).toHaveCount(0);
  await comprobarFocoEstableEn(page, formWithTitle(page, 'Contenido Web del producto'));
  expect(await h.json(`select to_json(descripcion) from public.servicios where id='${B.serviceId}'`)).toBeNull();
  expect(escrituras, 'ninguna escritura involuntaria').toEqual([]);
});

test('QA-049: producto A y servicio B — «Abrir la solicitada» abre exactamente el servicio B por ID y descarta A solo por decisión explícita', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, B, escrituras } = await llegarAlConflicto(page, data, { servicioB: true });
  await dialogoConflicto(page).getByRole('button', { name: /^Abrir la solicitada/ }).click();
  const webB = formWithTitle(page, 'Contenido Web del servicio');
  await expect(webB).toBeVisible();
  await expect(webB.getByText(B.serviceName, { exact: false }).first()).toBeVisible();
  await expect(formWithTitle(page, 'Contenido Web del producto')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`tab=servicios&id=${B.serviceId}`));
  expect(await h.json(`select to_json(descripcion) from public.productos where id='${A.productId}'`)).toBeNull();
  expect(escrituras, 'ninguna escritura involuntaria').toEqual([]);
});

test('QA-049: tras decidir, el retorno a POS es utilizable (cerrar Web con Cancelar y pulsar «Volver a Inventario»)', async ({ page, data }) => {
  test.setTimeout(180_000);
  await login(page, 'ADMINISTRADOR', data);
  await llegarAlConflicto(page, data);
  await dialogoConflicto(page).getByRole('button', { name: 'Seguir con la ficha abierta', exact: true }).click();
  const web = formWithTitle(page, 'Contenido Web del producto');
  await expect(web).toBeVisible();
  await web.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(web).toHaveCount(0);
  await page.getByRole('link', { name: /Volver a Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventario/);
  await expect(page.getByPlaceholder('Buscar producto...').filter({ visible: true })).toBeVisible();
});

test('QA-049: producto A y servicio B — un Escape cierra solo la decisión; A, su URL y su borrador se conservan', async ({ page, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const { A, escrituras } = await llegarAlConflicto(page, data, { servicioB: true });
  await page.keyboard.press('Escape');
  await expect(dialogoConflicto(page)).toHaveCount(0);
  const webA = formWithTitle(page, 'Contenido Web del producto');
  await expect(webA).toBeVisible();
  await expect(webA.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A');
  await expect(page).toHaveURL(new RegExp(`tab=productos&id=${A.productId}`));
  await expect(formWithTitle(page, 'Contenido Web del servicio')).toHaveCount(0);
  await comprobarFocoEstableEn(page, webA);
  expect(escrituras, 'ninguna escritura involuntaria').toEqual([]);
});

// QA-049 (capas ocultas): el modal POS de B queda montado pero OCULTO (su pestaña está en display:none). El Escape del
// diálogo visible nunca debe llegar a él: cada Escape cierra una sola capa VISIBLE, en orden (decisión → modal Web), y el
// borrador POS de B sobrevive al retorno.
for (const [titulo, servicioB] of [['producto → producto', false], ['producto → servicio', true]]) {
  test(`QA-049: ${titulo} — el modal POS oculto de B no recibe Escape y su borrador sobrevive al retorno`, async ({ page, data }) => {
    test.setTimeout(240_000);
    await login(page, 'ADMINISTRADOR', data);
    const { A, B, escrituras } = await llegarAlConflicto(page, data, { servicioB, borradorPosB: true });
    const webA = formWithTitle(page, 'Contenido Web del producto');
    // Escape 1: solo la decisión.
    await page.keyboard.press('Escape');
    await expect(dialogoConflicto(page)).toHaveCount(0);
    await expect(webA).toBeVisible();
    await expect(webA.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador de A');
    // Escape 2: el modal Web VISIBLE (y no el POS oculto de B): con un solo Escape desaparece.
    await page.keyboard.press('Escape');
    await expect(webA).toHaveCount(0);
    // El modal POS de B sigue ahí, con su borrador, al volver a su pestaña.
    await page.getByRole('link', { name: servicioB ? /Volver a Servicios/ : /Volver a Inventario/ }).click();
    if (servicioB) {
      const posB = formWithTitle(page, 'Editar servicio');
      await expect(posB).toBeVisible();
      await expect(posB.getByLabel('Duración (min)', { exact: true })).toHaveValue('77');
      // El nombre accesible real es «Nombre *»: se usa el id semántico del campo y se comprueba que es único.
      await expect(campoNombreServicio(posB)).toHaveCount(1);
      await expect(campoNombreServicio(posB)).toHaveValue(B.serviceName);
    } else {
      const posB = formWithTitle(page, 'Editar producto');
      await expect(posB).toBeVisible();
      await expect(posB.getByLabel('Proveedor', { exact: true })).toHaveValue('Borrador POS de B');
      await expect(campoNombreServicio(posB)).toHaveCount(1); // mismo id semántico `-nombre` en el formulario de producto
      await expect(campoNombreServicio(posB)).toHaveValue(B.productName);
    }
    // Nada se guardó en silencio.
    expect(await h.json(`select to_json(descripcion) from public.productos where id='${A.productId}'`)).toBeNull();
    expect(escrituras, 'ninguna escritura involuntaria').toEqual([]);
    if (servicioB) expect(await h.json(`select to_json(duracion_min) from public.servicios where id='${B.serviceId}'`)).toBe(30);
    else expect(await h.json(`select to_json(proveedor) from public.productos where id='${B.productId}'`)).toBeNull();
  });
}
