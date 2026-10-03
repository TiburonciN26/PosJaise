import { test, expect, knownIssue } from './fixtures.mjs';
import { login, logout, visibleButton, formWithTitle, createProduct, createService } from './helpers.mjs';
import { isolatedClient, qaContext, testImage } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';

// Cobertura adicional (brechas reales de la matriz): autorización de backend sin botones, sesión,
// referidos y cupones (límites y concurrencia), comisión de ASISTENTE con % asignado y pedido
// ENTREGADO frente a una anulación. Supabase Local TEST, datos ficticios. Las escrituras de
// negocio que se esperan RECHAZAR se envían por la API con la sesión real del rol; los datos
// de negocio válidos se crean por la interfaz salvo donde se indica (concurrencia).

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
const rpc = (page, box, nombre, args = {}) => rest(page, box, 'POST', `/rest/v1/rpc/${nombre}`, args);
const mensaje = (r) => JSON.stringify(r.json ?? '');
const sinEfecto = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);

async function abrirSesion(browser, data, rol, cuenta = data) {
  const ctx = await qaContext(browser);
  const page = await ctx.newPage();
  const box = watchApiKey(page);
  await login(page, rol, cuenta);
  return { ctx, page, box };
}

async function createPricedProduct(page, data, nombre, barcode, precio, stock = 10) {
  await page.goto('/inventario');
  await visibleButton(page, 'Nuevo producto').first().click();
  const form = formWithTitle(page, 'Nuevo producto');
  await form.getByLabel('Nombre', { exact: false }).fill(nombre);
  await form.getByLabel('Código de barras', { exact: true }).fill(barcode);
  await form.getByLabel('Stock inicial', { exact: false }).fill(String(stock));
  await form.getByLabel('Costo', { exact: false }).fill('0');
  await form.getByLabel('Precio de venta', { exact: false }).fill(String(precio));
  const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const row = await response.json();
  await expect(form).toHaveCount(0);
  return row.id ?? row[0]?.id;
}

test('AUTORIZACIÓN BACKEND: personal sin rol ADMIN y CLIENTE no escriben datos administrativos aunque no haya botón', async ({ page, browser, data }) => {
  test.setTimeout(240_000);
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const producto = { productName: `${data.prefix} AUTH Producto`, barcode: `${data.barcode}-AUTH`, initialStock: 10 };
  await createProduct(page, producto);
  const servicio = { serviceName: `${data.prefix} AUTH Servicio` };
  await createService(page, servicio);
  const own = await isolatedClient(browser, data, 'AUTH');
  const leerAdmin = async (ruta) => (await rest(page, key, 'GET', ruta)).json;
  const estadoAntes = (await leerAdmin('/rest/v1/estado_negocio?id=eq.1&select=abierto'))[0].abierto;

  for (const rol of ['CAJERA', 'ASISTENTE', 'CLIENTE']) {
    const s = await abrirSesion(browser, data, rol, rol === 'CLIENTE' ? own : data);
    try {
      const { page: p, box } = s;
      const prod = `/rest/v1/productos?id=eq.${producto.productId}`;
      expect(sinEfecto(await rest(p, box, 'PATCH', prod, { precio: 99 })), `${rol}: PATCH productos`).toBeTruthy();
      expect(sinEfecto(await rest(p, box, 'DELETE', prod)), `${rol}: DELETE productos`).toBeTruthy();
      expect((await rest(p, box, 'POST', '/rest/v1/productos', { nombre: `${data.prefix} X`, precio: 1, costo: 0, stock_actual: 1 })).status, `${rol}: POST productos`).toBeGreaterThanOrEqual(400);
      expect(sinEfecto(await rest(p, box, 'PATCH', `/rest/v1/servicios?id=eq.${servicio.serviceId}`, { precio: 99 })), `${rol}: PATCH servicios`).toBeTruthy();
      expect(sinEfecto(await rest(p, box, 'PATCH', '/rest/v1/estado_negocio?id=eq.1', { abierto: !estadoAntes })), `${rol}: PATCH estado_negocio`).toBeTruthy();
      expect((await rest(p, box, 'POST', '/rest/v1/promociones', { titulo: `${data.prefix} promo`, tipo_descuento: 'PORCENTAJE', valor: 50 })).status, `${rol}: POST promociones`).toBeGreaterThanOrEqual(400);
      expect((await rest(p, box, 'POST', '/rest/v1/asistentes', { nombres_completos: `${data.prefix} ficha` })).status, `${rol}: POST asistentes`).toBeGreaterThanOrEqual(400);
      const uid = (await rest(p, box, 'GET', '/rest/v1/productos?select=id&limit=1')).userId;
      expect(sinEfecto(await rest(p, box, 'PATCH', `/rest/v1/usuarios?id=eq.${uid}`, { rol: 'ADMINISTRADOR' })), `${rol}: autoascenso de rol`).toBeTruthy();
      if (rol !== 'CLIENTE') {
        // Gastos: ASISTENTE nada; CAJERA solo VARIABLE propio (política existente), nunca FIJO.
        const gasto = { nombre: `${data.prefix} gasto`, tipo: 'FIJO', monto: 5, mes: 1, anio: 2030, creado_por: uid };
        expect((await rest(p, box, 'POST', '/rest/v1/gastos', gasto)).status, `${rol}: gasto FIJO`).toBeGreaterThanOrEqual(400);
        if (rol === 'ASISTENTE') expect((await rest(p, box, 'POST', '/rest/v1/gastos', { ...gasto, tipo: 'VARIABLE' })).status, 'ASISTENTE: gasto VARIABLE').toBeGreaterThanOrEqual(400);
      }
      const falso = '00000000-0000-4000-8000-000000000001';
      const verificar = await rpc(p, box, 'verificar_pago_pedido_web', { p_pedido_id: falso });
      expect(verificar.status, `${rol}: verificar pago`).toBeGreaterThanOrEqual(400);
      if (rol !== 'CLIENTE') expect(mensaje(verificar)).toContain('Solo el administrador');
      if (rol === 'CLIENTE') {
        for (const [nombre, args] of [
          ['confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'PRODUCTO', producto_id: producto.productId, cantidad: 1 }] }],
          ['anular_venta', { p_venta_id: falso }],
          ['guardar_cita_pos', { p_cita_id: null, p_cliente_id: null, p_cliente_nombre_referencia: 'x', p_asistente_id: null, p_fecha_hora: new Date(Date.now() + 864e5).toISOString(), p_nota: null, p_adelanto: null, p_servicios: [] }],
        ]) {
          const r = await rpc(p, box, nombre, args);
          expect(r.status, `CLIENTE: ${nombre}`).toBeGreaterThanOrEqual(400);
          expect(mensaje(r)).toContain('No tienes una sesión activa o válida');
        }
      }
    } finally {
      await s.ctx.close();
    }
  }

  // Nada cambió: producto, servicio y estado del negocio intactos; ninguna ficha ni promoción de prueba.
  const prod = (await leerAdmin(`/rest/v1/productos_vista?id=eq.${producto.productId}&select=precio,stock_actual`))[0];
  expect(Number(prod.precio)).toBe(1);
  expect(prod.stock_actual).toBe(10);
  expect(Number((await leerAdmin(`/rest/v1/servicios?id=eq.${servicio.serviceId}&select=precio`))[0].precio)).toBe(2);
  expect((await leerAdmin('/rest/v1/estado_negocio?id=eq.1&select=abierto'))[0].abierto).toBe(estadoAntes);
  expect(await leerAdmin(`/rest/v1/asistentes?nombres_completos=eq.${encodeURIComponent(`${data.prefix} ficha`)}&select=id`)).toEqual([]);
  expect(await leerAdmin(`/rest/v1/promociones?titulo=eq.${encodeURIComponent(`${data.prefix} promo`)}&select=id`)).toEqual([]);

  // CAJERA solo anula ventas de hoy (regla existente): una venta de otro día se rechaza y no cambia.
  const hoyLima = data.today;
  const vieja = (await leerAdmin(`/rest/v1/ventas?estado=eq.ACTIVA&fecha=lt.${hoyLima}T00:00:00-05:00&select=id&limit=1`))[0];
  if (vieja) {
    const c = await abrirSesion(browser, data, 'CAJERA');
    try {
      const r = await rpc(c.page, c.box, 'anular_venta', { p_venta_id: vieja.id });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(mensaje(r)).toContain('Solo puedes anular ventas de hoy');
      expect((await leerAdmin(`/rest/v1/ventas?id=eq.${vieja.id}&select=estado`))[0].estado).toBe('ACTIVA');
    } finally {
      await c.ctx.close();
    }
  } else {
    test.info().annotations.push({ type: 'sin verificar', description: 'No había una venta ACTIVA de otro día en Local: no se verificó el límite «solo ventas de hoy» de CAJERA.' });
  }
});

test('QA-034: un CLIENTE no puede ejecutar por RPC las acciones solo de administración (es_admin() NULL)', async ({ page, browser, data }, info) => {
  test.setTimeout(180_000);
  knownIssue(info, 'QA-034');
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const producto = { productName: `${data.prefix} Q034 Producto`, barcode: `${data.barcode}-Q034`, initialStock: 10 };
  await createProduct(page, producto);
  const servicio = { serviceName: `${data.prefix} Q034 Servicio` };
  await createService(page, servicio);
  const own = await isolatedClient(browser, data, 'Q034');
  const c = await abrirSesion(browser, data, 'CLIENTE', own);
  const resultados = {};
  try {
    const falso = '00000000-0000-4000-8000-000000000002';
    const intentos = [
      ['eliminar_producto', { p_id: producto.productId }, /Solo el administrador puede eliminar productos/],
      ['eliminar_servicio', { p_id: servicio.serviceId }, /Solo el administrador puede eliminar servicios/],
      ['eliminar_asistente', { p_id: falso }, /Solo el administrador puede eliminar asistentes/],
      ['historial_stock_producto', { p_producto_id: producto.productId }, /No autorizado/],
      ['verificar_pago_pedido_web', { p_pedido_id: falso }, /Solo el administrador puede verificar pagos/],
    ];
    for (const [nombre, args] of intentos) resultados[nombre] = await rpc(c.page, c.box, nombre, args);
    await info.attach('cliente-rpc-admin', { body: Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, { status: v.status, body: v.json }])), null, 2)), contentType: 'application/json' });
    for (const [nombre, , esperado] of intentos) {
      expect(resultados[nombre].status, `CLIENTE: ${nombre}`).toBeGreaterThanOrEqual(400);
      expect(mensaje(resultados[nombre]), `CLIENTE: ${nombre}`).toMatch(esperado);
    }
  } finally {
    await c.ctx.close();
  }
  // Los registros ficticios siguen existiendo (nada se eliminó).
  expect((await rest(page, key, 'GET', `/rest/v1/productos?id=eq.${producto.productId}&select=id`)).json).toHaveLength(1);
  expect((await rest(page, key, 'GET', `/rest/v1/servicios?id=eq.${servicio.serviceId}&select=id`)).json).toHaveLength(1);
});

test('SESIÓN: sin token, token alterado, sesión eliminada y refresh tras cerrar sesión', async ({ page, browser, data }) => {
  test.setTimeout(150_000);
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  // Sin token (solo la clave pública): no hay datos de negocio ni se ejecutan RPC administrativas.
  expect(sinEfecto(await rest(page, key, 'GET', '/rest/v1/ventas?select=id&limit=1', undefined, { sinToken: true }))).toBeTruthy();
  expect(sinEfecto(await rest(page, key, 'GET', '/rest/v1/pedidos_web?select=id&limit=1', undefined, { sinToken: true }))).toBeTruthy();
  expect(sinEfecto(await rest(page, key, 'GET', '/rest/v1/clientes?select=id&limit=1', undefined, { sinToken: true }))).toBeTruthy();
  const anon = await rpc(page, key, 'anular_venta', { p_venta_id: '00000000-0000-4000-8000-000000000001' });
  const cuerpoSinToken = await page.evaluate(async ({ base, key }) => {
    const r = await fetch(`${base}/rest/v1/rpc/anular_venta`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_venta_id: '00000000-0000-4000-8000-000000000001' }) });
    return { status: r.status, texto: await r.text() };
  }, { base: supabaseURL, key: key.key });
  expect(cuerpoSinToken.status).toBeGreaterThanOrEqual(400);
  expect(anon.status).toBeLessThan(500);
  // Token alterado: se rechaza (401), sin datos.
  const alterado = await page.evaluate(async ({ base, key }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const token = JSON.parse(localStorage.getItem(storageKey)).access_token;
    const partes = token.split('.');
    const roto = `${partes[0]}.${partes[1]}.${partes[2].slice(0, -4)}AAAA`;
    const r = await fetch(`${base}/rest/v1/ventas?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${roto}` } });
    return r.status;
  }, { base: supabaseURL, key: key.key });
  expect(alterado).toBe(401);

  // Sesión eliminada del navegador mientras la app está abierta: recargar lleva a /login.
  const ctxA = await qaContext(browser);
  try {
    const pa = await ctxA.newPage();
    await login(pa, 'CAJERA', data);
    await pa.goto('/ventas');
    await pa.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k); sessionStorage.clear(); });
    await pa.reload();
    await expect(pa).toHaveURL(/\/login$/);
    await expect(pa.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await pa.goto('/historial');
    await expect(pa).toHaveURL(/\/login$/);
  } finally {
    await ctxA.close();
  }

  // Cerrar sesión por la interfaz: el refresh token anterior ya no sirve y las rutas protegidas piden login.
  const ctxB = await qaContext(browser);
  try {
    const pb = await ctxB.newPage();
    const caja = watchApiKey(pb);
    await login(pb, 'CAJERA', data);
    const viejos = await pb.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const s = JSON.parse(localStorage.getItem(k));
      return { refresh: s.refresh_token };
    });
    await logout(pb);
    const intento = await pb.evaluate(async ({ base, key, refresh }) => {
      const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
      return r.status;
    }, { base: supabaseURL, key: caja.key, refresh: viejos.refresh });
    expect(intento, 'el refresh token de una sesión cerrada no genera otra sesión').toBeGreaterThanOrEqual(400);
    await pb.goto('/ventas');
    await expect(pb).toHaveURL(/\/login$/);
  } finally {
    await ctxB.close();
  }
});

test('REFERIDOS Y CUPONES: reglas del código, límites del cupón, uso simultáneo y anulación', async ({ page, browser, data }) => {
  test.setTimeout(420_000);
  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  const producto = `${data.prefix} REF Producto`;
  const productoId = await createPricedProduct(page, data, producto, `${data.barcode}-REF`, 20, 10);
  const A = await isolatedClient(browser, data, 'REFA');
  const B = await isolatedClient(browser, data, 'REFB');
  const sa = await abrirSesion(browser, data, 'CLIENTE', A);
  const sb = await abrirSesion(browser, data, 'CLIENTE', B);
  const caja = await abrirSesion(browser, data, 'CAJERA');
  try {
    const clienteDe = async (telefono) => (await rest(page, key, 'GET', `/rest/v1/clientes?telefono=eq.${telefono}&select=id`)).json[0].id;
    const idA = await clienteDe(A.phone);
    const idB = await clienteDe(B.phone);
    const codigo = (await rpc(sa.page, sa.box, 'mi_codigo_referido')).json;
    expect(typeof codigo === 'string' && codigo.length >= 4).toBeTruthy();

    // Reglas del código (existentes)
    expect(mensaje(await rpc(sa.page, sa.box, 'aplicar_codigo_referido', { p_codigo: codigo }))).toContain('No puedes usar tu propio código');
    expect(mensaje(await rpc(sb.page, sb.box, 'aplicar_codigo_referido', { p_codigo: 'NOEXISTE' }))).toContain('Código de referido inválido');
    const ok = await rpc(sb.page, sb.box, 'aplicar_codigo_referido', { p_codigo: codigo.toLowerCase() });
    expect(ok.status, 'el código se acepta sin distinguir mayúsculas').toBeLessThan(300);
    expect(mensaje(await rpc(sb.page, sb.box, 'aplicar_codigo_referido', { p_codigo: codigo }))).toContain('Ya registraste un código de referido antes');

    // La clienta B recibe su cupón de bienvenida; la referente A todavía no recibe nada.
    const cuponesDe = async (idCliente) => (await rest(page, key, 'GET', `/rest/v1/cupones?cliente_id=eq.${idCliente}&select=id,codigo,origen,valor,estado,venta_id&order=creado_en`)).json;
    const bienvenida = (await cuponesDe(idB)).filter((c) => c.origen === 'REFERIDO_BIENVENIDA');
    expect(bienvenida).toHaveLength(1);
    expect(Number(bienvenida[0].valor)).toBe(10);
    expect(await cuponesDe(idA)).toEqual([]);

    // Límites del cupón en el POS (staff real): ajeno, combinado con otro descuento, mayor al total.
    const item = (cantidad) => [{ tipo: 'PRODUCTO', producto_id: productoId, cantidad }];
    const venta = (extra) => rpc(caja.page, caja.box, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: item(1), ...extra });
    expect(mensaje(await venta({ p_codigo_cupon: bienvenida[0].codigo, p_cliente_id: idA }))).toContain('Este cupón pertenece a otro cliente');
    expect(mensaje(await venta({ p_codigo_cupon: bienvenida[0].codigo, p_cliente_id: idB, p_descuento_pct: 10 }))).toContain('No puedes combinar un cupón con otro descuento');
    expect(mensaje(await venta({ p_codigo_cupon: 'INVALID' }))).toContain('Cupón inválido o ya usado');
    const stock = async () => (await rest(page, key, 'GET', `/rest/v1/productos_vista?id=eq.${productoId}&select=stock_actual`)).json[0].stock_actual;
    expect(await stock(), 'los intentos rechazados no descuentan stock').toBe(10);

    // Uso simultáneo del mismo cupón desde dos sesiones de staff: solo una venta lo consume.
    const [r1, r2] = await Promise.all([
      venta({ p_codigo_cupon: bienvenida[0].codigo, p_cliente_id: idB }),
      rpc(page, key, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: item(1), p_codigo_cupon: bienvenida[0].codigo, p_cliente_id: idB }),
    ]);
    const exitosas = [r1, r2].filter((r) => r.status < 300);
    expect(exitosas, 'solo una de las dos ventas simultáneas puede consumir el cupón').toHaveLength(1);
    const fallida = [r1, r2].find((r) => r.status >= 400);
    expect(mensaje(fallida)).toMatch(/Cupón inválido o ya usado/);
    expect(await stock(), 'stock descontado una sola vez').toBe(9);
    const despues = await cuponesDe(idB);
    expect(despues.find((c) => c.origen === 'REFERIDO_BIENVENIDA').estado).toBe('CANJEADO');
    const ventaId = (Array.isArray(exitosas[0].json) ? exitosas[0].json[0] : exitosas[0].json).venta_id;
    const total = Number((Array.isArray(exitosas[0].json) ? exitosas[0].json[0] : exitosas[0].json).total);
    expect(total, 'S/20 con cupón de S/10').toBe(10);

    // La referente recibe exactamente UN cupón de recompensa por el canje.
    const recompensas = (await cuponesDe(idA)).filter((c) => c.origen === 'REFERIDO_RECOMPENSA');
    expect(recompensas).toHaveLength(1);
    expect(Number(recompensas[0].valor)).toBe(15);
    expect(recompensas[0].estado).toBe('DISPONIBLE');
    // Reutilizar el cupón ya canjeado se rechaza
    expect(mensaje(await venta({ p_codigo_cupon: bienvenida[0].codigo, p_cliente_id: idB }))).toContain('Cupón inválido o ya usado');

    // Anular la venta devuelve el cupón de bienvenida y anula la recompensa aún no usada (regla 096).
    expect((await rpc(page, key, 'anular_venta', { p_venta_id: ventaId })).status).toBeLessThan(300);
    expect((await cuponesDe(idB)).find((c) => c.origen === 'REFERIDO_BIENVENIDA').estado).toBe('DISPONIBLE');
    expect((await cuponesDe(idA)).find((c) => c.origen === 'REFERIDO_RECOMPENSA').estado).toBe('ANULADO');
    expect(await stock()).toBe(10);
  } finally {
    await sa.ctx.close(); await sb.ctx.close(); await caja.ctx.close();
  }
});

test('COMISIÓN: ASISTENTE con % asignado a una ficha guarda la comisión y conserva el % aplicado al cambiarlo', async ({ page, browser, data }) => {
  test.setTimeout(240_000);
  await login(page, 'ADMINISTRADOR', data);
  const servicio = { serviceName: `${data.prefix} COMISION ${Date.now().toString(36)}` };
  await createService(page, servicio); // precio S/2
  const asignarPorcentaje = async (valor) => {
    await page.goto('/porcentajes');
    await page.getByPlaceholder('Buscar servicio...').fill(servicio.serviceName);
    await page.getByRole('button').filter({ hasText: servicio.serviceName }).first().click();
    const fila = page.locator('div.bg-surface-2').filter({ hasText: 'asistenteTest01' }).first();
    await fila.getByRole('button', { name: 'Desbloquear' }).click();
    await fila.locator('input').fill(String(valor));
    const guardado = page.waitForResponse((r) => r.url().includes('/rest/v1/porcentajes') && ['POST', 'PATCH'].includes(r.request().method()));
    await fila.getByRole('button', { name: 'Bloquear y guardar' }).click();
    expect((await guardado).ok()).toBeTruthy();
    await expect(page.getByText('Porcentaje guardado.', { exact: true })).toBeVisible();
  };
  const registrar = async (asistente, hora) => {
    await asistente.goto('/mi-panel');
    await visibleButton(asistente, 'Registrar atención').click();
    const form = formWithTitle(asistente, 'Registrar atención');
    await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);
    await form.getByRole('button', { name: data.clientName, exact: true }).click();
    await form.getByPlaceholder('Buscar servicio...').fill(servicio.serviceName);
    await form.getByRole('button', { name: new RegExp(`^${servicio.serviceName}`) }).first().click();
    await form.getByLabel('Fecha y hora', { exact: false }).fill(`${data.today}T${hora}`);
    const insert = asistente.waitForResponse((r) => r.url().includes('/rest/v1/registro_servicios') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await insert).ok()).toBeTruthy();
    await expect(form).toHaveCount(0);
  };

  await asignarPorcentaje('33.33');
  const a = await abrirSesion(browser, data, 'ASISTENTE');
  try {
    await registrar(a.page, '09:10');
    const leer = async () => (await rest(a.page, a.box, 'GET', `/rest/v1/registro_servicios?servicio_id=eq.${servicio.serviceId}&select=precio,porcentaje_aplicado,pago_asistente,estado&order=fecha`)).json;
    let filas = await leer();
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('ACTIVO');
    expect(Number(filas[0].porcentaje_aplicado)).toBe(33.33);
    expect(Number(filas[0].pago_asistente), 'round(2 × 33.33 / 100, 2)').toBe(0.67);

    // Cambiar el % no reescribe la comisión ya registrada; la siguiente usa el nuevo.
    await asignarPorcentaje('100');
    await registrar(a.page, '09:40');
    filas = await leer();
    expect(filas).toHaveLength(2);
    expect(Number(filas[0].pago_asistente)).toBe(0.67);
    expect(Number(filas[1].porcentaje_aplicado)).toBe(100);
    expect(Number(filas[1].pago_asistente)).toBe(2);

    // Límite: 0 % es un valor válido (comisión 0, no «pendiente») y el panel de la ASISTENTE lo refleja.
    await asignarPorcentaje('0');
    await registrar(a.page, '10:10');
    filas = await leer();
    expect(filas[2].estado).toBe('ACTIVO');
    expect(Number(filas[2].pago_asistente)).toBe(0);
    // La ASISTENTE no puede modificar su propio porcentaje por la API (regla de administración).
    const intento = await rest(a.page, a.box, 'PATCH', `/rest/v1/porcentajes?servicio_id=eq.${servicio.serviceId}`, { porcentaje: 100 });
    expect(sinEfecto(intento)).toBeTruthy();
  } finally {
    await a.ctx.close();
  }
});

test('PEDIDO ENTREGADO + ANULACIÓN: comportamiento actual documentado (decisión de negocio pendiente)', async ({ page, browser, data }) => {
  test.setTimeout(360_000);
  const own = await isolatedClient(browser, data, 'ENTR');
  const ctxP = await qaContext(browser);
  let productoId;
  const producto = { productName: `${data.prefix} ENTR Producto`, barcode: `${data.barcode}-ENTR`, initialStock: 10 };
  try {
    const p = await ctxP.newPage();
    await login(p, 'ADMINISTRADOR', data);
    await createProduct(p, producto);
    productoId = producto.productId;
  } finally { await ctxP.close(); }

  const ctx = await qaContext(browser);
  try {
    const cliente = await ctx.newPage();
    await login(cliente, 'CLIENTE', own);
    await cliente.goto(`/productos/${productoId}`);
    await cliente.getByRole('button', { name: /^Agregar al carrito/ }).filter({ visible: true }).first().click();
    await cliente.goto('/carrito');
    await expect(cliente.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
    await cliente.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
    await cliente.getByRole('button', { name: 'Elige el día', exact: true }).click();
    await cliente.getByRole('button', { name: String(Number(data.tomorrow.slice(-2))), exact: true }).filter({ visible: true }).first().click();
    await cliente.getByRole('button', { name: 'Elige la hora', exact: true }).click();
    await cliente.getByRole('button', { name: '11:00', exact: true }).click();
    await cliente.getByRole('button', { name: 'Yape', exact: true }).click();
    await cliente.locator('input[type="file"]').setInputFiles(await testImage(cliente));
    const enviada = cliente.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
    await cliente.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
    expect((await enviada).ok()).toBeTruthy();
  } finally { await ctx.close(); }

  const key = watchApiKey(page);
  await login(page, 'ADMINISTRADOR', data);
  await page.goto('/pedidos-web');
  await page.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
  await page.getByRole('button').filter({ hasText: own.clientName }).click();
  const verificada = page.waitForResponse((r) => r.url().includes('/rpc/verificar_pago_pedido_web'));
  await page.getByRole('button', { name: 'Verificar pago', exact: true }).click();
  const ventaId = await (await verificada).json();
  await page.getByRole('button', { name: 'Marcar entregado', exact: true }).click();
  await expect(page.getByText('Pedido actualizado.', { exact: true })).toBeVisible();
  const pedido = async () => (await rest(page, key, 'GET', `/rest/v1/pedidos_web?venta_id=eq.${ventaId}&select=id,estado,pago_verificado`)).json[0];
  expect((await pedido()).estado).toBe('ENTREGADO');

  // Anular la venta de un pedido ya ENTREGADO (admin, por la interfaz de Historial).
  const venta = (await rest(page, key, 'GET', `/rest/v1/ventas?id=eq.${ventaId}&select=codigo`)).json[0];
  await page.goto('/historial');
  await page.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo);
  await page.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
  await visibleButton(page, 'Anular venta').click();
  await visibleButton(page, 'Sí, anular').click();
  await expect(page.getByText('Venta anulada. Se devolvió el stock.', { exact: true })).toBeVisible();

  // Comportamiento actual (regla de QA-027): el pedido pasa a CANCELADO, el pago sigue marcado como
  // verificado, el stock vuelve y no se puede volver a ENTREGADO. NO se inventa devolución de dinero:
  // si el negocio quiere otro estado (p. ej. DEVUELTO) o un tratamiento distinto, es una decisión pendiente.
  const final = await pedido();
  expect(final.estado).toBe('CANCELADO');
  expect(final.pago_verificado).toBe(true);
  expect((await rest(page, key, 'GET', `/rest/v1/productos_vista?id=eq.${productoId}&select=stock_actual`)).json[0].stock_actual).toBe(10);
  const reentrega = await rest(page, key, 'PATCH', `/rest/v1/pedidos_web?id=eq.${final.id}`, { estado: 'ENTREGADO' });
  expect(reentrega.status).toBeGreaterThanOrEqual(400);
  await page.goto('/pedidos-web');
  await page.getByPlaceholder('Buscar por clienta...').fill(own.clientName);
  await page.getByRole('button').filter({ hasText: own.clientName }).click();
  await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar entregado', exact: true })).toHaveCount(0);

  const ctx2 = await qaContext(browser);
  try {
    const c = await ctx2.newPage();
    await login(c, 'CLIENTE', own);
    await c.goto('/mi-perfil/pedidos');
    await expect(c.getByText('Cancelado', { exact: true })).toBeVisible();
  } finally { await ctx2.close(); }
});
