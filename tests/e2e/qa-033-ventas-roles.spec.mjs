import { test, expect, knownIssue } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { buscadorCaja, sufijoUnico, login, visibleButton, formWithTitle } from './helpers.mjs';
import { isolatedClient, qaContext, testImage } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

// QA-033: solo ADMINISTRADOR y CAJERA crean y anulan ventas, también en el backend.
// Supabase Local TEST, datos ficticios. Las ventas «válidas» las prepara ADMINISTRADOR (una simple, una con
// cupón de referido y una nacida de un pedido del portal) y los intentos prohibidos se hacen con la sesión real
// de cada rol; después se comprueba que nada cambió (ventas, ítems, stock, cupones, pedido).

function watchApiKey(page) {
  const box = { key: null };
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) box.key = k;
  });
  return box;
}

async function rest(page, box, method, path, body, { sinToken = false } = {}) {
  return page.evaluate(async ({ method, path, body, key, base, sinToken }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const sesion = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null;
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (!sinToken && sesion) headers.Authorization = `Bearer ${sesion.access_token}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* cuerpo vacío */ }
    return { status: r.status, json, userId: sesion?.user?.id ?? null };
  }, { method, path, body, key: box.key, base: supabaseURL, sinToken });
}
const rpc = (page, box, nombre, args = {}, opts) => rest(page, box, 'POST', `/rest/v1/rpc/${nombre}`, args, opts);
const mensaje = (r) => JSON.stringify(r.json ?? '');
const fila = (r) => (Array.isArray(r.json) ? r.json[0] : r.json);

async function sesion(browser, data, rol, cuenta = data) {
  const ctx = await qaContext(browser);
  const page = await ctx.newPage();
  const box = watchApiKey(page);
  await login(page, rol, cuenta);
  return { ctx, page, box };
}

const S = {}; // estado compartido de la preparación

async function snapshot() {
  const a = S.admin;
  const ids = [S.v1, S.v2, S.v3];
  const ventas = (await rest(a.page, a.box, 'GET', `/rest/v1/ventas?id=in.(${ids.join(',')})&select=id,estado,total,cupon_id&order=id`)).json;
  const items = (await rest(a.page, a.box, 'GET', `/rest/v1/venta_items?venta_id=in.(${ids.join(',')})&select=id,venta_id,cantidad,subtotal&order=id`)).json;
  const todas = (await rest(a.page, a.box, 'GET', '/rest/v1/ventas?select=id,estado&order=id')).json;
  const stock = (await rest(a.page, a.box, 'GET', `/rest/v1/productos_vista?id=eq.${S.productoId}&select=stock_actual`)).json[0].stock_actual;
  const cupones = (await rest(a.page, a.box, 'GET', `/rest/v1/cupones?cliente_id=in.(${S.idA},${S.idB})&select=id,origen,estado,venta_id&order=id`)).json;
  const pedido = (await rest(a.page, a.box, 'GET', `/rest/v1/pedidos_web?venta_id=eq.${S.v3}&select=id,estado,pago_verificado,venta_id`)).json;
  // Libros de Recompensas (Fase 2): un rechazo no debe dejar NINGÚN movimiento de monedas ni de sellos.
  const movimientos = (await rest(a.page, a.box, 'GET', '/rest/v1/recompensas_movimientos?select=id,tipo,monedas,clasificacion,venta_id&order=id')).json;
  const sellos = (await rest(a.page, a.box, 'GET', '/rest/v1/recompensas_sellos_movs?select=id,tipo,delta,venta_id&order=id')).json;
  const canjes = (await rest(a.page, a.box, 'GET', '/rest/v1/recompensas_canjes?select=id&order=id')).json;
  return { ventas, items, totalVentas: todas.length, estadosVentas: todas.map((v) => v.estado).join(''), stock, cupones, pedido, movimientos, sellos, canjes };
}

test.describe.serial('QA-033: ventas solo para ADMINISTRADOR y CAJERA', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(480_000);
    // Recompensas ACTIVO durante la prueba para que los libros tengan movimientos que comparar; se restaura en afterAll.
    await h.verificarLocalTest();
    S.cfg0 = await h.configActual();
    await h.activar(true);
    const data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
    S.data = data;
    S.admin = await sesion(browser, data, 'ADMINISTRADOR');
    const { page, box } = S.admin;

    // Producto propio (precio S/20, stock 10) creado por la interfaz.
    await page.goto('/inventario');
    await visibleButton(page, 'Nuevo producto').first().click();
    const form = formWithTitle(page, 'Nuevo producto');
    const sufijo = sufijoUnico();
    S.productoNombre = `${data.prefix} Q033 Producto ${sufijo}`;
    await form.getByLabel('Nombre', { exact: false }).fill(S.productoNombre);
    await form.getByLabel('Código de barras', { exact: true }).fill(`${data.barcode}-Q033-${sufijo}`);
    await form.getByLabel('Stock inicial', { exact: false }).fill('10');
    // QA-055: con la protección económica de cupones, un costo 0 sin confirmar es DESCONOCIDO y bloquea el cupón de V2. Se registra
    // un costo ficticio conocido (S/5 sobre un precio de S/20: el cupón de bienvenida cabe en el descuento máximo de S/15).
    await form.getByLabel('Costo', { exact: false }).fill('5');
    await form.getByLabel('Precio de venta', { exact: false }).fill('20');
    const guardado = page.waitForResponse((r) => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    const prod = await (await guardado).json();
    S.productoId = prod.id ?? prod[0]?.id;
    await expect(form).toHaveCount(0);
    const item = (cantidad) => [{ tipo: 'PRODUCTO', producto_id: S.productoId, cantidad }];

    // V1: venta simple preparada por ADMINISTRADOR.
    const r1 = await rpc(page, box, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: item(1) });
    expect(r1.status).toBeLessThan(300);
    S.v1 = fila(r1).venta_id;

    // V2: venta con cupón de bienvenida de referido (genera la recompensa de la referente).
    S.A = await isolatedClient(browser, data, 'Q033A');
    S.B = await isolatedClient(browser, data, 'Q033B');
    const sa = await sesion(browser, data, 'CLIENTE', S.A);
    const sb = await sesion(browser, data, 'CLIENTE', S.B);
    try {
      const codigo = (await rpc(sa.page, sa.box, 'mi_codigo_referido')).json;
      expect((await rpc(sb.page, sb.box, 'aplicar_codigo_referido', { p_codigo: codigo })).status).toBeLessThan(300);
    } finally { await sa.ctx.close(); await sb.ctx.close(); }
    const clienteDe = async (tel) => (await rest(page, box, 'GET', `/rest/v1/clientes?telefono=eq.${tel}&select=id`)).json[0].id;
    S.idA = await clienteDe(S.A.phone);
    S.idB = await clienteDe(S.B.phone);
    const cupon = (await rest(page, box, 'GET', `/rest/v1/cupones?cliente_id=eq.${S.idB}&origen=eq.REFERIDO_BIENVENIDA&select=codigo`)).json[0].codigo;
    const r2 = await rpc(page, box, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: item(1), p_codigo_cupon: cupon, p_cliente_id: S.idB });
    expect(r2.status).toBeLessThan(300);
    S.v2 = fila(r2).venta_id;

    // V3: venta nacida de un pedido del portal (CLIENTE por la interfaz; ADMIN verifica el pago).
    S.C = await isolatedClient(browser, data, 'Q033C');
    const ctx = await qaContext(browser);
    try {
      const c = await ctx.newPage();
      await login(c, 'CLIENTE', S.C);
      await c.goto(`/productos/${S.productoId}`);
      await c.getByRole('button', { name: /^Agregar al carrito/ }).filter({ visible: true }).first().click();
      await c.goto('/carrito');
      await expect(c.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
      await c.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
      await c.getByRole('button', { name: 'Elige el día', exact: true }).click();
      await c.getByRole('button', { name: String(Number(data.tomorrow.slice(-2))), exact: true }).filter({ visible: true }).first().click();
      await c.getByRole('button', { name: 'Elige la hora', exact: true }).click();
      await c.getByRole('button', { name: '11:00', exact: true }).click();
      await c.getByRole('button', { name: 'Yape', exact: true }).click();
      await c.locator('input[type="file"]').setInputFiles(await testImage(c));
      const enviada = c.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
      await c.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
      expect((await enviada).ok(), 'el pedido del portal se crea').toBeTruthy();
    } finally { await ctx.close(); }
    await page.goto('/pedidos-web');
    await page.getByPlaceholder('Buscar por clienta...').fill(S.C.clientName);
    await page.getByRole('button').filter({ hasText: S.C.clientName }).click();
    const verificada = page.waitForResponse((r) => r.url().includes('/rpc/verificar_pago_pedido_web'));
    await page.getByRole('button', { name: 'Verificar pago', exact: true }).click();
    const rv = await verificada;
    expect(rv.ok(), 'verificar pago del pedido del portal sigue funcionando').toBeTruthy();
    S.v3 = await rv.json();
    S.antes = await snapshot();
    expect(S.antes.pedido[0].estado).toBe('LISTO');
    expect(S.antes.stock).toBe(7); // 10 − V1 − V2 − V3
    // Con el programa activo, V2 y V3 acreditaron monedas a sus clientas (V1 no tiene clienta).
    expect(S.antes.movimientos.filter((m) => m.tipo === 'VENTA').length, 'hay acreditaciones que comparar').toBeGreaterThanOrEqual(2);
  });

  test.afterAll(async () => {
    await S.admin?.ctx.close();
    if (S.cfg0) await h.restaurarConfig(S.cfg0); // restauración del programa aunque la prueba falle
  });

  const intentoCrear = (extra = {}) => ({ p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'PRODUCTO', producto_id: S.productoId, cantidad: 1 }], ...extra });

  test('ASISTENTE no puede crear una venta (RPC ni inserción directa)', async ({ browser }, info) => {
    test.setTimeout(120_000);
    knownIssue(info, 'QA-033');
    const a = await sesion(browser, S.data, 'ASISTENTE');
    try {
      const r = await rpc(a.page, a.box, 'confirmar_venta', intentoCrear());
      await info.attach('asistente-confirmar-venta', { body: Buffer.from(JSON.stringify({ status: r.status, body: r.json })), contentType: 'application/json' });
      expect(r.status, 'confirmar_venta por ASISTENTE').toBeGreaterThanOrEqual(400);
      expect(mensaje(r)).toContain('Solo el administrador o la cajera pueden registrar ventas');
      const uid = (await rest(a.page, a.box, 'GET', '/rest/v1/productos?select=id&limit=1')).userId;
      const directa = await rest(a.page, a.box, 'POST', '/rest/v1/ventas', { codigo: 'VEN-Q033', total: 20, metodo_pago: 'Yape', vendedor_id: uid });
      await info.attach('asistente-insert-directo', { body: Buffer.from(JSON.stringify({ status: directa.status, body: directa.json })), contentType: 'application/json' });
      expect(directa.status, 'INSERT directo en ventas por ASISTENTE').toBeGreaterThanOrEqual(400);
    } finally { await a.ctx.close(); }
    expect(await snapshot(), 'los intentos rechazados no cambian nada').toEqual(S.antes);
  });

  test('ASISTENTE no puede anular una venta válida preparada por ADMINISTRADOR', async ({ browser }, info) => {
    test.setTimeout(120_000);
    knownIssue(info, 'QA-033');
    const a = await sesion(browser, S.data, 'ASISTENTE');
    const resultados = {};
    try {
      for (const [nombre, id] of [['simple', S.v1], ['con cupón', S.v2], ['de pedido del portal', S.v3]]) {
        resultados[nombre] = await rpc(a.page, a.box, 'anular_venta', { p_venta_id: id });
      }
      const directa = await rest(a.page, a.box, 'PATCH', `/rest/v1/ventas?id=eq.${S.v1}`, { estado: 'ANULADA' });
      await info.attach('asistente-anular', { body: Buffer.from(JSON.stringify({ rpc: Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, { status: v.status, body: v.json }])), patch: { status: directa.status, body: directa.json } })), contentType: 'application/json' });
      for (const [nombre, r] of Object.entries(resultados)) {
        expect(r.status, `anular_venta (${nombre}) por ASISTENTE`).toBeGreaterThanOrEqual(400);
        expect(mensaje(r)).toContain('Solo el administrador o la cajera pueden anular ventas');
      }
      expect(directa.status >= 400 || (Array.isArray(directa.json) && directa.json.length === 0), 'PATCH directo a ventas').toBeTruthy();
    } finally { await a.ctx.close(); }
    expect(await snapshot(), 'ventas, ítems, stock, cupones y pedido sin cambios').toEqual(S.antes);
  });

  test('CLIENTE y las solicitudes sin sesión tampoco crean ni anulan ventas', async ({ browser }, info) => {
    test.setTimeout(120_000);
    knownIssue(info, 'QA-033');
    const c = await sesion(browser, S.data, 'CLIENTE', S.C);
    try {
      for (const [nombre, sinToken] of [['CLIENTE', false], ['sin sesión', true]]) {
        const crear = await rpc(c.page, c.box, 'confirmar_venta', intentoCrear(), { sinToken });
        const anular = await rpc(c.page, c.box, 'anular_venta', { p_venta_id: S.v1 }, { sinToken });
        expect(crear.status, `${nombre}: confirmar_venta`).toBeGreaterThanOrEqual(400);
        expect(anular.status, `${nombre}: anular_venta`).toBeGreaterThanOrEqual(400);
        if (!sinToken) {
          expect(mensaje(crear)).toContain('No tienes una sesión activa o válida');
          expect(mensaje(anular)).toContain('No tienes una sesión activa o válida');
        }
        const directa = await rest(c.page, c.box, 'POST', '/rest/v1/ventas', { codigo: 'VEN-Q033C', total: 20, metodo_pago: 'Yape', vendedor_id: S.idA }, { sinToken });
        expect(directa.status, `${nombre}: INSERT directo`).toBeGreaterThanOrEqual(400);
      }
    } finally { await c.ctx.close(); }
    expect(await snapshot()).toEqual(S.antes);
  });

  test('CAJERA y ADMINISTRADOR conservan sus flujos: venta y anulación por la interfaz, límite de hoy y pedidos del portal', async ({ browser }) => {
    test.setTimeout(240_000);
    const caja = await sesion(browser, S.data, 'CAJERA');
    try {
      const { page } = caja;
      // CAJERA vende por el POS y anula la venta de hoy por Historial.
      await page.goto('/ventas');
      await (await buscadorCaja(page)).fill(S.productoNombre);
      await page.getByRole('button', { name: new RegExp(S.productoNombre) }).click();
      await page.getByRole('button', { name: 'Yape', exact: true }).click();
      const vendida = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
      await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
      const respuesta = await vendida;
      expect(respuesta.ok(), 'CAJERA confirma una venta').toBeTruthy();
      const venta = fila({ json: await respuesta.json() });
      await page.reload();
      await page.goto('/historial');
      await page.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo);
      await page.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
      await visibleButton(page, 'Anular venta').click();
      await visibleButton(page, 'Sí, anular').click();
      await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();
      // La restricción existente de CAJERA se conserva: no anula una venta de otro día.
      const vieja = (await rest(S.admin.page, S.admin.box, 'GET', `/rest/v1/ventas?estado=eq.ACTIVA&fecha=lt.${S.data.today}T00:00:00-05:00&select=id&limit=1`)).json[0];
      if (vieja) {
        const r = await rpc(page, caja.box, 'anular_venta', { p_venta_id: vieja.id });
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(mensaje(r)).toContain('Solo puedes anular ventas de hoy');
      }
    } finally { await caja.ctx.close(); }

    // ADMINISTRADOR anula la venta del pedido del portal (regla de QA-027) y la venta con cupón (se devuelve el cupón).
    const a = S.admin;
    expect((await rpc(a.page, a.box, 'anular_venta', { p_venta_id: S.v3 })).status).toBeLessThan(300);
    expect((await rest(a.page, a.box, 'GET', `/rest/v1/pedidos_web?venta_id=eq.${S.v3}&select=estado`)).json[0].estado).toBe('CANCELADO');
    expect((await rpc(a.page, a.box, 'anular_venta', { p_venta_id: S.v2 })).status).toBeLessThan(300);
    const cuponB = (await rest(a.page, a.box, 'GET', `/rest/v1/cupones?cliente_id=eq.${S.idB}&origen=eq.REFERIDO_BIENVENIDA&select=estado`)).json[0];
    expect(cuponB.estado).toBe('DISPONIBLE');
    expect((await rpc(a.page, a.box, 'anular_venta', { p_venta_id: S.v1 })).status).toBeLessThan(300);
    const stock = (await rest(a.page, a.box, 'GET', `/rest/v1/productos_vista?id=eq.${S.productoId}&select=stock_actual`)).json[0].stock_actual;
    expect(stock, 'todo el stock vuelve').toBe(10);
    // Libros: cada venta acreditada tiene EXACTAMENTE una reversión y su neto de monedas/clasificación queda en 0.
    const movs = (await rest(a.page, a.box, 'GET', `/rest/v1/recompensas_movimientos?venta_id=in.(${S.v1},${S.v2},${S.v3})&select=tipo,monedas,clasificacion,venta_id`)).json;
    for (const v of [S.v2, S.v3]) {
      const m = movs.filter((x) => x.venta_id === v);
      expect(m.filter((x) => x.tipo === 'VENTA').length, 'una acreditación').toBe(1);
      expect(m.filter((x) => x.tipo === 'VENTA_REVERSION').length, 'una sola reversión').toBe(1);
      expect(m.reduce((acc, x) => acc + Number(x.monedas), 0)).toBeCloseTo(0, 8);
      expect(m.reduce((acc, x) => acc + Number(x.clasificacion), 0)).toBeCloseTo(0, 8);
    }
    // Una segunda anulación se rechaza y no añade nada a los libros.
    const librosAntes = (await rest(a.page, a.box, 'GET', '/rest/v1/recompensas_movimientos?select=id')).json.length;
    expect((await rpc(a.page, a.box, 'anular_venta', { p_venta_id: S.v2 })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(a.page, a.box, 'GET', '/rest/v1/recompensas_movimientos?select=id')).json.length, 'segunda anulación no repite efectos').toBe(librosAntes);
  });
});
