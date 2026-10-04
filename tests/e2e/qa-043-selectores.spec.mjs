// QA-043 en los otros tres selectores de cliente: Nueva cita, Nueva deuda y Caja → Seleccionar cliente.
// Con más de 1000 clientas, una ficha fuera de la primera página debe encontrarse, seleccionarse con su ID
// existente (sin duplicarla) y NO presentarse como inexistente. La ausencia real, el error de consulta y las
// respuestas cruzadas se tratan por separado. Solo Supabase Local TEST; login por la interfaz normal.
// Datos: una clienta ficticia «ZZZ TEST F2 qa043 sel …» (con teléfono) y, si hace falta, relleno hasta 1100
// filas, insertados por SQL local. No se elimina ni renombra nada ni se toca max_rows.
import { test, expect } from './fixtures.mjs';
import { login, visibleButton, formWithTitle } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36);
const nombre = `ZZZ TEST F2 qa043 sel ${tag}`;
const telefono = `9${String(Date.now()).slice(-8)}`;
let clienteId;
const nombreSenuelo = `ZZZ TEST F2 qa043 sel SENUELO ${tag}`; // coincide con el texto parcial pero NO con el nombre completo

test.beforeAll(async () => {
  await h.verificarLocalTest();
  const total = Number(await h.json(`select to_json(count(*)) from public.clientes`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.clientes (id, nombre)
      select gen_random_uuid(), 'TEST F2 relleno sel ' || g from generate_series(1, ${1100 - total}) g;`);
    if (!r.ok) throw new Error(r.err);
  }
  clienteId = crypto.randomUUID();
  const r = await h.admin(`insert into public.clientes (id, nombre, telefono) values ('${clienteId}', '${nombre}', '${telefono}'), (gen_random_uuid(), '${nombreSenuelo}', null);`);
  if (!r.ok) throw new Error(r.err);
  const antes = Number(await h.json(`select to_json(count(*)) from public.clientes where nombre < '${nombre}'`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} clientas preceden a la del caso; hacen falta ≥ 1000.`);
});

const copias = () => h.json(`select to_json(count(*)) from public.clientes where nombre='${nombre}'`);

// ---- aperturas ----------------------------------------------------------------------------------
async function abrirCita(page, rol = 'ADMINISTRADOR') {
  await login(page, rol, {});
  await page.goto('/citas');
  await visibleButton(page, 'Nueva cita').first().click();
  const form = formWithTitle(page, 'Nueva cita');
  await expect(form).toBeVisible();
  return { form, buscador: form.getByPlaceholder('Buscar cliente...') };
}
async function abrirDeuda(page) {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/deudas');
  await visibleButton(page, 'Nueva deuda').first().click();
  const form = formWithTitle(page, 'Nueva deuda');
  await expect(form).toBeVisible();
  return { form, buscador: form.getByPlaceholder('Buscar cliente...') };
}
async function abrirCaja(page, rol = 'ADMINISTRADOR') {
  await login(page, rol, {});
  await page.goto('/ventas');
  await page.getByRole('button', { name: /Cliente: \(ninguno\)/ }).click();
  const modal = page.getByRole('dialog', { name: 'Seleccionar cliente' });
  await expect(modal).toBeVisible();
  return { modal, buscador: modal.getByPlaceholder('Buscar por nombre o teléfono...') };
}

const crear = (c) => c.getByRole('button', { name: /como cliente nuevo/ });
// En Caja la ficha real es el botón «nombre + teléfono»; «Usar "…" (venta rápida)» y «Registrar … nuevo» son otros.
const fichaCaja = (modal) => modal.getByRole('button', { name: new RegExp(`^${nombre} ${telefono}$`) });

// Los espacios del filtro viajan como «+» o «%20»: se decodifica antes de comparar.
const decodificada = (peticion) => decodeURIComponent(peticion.url().replace(/\+/g, ' '));

// Retiene la respuesta de la PRIMERA búsqueda cuyo patrón contiene `fragmento` y la entrega tarde. Devuelve el
// estado para AFIRMAR que de verdad se interceptó y se liberó (si no, la prueba no demostraría nada).
async function retrasarPrimera(page, fragmento, ms = 1800) {
  const estado = { interceptada: false, liberada: false };
  await page.route('**/rest/v1/clientes?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !url.includes('ilike')) return route.continue();
    if (!estado.interceptada && decodificada(route.request()).includes(fragmento)) {
      estado.interceptada = true;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, ms));
      estado.liberada = true;
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  return estado;
}
const fallar = (page) => page.route('**/rest/v1/clientes?*ilike*', (route) => route.abort('failed'));

// ================================================== NUEVA CITA ====================================
test('Nueva cita: la clienta fuera de las primeras 1000 se encuentra, se selecciona y no se ofrece crearla', async ({ page }) => {
  const { form, buscador } = await abrirCita(page);
  await buscador.fill(nombre);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
  await expect(form.getByRole('button', { name: /referencia, sin guardar/ })).toHaveCount(0);
  await form.getByRole('button', { name: nombre, exact: true }).click();
  await expect(buscador).toHaveValue(nombre);
});

test('Nueva cita: se agenda con el ID de la ficha existente y no se crea un duplicado', async ({ page, data }) => {
  // El servicio se prepara ANTES de abrir el modal (por SQL local, nombre único): así «Crear servicio "…"» no
  // puede confundirse con la sugerencia real.
  // Con duración informada (30 min): la sugerencia real muestra «NN min» y la línea de la cita es válida.
  const servicioId = await h.nuevoServicio(30, null, { duracion_min: 30 });
  const nombreServicio = await h.json(`select to_json(nombre) from public.servicios where id='${servicioId}'`);
  const { form, buscador } = await abrirCita(page);
  await buscador.fill(nombre);
  await form.getByRole('button', { name: nombre, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(nombreServicio);
  // La sugerencia real termina en « NN min»; el botón «Crear servicio "…"» no.
  const sugerencia = form.getByRole('button', { name: new RegExp(`^${nombreServicio} \\d+ min$`) });
  await expect(sugerencia).toHaveCount(1);
  await sugerencia.click();
  await expect(form.getByText(nombreServicio, { exact: true })).toBeVisible(); // línea agregada antes de Agendar
  const d = new Date(`${data.today}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + 4);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
  await form.getByLabel('Fecha y hora', { exact: false }).fill(`${dia}T10:30`);
  const guardada = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/guardar_cita_pos') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Agendar', exact: true }).click();
  expect((await guardada).ok()).toBeTruthy();
  await expect(form).toHaveCount(0);
  expect(await h.json(`select to_json(count(*)) from public.citas where cliente_id='${clienteId}'`)).toBeGreaterThanOrEqual(1);
  expect(await h.json(`select to_json(count(*)) from public.cita_servicios cs join public.citas c on c.id = cs.cita_id where c.cliente_id='${clienteId}' and cs.servicio_id='${servicioId}'`)).toBe(1);
  expect(await copias(), 'no se creó un duplicado').toBe(1);
});

test('Nueva cita: una ausencia real sí ofrece referencia y alta, solo cuando la búsqueda terminó', async ({ page }) => {
  const { form, buscador } = await abrirCita(page);
  const inexistente = `Clienta inexistente ${tag}-${Math.random().toString(36).slice(2, 7)}`;
  await buscador.fill(inexistente);
  await expect(form.getByRole('button', { name: new RegExp(`Registrar "${inexistente}" como cliente nuevo`) })).toBeVisible();
  await expect(form.getByRole('button', { name: /referencia, sin guardar/ })).toBeVisible();
});

test('Nueva cita: con la búsqueda fallida no se sugiere crear y se puede reintentar', async ({ page }) => {
  const { form, buscador } = await abrirCita(page);
  await fallar(page);
  await buscador.fill(`cualquiera ${tag}`);
  await expect(form.getByText('No se pudo buscar clientes', { exact: false })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
  await expect(form.getByRole('button', { name: /referencia, sin guardar/ })).toHaveCount(0);
  await page.unroute('**/rest/v1/clientes?*ilike*');
  await form.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(form.getByText('No se pudo buscar clientes', { exact: false })).toHaveCount(0);
});

test('Nueva cita: una respuesta vieja no pisa a la nueva y mientras tarda no se ofrece crear', async ({ page }) => {
  const { form, buscador } = await abrirCita(page);
  const retenida = await retrasarPrimera(page, 'qa043 sel%');
  await buscador.fill('ZZZ TEST F2 qa043 sel');
  await expect.poll(() => retenida.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(nombre);
  await expect(crear(form)).toHaveCount(0); // pendiente: no se sugiere crear
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect.poll(() => retenida.liberada, { message: 'la respuesta antigua se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  // La respuesta antigua incluía al señuelo; si hubiera pisado a la nueva, el señuelo estaría en la lista.
  await expect(form.getByRole('button', { name: nombreSenuelo, exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
});

// ================================================== NUEVA DEUDA ===================================
test('Nueva deuda: encuentra y selecciona la ficha, y la deuda queda con el ID existente sin duplicar', async ({ page }) => {
  const { form, buscador } = await abrirDeuda(page);
  await buscador.fill(nombre);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
  await form.getByRole('button', { name: nombre, exact: true }).click();
  await expect(buscador).toHaveValue(nombre);
  const concepto = `TEST F2 deuda qa043 ${tag}`;
  await form.getByPlaceholder('Buscar servicio o producto, o escribir uno...').fill(concepto);
  await form.getByLabel(/Monto/).fill('1');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await h.json(`select to_json(count(*)) from public.deudas where cliente_id='${clienteId}' and concepto='${concepto}'`)).toBe(1);
  expect(await copias()).toBe(1);
});

test('Nueva deuda: ausencia real ofrece alta; búsqueda fallida no; respuesta vieja no pisa', async ({ page }) => {
  const { form, buscador } = await abrirDeuda(page);
  const inexistente = `Deudora inexistente ${tag}-${Math.random().toString(36).slice(2, 7)}`;
  await buscador.fill(inexistente);
  await expect(form.getByRole('button', { name: new RegExp(`Registrar "${inexistente}" como cliente nuevo`) })).toBeVisible();

  await fallar(page);
  await buscador.fill(`otra ${tag}`);
  await expect(form.getByText('No se pudo buscar clientes', { exact: false })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
  await page.unroute('**/rest/v1/clientes?*ilike*');

  const retenida = await retrasarPrimera(page, 'qa043 sel%');
  await buscador.fill('ZZZ TEST F2 qa043 sel');
  await expect.poll(() => retenida.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(nombre);
  await expect(crear(form)).toHaveCount(0);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect.poll(() => retenida.liberada, { message: 'la respuesta antigua se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  await expect(form.getByRole('button', { name: nombreSenuelo, exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
});

// ================================================== CAJA ==========================================
for (const rol of ['ADMINISTRADOR', 'CAJERA']) {
  test(`Caja (${rol}): encuentra la ficha por nombre y por teléfono y la selecciona por su identidad; no ofrece crearla`, async ({ page }) => {
    const { modal, buscador } = await abrirCaja(page, rol);
    await buscador.fill(nombre);
    await expect(fichaCaja(modal)).toHaveCount(1);
    // La venta rápida (sin guardar) se CONSERVA a propósito como opción manual (no es una regla de permisos);
    // lo que no debe ofrecerse es crear de nuevo una ficha que ya existe.
    await expect(modal.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
    await buscador.fill(telefono.slice(-6));
    await expect(fichaCaja(modal)).toHaveCount(1);
    await buscador.fill(telefono);
    await expect(fichaCaja(modal)).toHaveCount(1);
    await fichaCaja(modal).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(`^${nombre}$`) })).toBeVisible(); // el chip del ticket
    expect(await copias(), 'no se creó un duplicado').toBe(1);
  });
}

test('Caja: la venta queda registrada con el ID de la ficha existente', async ({ page }) => {
  const productoId = await h.nuevoProducto(7, 5);
  const nombreProducto = await h.json(`select to_json(nombre) from public.productos where id='${productoId}'`);
  const { modal, buscador } = await abrirCaja(page);
  await buscador.fill(nombre);
  await fichaCaja(modal).click();
  await page.getByRole('searchbox').first().fill(nombreProducto);
  await page.getByRole('button', { name: new RegExp(nombreProducto) }).click();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const vendida = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  expect((await vendida).ok()).toBeTruthy();
  expect(await h.json(`select to_json(count(*)) from public.ventas v join public.venta_items i on i.venta_id = v.id where v.cliente_id='${clienteId}' and i.producto_id='${productoId}'`)).toBe(1);
  expect(await copias()).toBe(1);
});

test('Caja: ausencia real ofrece venta rápida y alta; Enter no elige nada mientras busca', async ({ page }) => {
  const { modal, buscador } = await abrirCaja(page);
  const inexistente = `Cliente inexistente ${tag}-${Math.random().toString(36).slice(2, 7)}`;
  await buscador.fill(inexistente);
  await expect(modal.getByRole('button', { name: new RegExp(`Usar "${inexistente}"`) })).toBeVisible();
  await expect(modal.getByRole('button', { name: new RegExp(`Registrar "${inexistente}" como cliente nuevo`) })).toBeVisible();

  // Con la ficha real y una búsqueda retenida, Enter no sustituye la ficha por «venta rápida» sin ID.
  const retenida = await retrasarPrimera(page, 'qa043 sel%', 2500);
  await buscador.fill('ZZZ TEST F2 qa043 sel');
  await expect.poll(() => retenida.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(nombre);
  await buscador.press('Enter');
  await expect(modal).toBeVisible(); // no se eligió nada con la búsqueda pendiente
  await expect(fichaCaja(modal)).toHaveCount(1);
  await expect.poll(() => retenida.liberada, { message: 'la respuesta antigua se liberó', timeout: 9000 }).toBe(true);
  await page.waitForTimeout(400);
  await expect(modal.getByRole('button', { name: new RegExp(nombreSenuelo) })).toHaveCount(0); // la respuesta vieja no pisó
  await expect(fichaCaja(modal)).toHaveCount(1);
  await expect(modal.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
});

test('Caja: con la búsqueda fallida se avisa, no se sugiere crear y Enter no elige nada', async ({ page }) => {
  const { modal, buscador } = await abrirCaja(page);
  await fallar(page);
  await buscador.fill(`cualquiera ${tag}`);
  await expect(modal.getByText('No se pudo buscar clientes', { exact: false })).toBeVisible();
  await expect(modal.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
  await buscador.press('Enter');
  await expect(modal).toBeVisible();
  await page.unroute('**/rest/v1/clientes?*ilike*');
  await modal.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(modal.getByText('No se pudo buscar clientes', { exact: false })).toHaveCount(0);
});
