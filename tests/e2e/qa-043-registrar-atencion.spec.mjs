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
  const r = await h.admin(`insert into public.clientes (id, nombre) values ('${clienteId}', '${nombre}');`);
  if (!r.ok) throw new Error(r.err);
  const antes = Number(await h.json(`select to_json(count(*)) from public.clientes where nombre < '${nombre}'`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} clientas preceden a la del caso; hacen falta ≥ 1000.`);
});

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
  let primera = true;
  // La primera búsqueda (texto parcial) tarda; la segunda (nombre completo) responde antes.
  await page.route('**/rest/v1/clientes?*', async (route) => {
    if (route.request().method() !== 'GET' || !route.request().url().includes('ilike')) return route.continue();
    // La petición del texto parcial termina en «ui%» (…ui%25 en la URL); la del nombre completo, no.
    if (primera && route.request().url().includes('qa043%20ui%25')) {
      primera = false;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, 1800));
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  await buscador.fill('ZZZ TEST F2 qa043 ui');
  await page.waitForTimeout(500); // pasa el antirrebote: la petición parcial sale y queda retenida
  await buscador.fill(nombre);
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await page.waitForTimeout(2500); // llega la respuesta vieja: no debe sustituir la lista
  await expect(form.getByRole('button', { name: nombre, exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: /como cliente nuevo/ })).toHaveCount(0);
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
