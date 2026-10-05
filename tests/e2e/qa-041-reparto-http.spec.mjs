// QA-041 con ventas HTTP REALES: reparto exacto de centavos, líneas excluidas, importes mínimos,
// venta mixta y regla del 50 % por partida. El inicio de sesión es el formulario normal (ADMINISTRADOR QA)
// y las ventas se registran con `confirmar_venta` usando el token de ESA sesión (sin superusuario, sin
// inyectar sesión). Los fixtures (clienta vinculada, productos, atenciones y cupones ficticios «TEST F2»)
// se crean por SQL local; el programa se activa para la prueba y SIEMPRE se restaura.
import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';
import { supabaseURL } from './local-safety.mjs';
import * as h from './recompensas-fase2-helpers.mjs';

test.describe.configure({ mode: 'serial' });

let cfg0;
let apiKey = null;

test.beforeAll(async () => {
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  await h.activar(true);
});
test.afterAll(async () => {
  if (cfg0) await h.restaurarConfig(cfg0);
});

async function sesionAdmin(page) {
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) apiKey = k;
  });
  await login(page, 'ADMINISTRADOR', {});
  await page.goto('/ventas');
  await expect.poll(() => apiKey).not.toBeNull();
}

async function http(page, method, path, body) {
  return page.evaluate(async ({ method, path, body, key, base }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const sesion = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null;
    const r = await fetch(base + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${sesion.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* vacío */ }
    return { status: r.status, json };
  }, { method, path, body, key: apiKey, base: supabaseURL });
}
const vender = (page, items, codigo) =>
  http(page, 'POST', '/rest/v1/rpc/confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: items, p_codigo_cupon: codigo });
const detalle = async (page, ventaId) =>
  (await http(page, 'GET', `/rest/v1/recompensas_venta_detalle?venta_id=eq.${ventaId}&select=linea,tipo,subtotal,descuento,neto&order=linea`)).json;
const monedasDe = async (page, ventaId) =>
  (await http(page, 'GET', `/rest/v1/recompensas_movimientos?venta_id=eq.${ventaId}&tipo=eq.VENTA&select=monedas,clasificacion`)).json[0];
const ventaId = (r) => (Array.isArray(r.json) ? r.json[0] : r.json).venta_id;
const centavos = (n) => Math.round(Number(n) * 100);
const suma = (filas, campo) => filas.reduce((a, f) => a + centavos(f[campo]), 0);
const prod = (id) => ({ tipo: 'PRODUCTO', producto_id: id, cantidad: 1 });
const serv = (id) => ({ tipo: 'SERVICIO', registro_servicio_id: id, cantidad: 1 });

function invariantes(filas, descuentoTotal) {
  for (const f of filas) {
    expect(centavos(f.descuento), `descuento de la línea ${f.linea}`).toBeGreaterThanOrEqual(0);
    expect(centavos(f.descuento), `descuento ≤ base (línea ${f.linea})`).toBeLessThanOrEqual(centavos(f.subtotal));
    expect(centavos(f.neto), `neto ≥ 0 (línea ${f.linea})`).toBeGreaterThanOrEqual(0);
    expect(centavos(f.neto), `neto ≤ base: nunca sube (línea ${f.linea})`).toBeLessThanOrEqual(centavos(f.subtotal));
    expect(centavos(f.neto)).toBe(centavos(f.subtotal) - centavos(f.descuento));
  }
  expect(suma(filas, 'descuento'), 'la suma de descuentos es exacta').toBe(centavos(descuentoTotal));
}

test('QA-041: cuatro productos de S/1 con cupón S/0,02 → [0,01; 0,01; 0; 0], sin descuentos negativos', async ({ page }) => {
  await sesionAdmin(page);
  const c = await h.nuevaClienta();
  const ps = await Promise.all([1, 2, 3, 4].map(() => h.nuevoProducto(1)));
  const cup = await h.nuevoCupon(c.clienteId, { valor: 0.02 });
  const r = await vender(page, ps.map(prod), cup.codigo);
  expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
  const filas = await detalle(page, ventaId(r));
  invariantes(filas, 0.02);
  expect(filas.map((f) => Number(f.descuento))).toEqual([0.01, 0.01, 0, 0]);
  expect(Number((Array.isArray(r.json) ? r.json[0] : r.json).total)).toBeCloseTo(3.98, 8);
  const m = await monedasDe(page, ventaId(r));
  expect(Number(m.monedas)).toBeCloseTo((3.98 * 5) / 40, 8); // productos 5/S40 sobre el neto
  expect(Number(m.clasificacion)).toBeCloseTo(Number(m.monedas), 8);
});

test('QA-041: importes mínimos — cinco bases de S/0,01 con S/0,03 y tres líneas con S/0,01', async ({ page }) => {
  await sesionAdmin(page);
  const c = await h.nuevaClienta();
  const cinco = await Promise.all([1, 2, 3, 4, 5].map(() => h.nuevoProducto(0.01)));
  const cupA = await h.nuevoCupon(c.clienteId, { valor: 0.03 });
  const rA = await vender(page, cinco.map(prod), cupA.codigo);
  expect(rA.status, JSON.stringify(rA.json)).toBeLessThan(300);
  const fA = await detalle(page, ventaId(rA));
  invariantes(fA, 0.03);
  expect(fA.map((f) => Number(f.descuento))).toEqual([0.01, 0.01, 0.01, 0, 0]);

  const tres = await Promise.all([1, 2, 3].map(() => h.nuevoProducto(0.05)));
  const cupB = await h.nuevoCupon(c.clienteId, { valor: 0.01 });
  const rB = await vender(page, tres.map(prod), cupB.codigo);
  expect(rB.status, JSON.stringify(rB.json)).toBeLessThan(300);
  invariantes(await detalle(page, ventaId(rB)), 0.01);
});

test('QA-041: bases desiguales y línea excluida por alcance — el servicio no recibe descuento y las monedas usan el neto por tipo', async ({ page }) => {
  await sesionAdmin(page);
  const c = await h.nuevaClienta();
  const s = await h.nuevoServicio(10, { materiales: 0 });
  const at = await h.nuevaAtencion(c.clienteId, s, 10);
  const ps = [await h.nuevoProducto(3), await h.nuevoProducto(7.77), await h.nuevoProducto(1.11)];
  const cup = await h.nuevoCupon(c.clienteId, { valor: 1.01, alcance: 'PRODUCTOS' });
  const r = await vender(page, [serv(at), ...ps.map(prod)], cup.codigo);
  expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
  const filas = await detalle(page, ventaId(r));
  invariantes(filas, 1.01);
  expect(Number(filas[0].descuento), 'el servicio quedó fuera por alcance').toBe(0);
  const netoProd = filas.slice(1).reduce((a, f) => a + Number(f.neto), 0);
  const m = await monedasDe(page, ventaId(r));
  expect(Number(m.monedas)).toBeCloseTo((10 * 5) / 20 + (netoProd * 5) / 40, 8); // servicio 5/S20 + productos 5/S40
});

test('QA-041: venta mixta con la regla del 50 % por partida — rechazo sin consumir el cupón ni escribir nada', async ({ page }) => {
  await sesionAdmin(page);
  const c = await h.nuevaClienta();
  const s = await h.nuevoServicio(10); // sin protección: máximo S/5
  const at = await h.nuevaAtencion(c.clienteId, s, 10);
  const p = await h.nuevoProducto(20, 6);

  const ventasAntes = (await http(page, 'GET', '/rest/v1/ventas?select=id')).json.length;
  const grande = await h.nuevoCupon(c.clienteId, { valor: 16 }); // reparto 5,33 / 10,67 → el servicio excede su 50 %
  const rechazo = await vender(page, [serv(at), prod(p)], grande.codigo);
  expect(rechazo.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(rechazo.json)).toContain('sin protección configurada');
  expect(JSON.stringify(rechazo.json)).toContain('50 %');
  expect((await h.estadoCupon(grande.id)).estado).toBe('DISPONIBLE');
  expect(await h.stock(p)).toBe(6);
  expect((await http(page, 'GET', '/rest/v1/ventas?select=id')).json.length, 'no se creó ninguna venta').toBe(ventasAntes);
  expect(await h.json(`select to_json(venta_id is null) from public.registro_servicios where id='${at}'`)).toBe(true);

  const justo = await h.nuevoCupon(c.clienteId, { valor: 15 }); // 5 / 10 → cabe
  const ok = await vender(page, [serv(at), prod(p)], justo.codigo);
  expect(ok.status, JSON.stringify(ok.json)).toBeLessThan(300);
  const filas = await detalle(page, ventaId(ok));
  invariantes(filas, 15);
  expect(centavos(filas[0].descuento)).toBeLessThanOrEqual(500);
});

test('QA-041: servicio protegido — manda el piso (S/30, piso S/10: S/20 sí, S/20,01 no)', async ({ page }) => {
  await sesionAdmin(page);
  const c = await h.nuevaClienta();
  const s = await h.nuevoServicio(30, { materiales: 5, asistente: 5 });
  const at = await h.nuevaAtencion(c.clienteId, s, 30);
  const sobra = await h.nuevoCupon(c.clienteId, { valor: 20.01 });
  const r1 = await vender(page, [serv(at)], sobra.codigo);
  expect(r1.status).toBeGreaterThanOrEqual(400);
  // Mensaje de la regla global del carrito (protección económica de cupones); el resultado (rechazo con S/20,01) no cambia.
  expect(JSON.stringify(r1.json)).toContain('supera el descuento permitido para esta compra');
  expect((await h.estadoCupon(sobra.id)).estado).toBe('DISPONIBLE');
  const justo = await h.nuevoCupon(c.clienteId, { valor: 20 });
  const r2 = await vender(page, [serv(at)], justo.codigo);
  expect(r2.status, JSON.stringify(r2.json)).toBeLessThan(300);
  invariantes(await detalle(page, ventaId(r2)), 20);
});
