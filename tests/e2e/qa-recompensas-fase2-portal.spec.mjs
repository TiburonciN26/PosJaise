// Portal de la clienta — Recompensas Fase 2 (canje, sellos, movimientos, catálogo público, aislamiento).
// Solo Supabase Local TEST (guarda de fixtures.mjs + verificarLocalTest). Login por la interfaz normal;
// la clienta es la CLIENTE ficticia aislada de global-setup y una segunda CLIENTE (isolatedClient).
// El saldo/sellos de partida y el catálogo se preparan por SQL local (helpers de recompensas-fase2): no hay
// vía de UI para otorgar saldo de prueba. Las ACCIONES bajo prueba (canjear, reclamar, leer) se hacen siempre
// por la interfaz y se anclan al premio elegido (data-premio-id), nunca a «el primer botón de la página».
// El programa se activa para la prueba y SIEMPRE se restaura (afterAll), incluso si una prueba falla.
import { test, expect } from './fixtures.mjs';
import { login, logout } from './helpers.mjs';
import { isolatedClient, qaContext } from './phase2-helpers.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

let cfg0;
let clienteId; // CLIENTE A
let premioMonId;
let distractorId;
let premioSelId;
const tag = Date.now().toString(36);
const premioMon = `TEST F2 portal monedas ${tag}`;
const distractor = `TEST F2 portal distractor ${tag}`;
const premioSel = `TEST F2 portal sellos ${tag}`;

// ---- anclas ---------------------------------------------------------------------------------
const toggleDe = (page, nombre) => page.getByRole('button', { name: new RegExp(nombre) }).first();
const detalleDe = (page, id) => page.locator(`[data-premio-id="${id}"]`);
const obtenerDe = (page, id) => detalleDe(page, id).getByRole('button', { name: 'Obtener cupón', exact: true });
async function abrirPremio(page, nombre, id) {
  const t = toggleDe(page, nombre);
  await expect(t).toBeVisible();
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
  await expect(t).toHaveAttribute('aria-expanded', 'true');
  await expect(detalleDe(page, id)).toBeVisible();
  return obtenerDe(page, id);
}
const dialogo = (page) => page.getByRole('dialog');
const reclamarSellos = (page) =>
  page.getByRole('listitem').filter({ hasText: premioSel }).getByRole('button', { name: /Reclamar por 5 sellos/ });

async function idCliente(authId, nombre) {
  await h.admin(`insert into public.clientes_web (id, email) select id, email from auth.users where id='${authId}' on conflict (id) do nothing;`);
  let id = await h.json(`select to_json(id) from public.clientes where cliente_web_id='${authId}'`);
  if (!id) {
    id = crypto.randomUUID();
    await h.admin(`insert into public.clientes (id, nombre, cliente_web_id) values ('${id}', '${nombre}', '${authId}');`);
  }
  return id;
}

async function fijarSaldo(cid, monedas, clasificacion, sellos) {
  // Los libros son solo-insertar: se compensa con un movimiento de ajuste hasta el valor deseado.
  const s = await h.saldos(cid);
  await h.darMonedas(cid, monedas - Number(s.monedas), clasificacion - Number(s.clasificacion));
  if (sellos !== s.sellos) await h.darSellos(cid, sellos - s.sellos);
}

test.beforeAll(async () => {
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  await h.activar(true);
});
test.afterAll(async () => {
  // Restauración del programa (activo/corte y tasas) pase lo que pase.
  if (cfg0) await h.restaurarConfig(cfg0);
});

test('preparación: clienta A con 100 monedas, Premium y 20 sellos; premios (con un distractor que va primero)', async ({ data }) => {
  const authId = await h.json(`select to_json(id) from auth.users where email='${data.clientEmail}'`);
  clienteId = await idCliente(authId, `TEST F2 portal ${tag}`);
  await fijarSaldo(clienteId, 100, 60, 20);

  // Distractor: más barato (aparece ANTES) y exclusivo VIP → su botón está deshabilitado.
  distractorId = await h.nuevoPremio({ costoBasico: 5, valor: 2, nivelMinimo: 'VIP', activo: true });
  await h.admin(`update public.recompensas_catalogo set nombre='${distractor}' where id='${distractorId}'`);
  premioMonId = await h.nuevoPremio({ costoBasico: 40, valor: 5, nivelMinimo: 'BASICO', activo: true });
  await h.admin(`update public.recompensas_catalogo set nombre='${premioMon}' where id='${premioMonId}'`);
  premioSelId = await h.nuevoPremio({ origen: 'SELLOS', valor: 8, activo: true });
  await h.admin(`update public.recompensas_catalogo set nombre='${premioSel}' where id='${premioSelId}'`);

  const s = await h.saldos(clienteId);
  expect(Number(s.monedas)).toBe(100);
  expect(s.sellos).toBe(20);
});

test('Mi tarjeta: monedas disponibles separadas de la clasificación', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=tarjeta');
  await expect(page.getByText('MONEDAS DISPONIBLES')).toBeVisible();
  await expect(page.getByText(/Saldo de monedas:\s*100/)).toBeVisible();
  await expect(page.getByText('Gastar tus monedas no hace bajar tu nivel.')).toBeVisible();
});

test('Anclaje: el botón del distractor (VIP) está deshabilitado y el del premio elegido, habilitado', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  const dis = await abrirPremio(page, distractor, distractorId);
  await expect(dis).toBeDisabled();
  const elegido = await abrirPremio(page, premioMon, premioMonId);
  await expect(elegido).toBeEnabled();
});

test('Canjear: condiciones, cancelar sin débito y doble clic con un único cupón', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();

  await (await abrirPremio(page, premioMon, premioMonId)).click();
  const d = dialogo(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { name: premioMon })).toBeVisible();
  await expect(d.getByText('Este canje es definitivo', { exact: false })).toBeVisible();
  await expect(d.getByText(/40 monedas/).first()).toBeVisible();
  await expect(d.getByText(/Saldo después/)).toBeVisible();
  await expect(d.getByText('Solo puedes usar un cupón por compra', { exact: false })).toBeVisible();
  await expect(d.getByText('sin protección configurada', { exact: false })).toBeVisible();

  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialogo(page)).toHaveCount(0);
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(100);
  expect(await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}' and catalogo_id='${premioMonId}'`)).toBe(0);

  await obtenerDe(page, premioMonId).click();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).dblclick();
  await expect(dialogo(page).getByText('Canje realizado')).toBeVisible();
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(60);
  expect(await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}' and catalogo_id='${premioMonId}'`)).toBe(1);
  expect(await h.json(`select to_json(count(*)) from public.cupones where cliente_id='${clienteId}' and catalogo_id='${premioMonId}'`)).toBe(1);
  await dialogo(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText(/Tienes\s*60 monedas\s*disponibles/)).toBeVisible();
});

test('Respuesta perdida: el servidor procesa el canje y el reintento recupera el MISMO cupón sin otro débito', async ({ page, data }) => {
  await fijarSaldo(clienteId, 100, 60, 20);
  const canjesAntes = await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}' and catalogo_id='${premioMonId}'`);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  let primera = true;
  await page.route('**/rest/v1/rpc/canjear_recompensa', async (route) => {
    if (primera) {
      primera = false;
      await route.fetch(); // el servidor sí procesa el canje…
      await route.abort('failed'); // …pero la respuesta nunca llega al navegador
    } else {
      await route.continue();
    }
  });
  await (await abrirPremio(page, premioMon, premioMonId)).click();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('No pudimos confirmar si el canje se realizó', { exact: false })).toBeVisible();
  const monedasTrasPerdida = Number((await h.saldos(clienteId)).monedas);
  expect(monedasTrasPerdida).toBe(60); // ya estaba debitado una vez
  const cuponDelCanje = await h.json(`select to_json(codigo) from public.cupones where cliente_id='${clienteId}' and catalogo_id='${premioMonId}' order by creado_en desc limit 1`);

  await dialogo(page).getByRole('button', { name: 'Reintentar canje', exact: true }).click();
  await expect(dialogo(page).getByText('Recuperamos el cupón de este canje')).toBeVisible();
  await expect(dialogo(page).getByText(cuponDelCanje, { exact: true })).toBeVisible(); // el mismo código
  expect(Number((await h.saldos(clienteId)).monedas)).toBe(60); // sin segundo débito
  expect(await h.json(`select to_json(count(*)) from public.recompensas_canjes where cliente_id='${clienteId}' and catalogo_id='${premioMonId}'`)).toBe(canjesAntes + 1);
});

test('Recarga con un canje sin confirmar: se conserva la clave y se recupera el mismo resultado', async ({ page, data }) => {
  await fijarSaldo(clienteId, 100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  await page.route('**/rest/v1/rpc/canjear_recompensa', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await (await abrirPremio(page, premioMon, premioMonId)).click();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('No pudimos confirmar', { exact: false })).toBeVisible();
  const debitos = await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`);
  await page.unroute('**/rest/v1/rpc/canjear_recompensa');

  await page.reload();
  await (await abrirPremio(page, premioMon, premioMonId)).click();
  await expect(dialogo(page).getByText('Quedó un canje sin confirmar', { exact: false })).toBeVisible();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('Recuperamos el cupón de este canje')).toBeVisible();
  expect(await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`)).toBe(debitos);
});

test('Mis sellos: aviso verde al llegar a 20, reclamo de 5 y la tarjeta vuelve a poder acumular', async ({ page, data }) => {
  await fijarSaldo(clienteId, 100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Tienes 20 sellos. Canjea una recompensa para seguir acumulando.')).toBeVisible();
  await expect(page.getByText(/Un sello por día de Perú/).first()).toBeVisible();
  await expect(reclamarSellos(page)).toBeEnabled();
  await reclamarSellos(page).click();
  await expect(dialogo(page).getByText(/5 sellos/).first()).toBeVisible();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('Canje realizado')).toBeVisible();
  await dialogo(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect((await h.saldos(clienteId)).sellos).toBe(15);
  await expect(page.getByText('Tienes 20 sellos', { exact: false })).toHaveCount(0);
});

test('Sellos heredados mayores a 20 se conservan y se canjean de 5 en 5', async ({ page, data }) => {
  await fijarSaldo(clienteId, 100, 60, 35);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Tienes 35 sellos. Canjea una recompensa para seguir acumulando.')).toBeVisible();
  await reclamarSellos(page).click();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('Canje realizado')).toBeVisible();
  expect((await h.saldos(clienteId)).sellos).toBe(30);
});

test('Saldos negativos: se muestran, se explican y bloquean SOLO el premio elegido (anclado)', async ({ page, data }) => {
  await fijarSaldo(clienteId, -15, 60, -1);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=tarjeta');
  await expect(page.getByText(/Tu saldo es negativo/)).toBeVisible();
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(/Tu saldo de monedas es negativo/)).toBeVisible();
  const boton = await abrirPremio(page, premioMon, premioMonId);
  await expect(boton).toBeDisabled();
  await expect(detalleDe(page, premioMonId).getByText('No tienes monedas suficientes.')).toBeVisible();
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByText('Se descontó un sello por una venta anulada. Tus próximos sellos compensarán este ajuste.', { exact: false }).first()).toBeVisible();
  await expect(reclamarSellos(page)).toBeDisabled();
});

test('Movimientos: lista real con saldo después, fechas y filtro de gastados', async ({ page, data }) => {
  await fijarSaldo(clienteId, 100, 60, 20);
  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=movimientos');
  await expect(page.getByText(/saldo -?\d/).first()).toBeVisible();
  await expect(page.getByText(/Canje:/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Gastados', exact: true }).click();
  await expect(page.getByText(/Canje:/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reversiones', exact: true }).click();
  await expect(page.getByText(/Canje:/)).toHaveCount(0);
});

test('Catálogo público: sin sesión se ve lo publicado, canje bloqueado y sin consultas personales', async ({ page }) => {
  const consultas = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === 'http://127.0.0.1:54321') consultas.push(u.pathname);
  });
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(premioMon)).toBeVisible();
  await expect(page.getByText(/Tienes .* disponibles/)).toHaveCount(0);
  const boton = await abrirPremio(page, premioMon, premioMonId);
  await expect(boton).toBeDisabled();
  await expect(detalleDe(page, premioMonId).getByText('Inicia sesión para canjear')).toBeVisible();
  // También el distractor (otro premio) está bloqueado: ningún botón de la página permite canjear sin sesión.
  const todos = page.getByRole('button', { name: 'Obtener cupón', exact: true });
  for (const b of await todos.all()) await expect(b).toBeDisabled();
  expect(consultas.filter((p) => /\/rpc\/(mis_|mi_|canjear)/.test(p))).toEqual([]);
  expect(consultas.some((p) => p.endsWith('/rpc/catalogo_recompensas_publico'))).toBe(true);
});

test('Dos CLIENTE aisladas: saldos, movimientos, cupones y claves de recuperación no se mezclan', async ({ browser, data }) => {
  const b = await isolatedClient(browser, data, 'f2b');
  const clienteB = await idCliente(b.clientAuthId, `TEST F2 portal B ${tag}`);
  await fijarSaldo(clienteId, 100, 60, 20);
  await fijarSaldo(clienteB, 100, 0, 0);
  // Cada una canjea el mismo premio por separado; los datos de A no deben aparecer en B.
  const ctxA = await qaContext(browser);
  const ctxB = await qaContext(browser);
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  try {
    await login(pa, 'CLIENTE', data);
    await login(pb, 'CLIENTE', b);
    await pa.goto('/recompensas?seccion=canje');
    await pb.goto('/recompensas?seccion=canje');
    await expect(pa.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();
    await expect(pb.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();

    await (await abrirPremio(pa, premioMon, premioMonId)).click();
    await dialogo(pa).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
    await expect(dialogo(pa).getByText('Canje realizado')).toBeVisible();
    const codigoA = await h.json(`select to_json(codigo) from public.cupones where cliente_id='${clienteId}' and catalogo_id='${premioMonId}' order by creado_en desc limit 1`);
    await dialogo(pa).getByRole('button', { name: 'Cerrar', exact: true }).click();
    expect(Number((await h.saldos(clienteId)).monedas)).toBe(60);
    expect(Number((await h.saldos(clienteB)).monedas)).toBe(100); // B intacta

    // B recarga: su saldo, sus movimientos y sus cupones no incluyen nada de A.
    await pb.goto('/recompensas?seccion=movimientos');
    await expect(pb.getByText(/Canje:/)).toHaveCount(0);
    await pb.goto('/recompensas?seccion=cupones');
    await expect(pb.getByText(codigoA)).toHaveCount(0);
    await pb.goto('/recompensas?seccion=canje');
    await expect(pb.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('Cambio de cuenta en la MISMA pestaña: la clave pendiente de A no se usa para B', async ({ page, data, browser }) => {
  const b = await isolatedClient(browser, data, 'f2c');
  const clienteB = await idCliente(b.clientAuthId, `TEST F2 portal C ${tag}`);
  await fijarSaldo(clienteId, 100, 60, 20);
  await fijarSaldo(clienteB, 100, 0, 0);

  await login(page, 'CLIENTE', data);
  await page.goto('/recompensas?seccion=canje');
  await page.route('**/rest/v1/rpc/canjear_recompensa', async (route) => {
    await route.fetch();
    await route.abort('failed'); // A queda con un canje sin confirmar (y una clave en sessionStorage)
  });
  await (await abrirPremio(page, premioMon, premioMonId)).click();
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('No pudimos confirmar', { exact: false })).toBeVisible();
  await page.unroute('**/rest/v1/rpc/canjear_recompensa');
  await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  const debitosA = await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`);

  await logout(page);
  await login(page, 'CLIENTE', b);
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText(/Tienes\s*100 monedas\s*disponibles/)).toBeVisible();
  await (await abrirPremio(page, premioMon, premioMonId)).click();
  // B no hereda la clave de A: no ve el aviso de «canje sin confirmar».
  await expect(dialogo(page).getByText('Quedó un canje sin confirmar', { exact: false })).toHaveCount(0);
  await dialogo(page).getByRole('button', { name: 'Confirmar canje', exact: true }).click();
  await expect(dialogo(page).getByText('Canje realizado')).toBeVisible();
  await expect(dialogo(page).getByText('Recuperamos el cupón', { exact: false })).toHaveCount(0);
  expect(Number((await h.saldos(clienteB)).monedas)).toBe(60);
  expect(await h.json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${clienteId}' and tipo='CANJE'`)).toBe(debitosA);
});
