// Separación POS / Web de Servicios y Productos, en la interfaz: formularios POS simples, «Editar en Web» (solo
// ADMINISTRADOR), Web → Catálogo → Productos / Servicios, guardado alternado sin pérdida, retorno con borrador pendiente,
// permisos y acceso directo por URL. Solo Supabase Local TEST; login por la interfaz normal. Las fichas se crean por la
// propia interfaz POS (createProduct / createService); la base solo se LEE para comprobar lo persistido.
// Requiere QA_TEST_PASSWORD solo en el proceso. NO ejecutado en la sesión en que se escribió (sin contraseña).
import { test, expect } from './fixtures.mjs';
import { sufijoUnico, login, logout, visibleButton, formWithTitle, createProduct, createService } from './helpers.mjs';
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

test('servicio: «Editar en Web» abre la ficha por ID, el combo guardado se conserva y la protección sigue en Recompensas Web', async ({ page, data }) => {
  await login(page, 'ADMINISTRADOR', data);
  const s = await servicioPropio(page, data, 'PW5');
  const form = await abrirEdicionServicio(page, s);
  await expect(form.getByRole('button', { name: 'Protección económica (Recompensas Web)', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Editar en Web', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalogo-web\\?tab=servicios&id=${s.serviceId}&desde=/servicios`));
  const web = formWithTitle(page, 'Contenido Web del servicio');
  await expect(web).toBeVisible();
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
