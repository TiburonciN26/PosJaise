// QA-046 en la interfaz: con más de 1000 servicios, Servicios, Nueva cita, Registrar atención y el combo de la
// ficha de servicio deben encontrar fichas posteriores al corte de 1000 filas, conservar la selección al editar y
// distinguir carga, error y ausencia. Solo Supabase Local TEST; login por la interfaz normal (ADMINISTRADOR).
// Datos: por SQL local, servicios ficticios «ZZZ …» (después del corte por nombre) y relleno hasta 1100 fichas.
// No se elimina ni renombra nada ni se toca max_rows. Requiere QA_TEST_PASSWORD solo en el proceso.
import { test, expect } from './fixtures.mjs';
import { login, visibleButton, formWithTitle } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

let objetivo; // { id, nombre }
let combinado; // { id, nombre }: su combo apunta al objetivo
let clienta; // { clienteId, nombre }

test.beforeAll(async () => {
  await h.verificarLocalTest();
  const total = Number(await h.json(`select to_json(count(*)) from public.servicios`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.servicios (id, nombre, precio, duracion_min)
      select gen_random_uuid(), 'AAA relleno QA046 ${h.runId} ' || lpad(g::text, 5, '0'), 10, 30
      from generate_series(1, ${1100 - total}) g;`);
    if (!r.ok) throw new Error(r.err);
  }
  const id = await h.nuevoServicio(2, null, { duracion_min: 30 });
  const nombre = 'ZZZ ' + (await h.json(`select to_json(nombre) from public.servicios where id='${id}'`));
  await h.admin(`update public.servicios set nombre='${nombre}', categoria='Cabello' where id='${id}'`);
  objetivo = { id, nombre };
  const idCombo = await h.nuevoServicio(5, null, { duracion_min: 45 });
  const nombreCombo = 'ZZZ ' + (await h.json(`select to_json(nombre) from public.servicios where id='${idCombo}'`));
  await h.admin(`update public.servicios set nombre='${nombreCombo}', categoria='Cabello', combo_con='${id}' where id='${idCombo}'`);
  combinado = { id: idCombo, nombre: nombreCombo };
  const c = await h.nuevaClienta({ vinculada: false });
  clienta = { clienteId: c.clienteId, nombre: await h.json(`select to_json(nombre) from public.clientes where id='${c.clienteId}'`) };
  const antes = Number(await h.json(`select to_json(count(*)) from public.servicios where nombre < '${nombre}'`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} nombres preceden al servicio del caso; hacen falta ≥ 1000.`);
});

// Los espacios del filtro viajan como «+» o «%20»: se decodifica antes de comparar.
const decodificada = (peticion) => decodeURIComponent(peticion.url().replace(/\+/g, ' '));

test('Servicios: la ficha posterior al corte se encuentra por nombre y el listado avisa que hay más (Cargar más)', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/servicios');
  await expect(page.getByRole('button', { name: 'Cargar más', exact: true })).toBeVisible();
  const filas = await page.getByRole('row').count();
  await page.getByRole('button', { name: 'Cargar más', exact: true }).click();
  await expect.poll(() => page.getByRole('row').count()).toBeGreaterThan(filas);
  await page.getByPlaceholder('Buscar servicio...').fill(objetivo.nombre);
  const fila = page.getByRole('row').filter({ hasText: objetivo.nombre });
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText('S/');
  await expect(fila).toContainText('30 min');
  await page.reload();
  await page.getByPlaceholder('Buscar servicio...').fill(objetivo.nombre);
  await expect(page.getByRole('row').filter({ hasText: objetivo.nombre })).toHaveCount(1);
});

test('Servicios: una búsqueda sin coincidencias dice que no hay servicios; si la consulta falla se avisa (no es ausencia)', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/servicios');
  await page.getByPlaceholder('Buscar servicio...').fill(`no-existe-${h.runId}`);
  await expect(page.getByText('No se encontraron servicios.', { exact: true })).toBeVisible();
  await page.route('**/rest/v1/servicios?*ilike*', (route) => route.abort('failed'));
  await page.getByPlaceholder('Buscar servicio...').fill(`falla-${h.runId}`);
  await expect(page.getByText('No se pudo cargar el catálogo de servicios.', { exact: true })).toBeVisible();
  await expect(page.getByText('No se encontraron servicios.', { exact: true })).toHaveCount(0);
});

test('Servicios → Editar: el combo guardado (fuera de la página de resultados) se conserva y se guarda sin cambiarlo', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/servicios');
  await page.getByPlaceholder('Buscar servicio...').fill(combinado.nombre);
  await page.getByRole('row').filter({ hasText: combinado.nombre }).getByRole('button', { name: 'Editar', exact: true }).click();
  const form = formWithTitle(page, 'Editar servicio');
  await expect(form).toBeVisible();
  const combo = form.getByLabel('Combo sugerido', { exact: false });
  await expect(combo).toHaveValue(objetivo.id); // la selección guardada se recupera por ID
  await expect(combo.locator('option:checked')).toHaveText(objetivo.nombre);
  // Buscar otra opción y volver a la guardada no pierde nada; guardar sin tocar el combo lo conserva.
  await form.getByPlaceholder('Buscar servicio por nombre...').fill('relleno QA046');
  await expect(combo).toHaveValue(objetivo.id);
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await h.json(`select to_json(combo_con) from public.servicios where id='${combinado.id}'`)).toBe(objetivo.id);
});

test('Nueva cita: el servicio posterior al corte se sugiere, se agrega con su precio y duración y la cita lo guarda', async ({ page, data }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/citas');
  await visibleButton(page, 'Nueva cita').first().click();
  const form = formWithTitle(page, 'Nueva cita');
  await expect(form).toBeVisible();
  await form.getByPlaceholder('Buscar cliente...').fill(clienta.nombre);
  await form.getByRole('button', { name: clienta.nombre, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(objetivo.nombre);
  const sugerencia = form.getByRole('button', { name: new RegExp(`^${objetivo.nombre} 30 min$`) });
  await expect(sugerencia).toHaveCount(1);
  await expect(form.getByRole('button', { name: /^Crear servicio/ })).toHaveCount(0); // existe: no se ofrece crearlo de nuevo
  await sugerencia.click();
  await expect(form.getByText(objetivo.nombre, { exact: true })).toBeVisible(); // línea agregada antes de Agendar
  const d = new Date(`${data.today}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + 5);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
  await form.getByLabel('Fecha y hora', { exact: false }).fill(`${dia}T11:30`);
  const guardada = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/guardar_cita_pos') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Agendar', exact: true }).click();
  expect((await guardada).ok()).toBeTruthy();
  await expect(form).toHaveCount(0);
  expect(Number(await h.json(`select to_json(count(*)) from public.cita_servicios cs join public.citas c on c.id = cs.cita_id where c.cliente_id='${clienta.clienteId}' and cs.servicio_id='${objetivo.id}' and cs.precio = 2 and cs.duracion_min = 30`))).toBe(1);
});

test('Nueva cita: una respuesta vieja no pisa a la nueva y, si la búsqueda falla, se avisa con Reintentar', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/citas');
  await visibleButton(page, 'Nueva cita').first().click();
  const form = formWithTitle(page, 'Nueva cita');
  const buscador = form.getByPlaceholder('Buscar servicio...');
  const estado = { interceptada: false, liberada: false };
  const prefijo = objetivo.nombre.slice(0, objetivo.nombre.length - 3);
  await page.route('**/rest/v1/servicios?*', async (route) => {
    // Se retiene la primera petición del texto PARCIAL; la del nombre completo responde antes.
    if (!estado.interceptada && route.request().url().includes('ilike') && decodificada(route.request()).includes(prefijo + '%')) {
      estado.interceptada = true;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, 1800));
      estado.liberada = true;
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  await buscador.fill(prefijo);
  await expect.poll(() => estado.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(objetivo.nombre);
  await expect(form.getByRole('button', { name: new RegExp(`^${objetivo.nombre} 30 min$`) })).toHaveCount(1);
  await expect.poll(() => estado.liberada, { message: 'la respuesta retenida se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  await expect(form.getByRole('button', { name: new RegExp(`^${objetivo.nombre} 30 min$`) })).toHaveCount(1);
  await page.unroute('**/rest/v1/servicios?*');
  await page.route('**/rest/v1/servicios?*ilike*', (route) => route.abort('failed'));
  await buscador.fill(`falla ${h.runId}`);
  await expect(form.getByText('No se pudo buscar servicios', { exact: false })).toBeVisible();
  await expect(form.getByText('No hay servicios que coincidan.', { exact: true })).toHaveCount(0);
  await page.unroute('**/rest/v1/servicios?*ilike*');
  await form.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(form.getByText('No se pudo buscar servicios', { exact: false })).toHaveCount(0);
});

test('Registrar atención: el servicio posterior al corte se agrega y la atención queda con ESE servicio, precio y clienta', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/mi-panel');
  await visibleButton(page, 'Registrar atención').click();
  const form = formWithTitle(page, 'Registrar atención');
  await form.getByPlaceholder('Buscar cliente...').fill(clienta.nombre);
  await form.getByRole('button', { name: clienta.nombre, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(objetivo.nombre);
  const sugerencia = form.getByRole('button', { name: new RegExp(`^${objetivo.nombre} 2\\.00$`) });
  await expect(sugerencia).toHaveCount(1);
  await expect(form.getByRole('button', { name: /^Crear servicio/ })).toHaveCount(0);
  await sugerencia.click();
  await expect(form.getByText(objetivo.nombre, { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(Number(await h.json(`select to_json(count(*)) from public.registro_servicios where cliente_id='${clienta.clienteId}' and servicio_id='${objetivo.id}' and precio = 2`))).toBe(1);
});

test('Registrar atención: una ausencia real de servicio sí ofrece crearlo (ADMINISTRADOR), solo cuando la búsqueda terminó', async ({ page }) => {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/mi-panel');
  await visibleButton(page, 'Registrar atención').click();
  const form = formWithTitle(page, 'Registrar atención');
  const inexistente = `Servicio inexistente ${h.runId}-${Math.random().toString(36).slice(2, 6)}`;
  await form.getByPlaceholder('Buscar servicio...').fill(inexistente);
  await expect(form.getByRole('button', { name: new RegExp(`Crear servicio "${inexistente}"`) })).toBeVisible();
});
