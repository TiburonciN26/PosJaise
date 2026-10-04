// QA-043 en la interfaz: «Registrar atención → Buscar cliente» debe encontrar a una clienta que queda
// fuera de los primeros 1000 registros (max_rows), no ofrecer crearla de nuevo, descartar respuestas
// viejas al escribir rápido y conservar el alta legítima de un cliente que no existe.
// Solo Supabase Local TEST. Login por la interfaz normal (ADMINISTRADOR QA). La clienta ficticia y el
// relleno se insertan por SQL local; no se elimina ni renombra nada ni se toca el límite del servidor.
import { test, expect } from './fixtures.mjs';
import { login, visibleButton, formWithTitle } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

const tag = Date.now().toString(36);
const nombre = `ZZZ TEST F2 qa043 ui ${tag}`;
const nombreSenuelo = `ZZZ TEST F2 qa043 ui SENUELO ${tag}`; // coincide con el texto parcial, no con el nombre completo
let clienteId;

test.beforeAll(async () => {
  await h.verificarLocalTest();
  const total = Number(await h.json(`select to_json(count(*)) from public.clientes`));
  if (total < 1100) {
    const r = await h.admin(`insert into public.clientes (id, nombre)
      select gen_random_uuid(), 'TEST F2 relleno ui ' || g from generate_series(1, ${1100 - total}) g;`);
    if (!r.ok) throw new Error(r.err);
  }
  clienteId = crypto.randomUUID();
  const r = await h.admin(`insert into public.clientes (id, nombre) values ('${clienteId}', '${nombre}'), (gen_random_uuid(), '${nombreSenuelo}');`);
  if (!r.ok) throw new Error(r.err);
  const antes = Number(await h.json(`select to_json(count(*)) from public.clientes where nombre < '${nombre}'`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} clientas preceden a la del caso; hacen falta ≥ 1000.`);
});

// Los espacios del filtro viajan como «+» o «%20»: se decodifica antes de comparar.
const decodificada = (peticion) => decodeURIComponent(peticion.url().replace(/\+/g, ' '));

async function abrirRegistro(page) {
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/mi-panel');
  await visibleButton(page, 'Registrar atención').click();
  const form = formWithTitle(page, 'Registrar atención');
  await expect(form).toBeVisible();
  return form;
}

test('QA-043: la clienta fuera de los primeros 1000 se encuentra, se selecciona y no se ofrece crearla', async ({ page }) => {
  const form = await abrirRegistro(page);
  const buscador = form.getByPlaceholder('Buscar cliente...');
  await buscador.fill(nombre);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
  await form.getByRole('button', { name: nombre, exact: true }).click();
  await expect(buscador).toHaveValue(nombre);
  await expect(form.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
});

test('QA-043: al escribir rápido, una respuesta vieja no pisa a la nueva', async ({ page }) => {
  const form = await abrirRegistro(page);
  const buscador = form.getByPlaceholder('Buscar cliente...');
  const estado = { interceptada: false, liberada: false };
  // La primera búsqueda (texto parcial, que devuelve al señuelo) tarda; la segunda (nombre completo) responde antes.
  await page.route('**/rest/v1/clientes?*', async (route) => {
    if (route.request().method() !== 'GET' || !route.request().url().includes('ilike')) return route.continue();
    // La petición del texto parcial termina en «ui%»; la del nombre completo, no.
    if (!estado.interceptada && decodificada(route.request()).includes('qa043 ui%')) {
      estado.interceptada = true;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, 1800));
      estado.liberada = true;
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  await buscador.fill('ZZZ TEST F2 qa043 ui');
  await expect.poll(() => estado.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(nombre);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(crear(form)).toHaveCount(0);
  await expect.poll(() => estado.liberada, { message: 'la respuesta antigua se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  // Si la respuesta vieja hubiera pisado a la nueva, el señuelo estaría en la lista.
  await expect(form.getByRole('button', { name: nombreSenuelo, exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
});

test('QA-043: un cliente que no existe sigue pudiendo darse de alta, solo cuando la búsqueda terminó', async ({ page }) => {
  const form = await abrirRegistro(page);
  const buscador = form.getByPlaceholder('Buscar cliente...');
  const inexistente = `Clienta inexistente ${tag}-${Math.random().toString(36).slice(2, 7)}`;
  await buscador.fill(inexistente);
  await expect(form.getByRole('button', { name: new RegExp(`Registrar "${inexistente}" como cliente nuevo`) })).toBeVisible();
});

test('QA-043: si falla la búsqueda no se ofrece crear y se avisa', async ({ page }) => {
  const form = await abrirRegistro(page);
  await page.route('**/rest/v1/clientes?*ilike*', (route) => route.abort('failed'));
  await form.getByPlaceholder('Buscar cliente...').fill(`cualquiera ${tag}`);
  await expect(form.getByText('No se pudo buscar clientes', { exact: false })).toBeVisible();
  await expect(form.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
});
