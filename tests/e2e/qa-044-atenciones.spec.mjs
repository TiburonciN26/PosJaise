// QA-044 en la interfaz: Caja → «+ Agregar servicio» → «Atención a cobrar» debe encontrar atenciones pendientes
// fuera de las primeras 1000 (max_rows), cobrarlas vinculadas al registro correcto, permitir anularlas y no
// permitir un doble cobro, con ADMINISTRADOR y CAJERA. Solo Supabase Local TEST; login por la interfaz normal.
// Datos: por SQL local, atenciones ficticias «ZZZ TEST F2 qa044 …» con fecha de AHORA (las más nuevas, o sea
// después de las primeras 1000 por fecha) y relleno antiguo hasta superar 1100 pendientes. No se borra ni se
// renombra nada y no se toca max_rows.
import { test, expect } from './fixtures.mjs';
import { login, visibleButton } from './helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36);

test.beforeAll(async () => {
  await h.verificarLocalTest();
  const total = Number(await h.json(`select to_json(count(*)) from public.registro_servicios where estado='ACTIVO' and venta_id is null`));
  if (total < 1100) {
    const servicio = await h.nuevoServicio(10);
    const cliente = await h.nuevaClienta({ vinculada: false });
    const r = await h.admin(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
      select gen_random_uuid(), '${h.ADMIN}', '${servicio}', '${cliente.clienteId}', 10,
             now() - interval '3 years' - (g || ' minutes')::interval, 'ACTIVO' from generate_series(1, ${1100 - total}) g;`);
    if (!r.ok) throw new Error(r.err);
  }
});

let contadorCasos = 0;
// Un caso = una clienta PRINCIPAL con una atención pendiente de servicio único, más un SEÑUELO (otra clienta y
// otro servicio cuyos nombres comparten el prefijo del caso) para distinguir resultados viejos de nuevos.
async function caso(rol) {
  const k = `${tag}-${++contadorCasos}`;
  const clienteId = crypto.randomUUID();
  const clienteSenuelo = crypto.randomUUID();
  const nombreCli = `ZZZ TEST F2 qa044 ${k} PRINCIPAL`;
  const nombreCliSenuelo = `ZZZ TEST F2 qa044 ${k} SENUELO`;
  const ins = await h.admin(`insert into public.clientes (id, nombre) values ('${clienteId}', '${nombreCli}'), ('${clienteSenuelo}', '${nombreCliSenuelo}');`);
  if (!ins.ok) throw new Error(ins.err);
  const servicioId = await h.nuevoServicio(25);
  const nombreServicio = await h.json(`select to_json(nombre) from public.servicios where id='${servicioId}'`);
  const servicioSenuelo = await h.nuevoServicio(11);
  const nombreServicioSenuelo = await h.json(`select to_json(nombre) from public.servicios where id='${servicioSenuelo}'`);
  const atencionId = await h.nuevaAtencion(clienteId, servicioId, 25);
  await h.nuevaAtencion(clienteSenuelo, servicioSenuelo, 11);
  const antes = Number(await h.json(`select to_json(count(*)) from public.registro_servicios r
    where r.estado='ACTIVO' and r.venta_id is null and r.fecha < (select fecha from public.registro_servicios where id='${atencionId}')`));
  if (antes < 1000) throw new Error(`Precondición: solo ${antes} pendientes preceden a la atención; hacen falta ≥ 1000.`);
  return { rol, clienteId, nombreCli, servicioId, nombreServicio, nombreServicioSenuelo, atencionId, prefijo: `ZZZ TEST F2 qa044 ${k}` };
}

async function abrirModal(page, rol) {
  await login(page, rol, {});
  await page.goto('/ventas');
  await visibleButton(page, '+ Agregar servicio').click();
  const modal = page.getByRole('dialog', { name: 'Atención a cobrar' });
  await expect(modal).toBeVisible();
  return { modal, buscador: modal.getByPlaceholder('Buscar por servicio o cliente...') };
}

for (const rol of ['ADMINISTRADOR', 'CAJERA']) {
  test(`${rol}: la atención fuera de las primeras 1000 se encuentra, se cobra vinculada al registro correcto, se anula y no se cobra dos veces`, async ({ page }) => {
    test.setTimeout(180_000);
    const c = await caso(rol);
    const { modal, buscador } = await abrirModal(page, rol);

    // Sin texto la lista es una página acotada y AVISA que hay más (no parece completa).
    await expect(modal.getByText('Hay más atenciones pendientes de las que se muestran', { exact: false })).toBeVisible();

    // Búsqueda por clienta: aparece la fila inequívoca (nombre de servicio único de este caso).
    await buscador.fill(c.nombreCli);
    const fila = modal.getByRole('button', { name: new RegExp(c.nombreServicio) });
    await expect(fila).toHaveCount(1);
    await fila.click();

    // Quedó en el carrito del ticket y desapareció del buscador (no se puede agregar dos veces).
    await expect(modal.getByRole('button', { name: new RegExp(c.nombreServicio) })).toHaveCount(0);
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.getByText(c.nombreServicio).first()).toBeVisible();

    await page.getByRole('button', { name: 'Yape', exact: true }).click();
    const vendida = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    const respuesta = await vendida;
    expect(respuesta.ok(), 'el cobro se confirma').toBeTruthy();
    const cuerpo = await respuesta.json();
    const venta = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;

    // Vínculo al registro correcto, persistencia tras recargar y cliente_id de la venta.
    expect(await h.json(`select to_json(venta_id) from public.registro_servicios where id='${c.atencionId}'`)).toBe(venta.venta_id);
    expect(await h.json(`select to_json(cliente_id) from public.ventas where id='${venta.venta_id}'`)).toBe(c.clienteId);
    expect(await h.json(`select to_json(count(*)) from public.venta_items where venta_id='${venta.venta_id}' and tipo='SERVICIO'`)).toBe(1);
    await page.reload();
    await visibleButton(page, '+ Agregar servicio').click();
    const modal2 = page.getByRole('dialog', { name: 'Atención a cobrar' });
    await modal2.getByPlaceholder('Buscar por servicio o cliente...').fill(c.nombreCli);
    await expect(modal2.getByText('No hay atenciones pendientes con ese nombre', { exact: false })).toBeVisible(); // ausencia REAL ya cobrada
    await modal2.getByRole('button', { name: 'Cerrar', exact: true }).click();

    // Sin doble cobro: un segundo intento sobre el mismo registro se rechaza en el servidor.
    const dobles = await h.paso(rol === 'ADMINISTRADOR' ? h.ADMIN : h.CAJERA, `select * from public.confirmar_venta('Yape', null, $j$[{"tipo":"SERVICIO","registro_servicio_id":"${c.atencionId}","cantidad":1}]$j$::jsonb);`);
    expect(dobles.ok).toBe(false);
    expect(dobles.err).toContain('ya no está disponible para vender');

    // Anulación por Historial: la atención vuelve a ser pendiente y se vuelve a encontrar.
    await page.goto('/historial');
    await page.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo);
    await page.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
    await visibleButton(page, 'Anular venta').click();
    await visibleButton(page, 'Sí, anular').click();
    await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
    expect(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${c.atencionId}'`)).toBe(true);

    await page.goto('/ventas');
    await visibleButton(page, '+ Agregar servicio').click();
    const modal3 = page.getByRole('dialog', { name: 'Atención a cobrar' });
    await modal3.getByPlaceholder('Buscar por servicio o cliente...').fill(c.nombreServicio);
    await expect(modal3.getByRole('button', { name: new RegExp(c.nombreServicio) })).toHaveCount(1);
  });
}

test('búsqueda fallida: se avisa, no se dice que no hay atenciones y Enter no elige nada; reintentar recupera', async ({ page }) => {
  const c = await caso('ADMINISTRADOR');
  const { modal, buscador } = await abrirModal(page, 'ADMINISTRADOR');
  await page.route('**/rest/v1/registro_servicios?*', (route) => route.abort('failed'));
  await buscador.fill(c.nombreCli);
  await expect(modal.getByText('No se pudieron cargar las atenciones pendientes', { exact: false })).toBeVisible();
  await expect(modal.getByText('No hay atenciones pendientes', { exact: false })).toHaveCount(0);
  await buscador.press('Enter');
  await expect(modal).toBeVisible();
  await page.unroute('**/rest/v1/registro_servicios?*');
  await modal.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(modal.getByRole('button', { name: new RegExp(c.nombreServicio) })).toHaveCount(1);
});

test('respuesta vieja: una respuesta retenida no pisa a la nueva y Enter no elige una fila desactualizada', async ({ page }) => {
  const c = await caso('ADMINISTRADOR');
  const { modal, buscador } = await abrirModal(page, 'ADMINISTRADOR');
  const estado = { interceptada: false, liberada: false };
  // Los espacios del filtro viajan como «+» o «%20»: se decodifica antes de comparar.
  const decodificada = (peticion) => decodeURIComponent(peticion.url().replace(/\+/g, ' '));
  await page.route('**/rest/v1/registro_servicios?*', async (route) => {
    // Se retiene la primera petición del texto PARCIAL (prefijo del caso: devuelve principal Y señuelo).
    if (!estado.interceptada && route.request().url().includes('ilike') && decodificada(route.request()).includes(c.prefijo + '%')) {
      estado.interceptada = true;
      const respuesta = await route.fetch();
      await new Promise((r) => setTimeout(r, 2000));
      estado.liberada = true;
      return route.fulfill({ response: respuesta });
    }
    return route.continue();
  });
  await buscador.fill(c.prefijo);
  await expect.poll(() => estado.interceptada, { message: 'la petición parcial se interceptó' }).toBe(true);
  await buscador.fill(c.nombreServicio); // texto distinto → solo la atención PRINCIPAL
  await buscador.press('Enter'); // pendiente: no debe elegir nada
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: new RegExp(c.nombreServicio) })).toHaveCount(1);
  await expect.poll(() => estado.liberada, { message: 'la respuesta retenida se liberó', timeout: 8000 }).toBe(true);
  await page.waitForTimeout(500);
  // La respuesta antigua traía al señuelo: si hubiera pisado a la nueva, estaría en la lista.
  await expect(modal.getByRole('button', { name: new RegExp(c.nombreServicioSenuelo) })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: new RegExp(c.nombreServicio) })).toHaveCount(1);
  await expect(buscador).toHaveValue(c.nombreServicio);
});
