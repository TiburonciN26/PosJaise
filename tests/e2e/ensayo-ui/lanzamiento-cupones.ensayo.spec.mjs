// Ensayo de LANZAMIENTO — cupones EXISTENTES frente a las protecciones nuevas, con Recompensas APAGADO (instancia desechable).
// Los cupones y los datos reproducen la FORMA de producción (3 cupones, 270 productos con 5 de costo 0, 33 servicios de S/10 a S/350,
// ningún servicio con protección configurada). Todo por la API real con sesión de CAJERA/ADMINISTRADOR (misma forma de llamada que el
// frontend de main). Cada venta de prueba se anula y el cupón vuelve a DISPONIBLE. Los resultados quedan en results-ensayo/.
import { test, expect } from 'playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { R, ESCENARIO, sql, sqlJson, verificarEntorno, sesion, rpc, mensaje } from './lanzamiento-ayuda.mjs';

test.describe.configure({ mode: 'serial' });
const casos = {};
test.afterAll(async () => {
  await mkdir(new URL('../results-ensayo/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../results-ensayo/lanzamiento-cupones-${ESCENARIO}.json`, import.meta.url), JSON.stringify(casos, null, 1));
});

let caja; let adm; let c1; let c2; let asistenteUid; const atenciones = {};
test.beforeAll(async ({ request }) => {
  await verificarEntorno(request);
  caja = await sesion(request, R.cuentas.CAJERA); adm = await sesion(request, R.cuentas.ADMINISTRADOR);
  const cl = (n) => sqlJson(`select to_json(c) from (select id from public.clientes where cliente_web_id = '${R.ids[n]}') c`);
  c1 = await cl('CLIENTE1'); c2 = await cl('CLIENTE2'); asistenteUid = R.ids.ASISTENTE;
  // Atenciones por cobrar (una por servicio de prueba) con la cliente 2: precios de catálogo.
  await sql(`insert into public.porcentajes (servicio_id, asistente_id, porcentaje) select s.id, a.id, 40 from public.servicios s, public.asistentes a where a.usuario_id = '${asistenteUid}' and s.nombre in ('Servicio ficticio 1','Servicio ficticio 33') on conflict do nothing`);
  for (const n of [1, 2, 3, 4, 33]) {
    const s = await sqlJson(`select to_json(s) from (select id, precio from public.servicios where nombre='Servicio ficticio ${n}') s`);
    const id = await sql(`insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio) values ('${asistenteUid}','${s.id}','${c2.id}',${s.precio}) returning id`).then((o) => o.split('\n')[0]);
    atenciones[n] = { id, precio: Number(s.precio) };
  }
});
test.afterAll(async () => {
  await sql(`delete from public.registro_servicios where usuario_id = '${asistenteUid}' and venta_id is null and nota is null`).catch(() => {});
});

const prod = (nombre) => sqlJson(`select to_json(p) from (select id, nombre, precio, costo from public.productos where nombre='${nombre}') p`);
const itemProd = (p, cantidad = 1) => ({ tipo: 'PRODUCTO', producto_id: p.id, registro_servicio_id: null, nombre: p.nombre, cantidad });
const itemSrv = (n) => ({ tipo: 'SERVICIO', producto_id: null, registro_servicio_id: atenciones[n].id, nombre: `Servicio ficticio ${n}`, cantidad: 1 });
async function vender(request, items, { cupon = null, cliente = c2, descPct = 0 } = {}) {
  const r = await rpc(request, caja.token, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: items, p_cliente_id: cliente.id, p_descuento_pct: descPct, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: cupon });
  if (r.status !== 200) return { ok: false, mensaje: mensaje(r) };
  const v = Array.isArray(r.cuerpo) ? r.cuerpo[0] : r.cuerpo;
  await rpc(request, adm.token, 'anular_venta', { p_venta_id: v.venta_id ?? v.id });
  return { ok: true, total: v.total };
}
const registrar = (clave, valor) => { casos[clave] = valor; return valor; };

test('A. Producto de costo 0 sin confirmar + cupón de bienvenida S/10 → el cupón se bloquea (costo desconocido)', async ({ request }) => {
  const p = await prod('Producto ficticio 266');
  const r = registrar('A_producto_costo0_con_cupon', await vender(request, [itemProd(p)], { cupon: 'ENSBIE001' }));
  expect(p.costo).toBe(0);
  expect(r.ok, 'el cupón no debe aplicarse sobre un costo desconocido').toBe(false);
  expect(r.mensaje).toMatch(/costo/i);
});
test('A2. El mismo producto de costo 0 SIN cupón y con descuento manual del 10 % no cambia', async ({ request }) => {
  const p = await prod('Producto ficticio 266');
  const sin = registrar('A2_costo0_sin_cupon', await vender(request, [itemProd(p)]));
  const manual = registrar('A2_costo0_descuento_manual_10pct', await vender(request, [itemProd(p)], { descPct: 10 }));
  expect(sin.ok).toBe(true); expect(manual.ok).toBe(true);
});
test('B. Servicio de S/10 + cupón de bienvenida S/10 → rechazado (supera el 50 % del precio); S/28 + S/10 → permitido', async ({ request }) => {
  const caro = registrar('B_servicio_10_con_cupon_10', await vender(request, [itemSrv(1)], { cupon: 'ENSBIE001' }));
  const medio = registrar('B_servicio_28_con_cupon_10', await vender(request, [itemSrv(2)], { cupon: 'ENSBIE001' }));
  expect(caro.ok, 'S/10 con cupón de S/10 supera el 50 %').toBe(false);
  expect(medio.ok, `S/${atenciones[2].precio} con cupón de S/10: ${medio.mensaje ?? ''}`).toBe(true);
});
test('C. Servicio de S/350 + cupón de fidelización 20 % → permitido (70 ≤ 175)', async ({ request }) => {
  const r = registrar('C_servicio_350_con_cupon_20pct', await vender(request, [itemSrv(33)], { cupon: 'ENSFID001', cliente: c1 }));
  expect(r.ok, r.mensaje ?? '').toBe(true);
});
test('D. Carrito mixto (producto normal + servicio de S/10) con cupón S/10: regla global del carrito', async ({ request }) => {
  const p = await prod('Producto ficticio 130');
  const r = registrar('D_mixto_producto_15_servicio_10_cupon_10', await vender(request, [itemProd(p), itemSrv(1)], { cupon: 'ENSBIE001' }));
  test.info().annotations.push({ type: 'resultado', description: JSON.stringify(r) });
});
test('E. Los cupones siguen DISPONIBLES tras anular las ventas de prueba y no se creó ningún movimiento de monedas', async ({ request }) => {
  const est = await sql(`select string_agg(codigo||'='||estado, ',' order by codigo) from public.cupones`);
  registrar('E_estado_de_cupones', est);
  expect(est).toContain('ENSBIE001=DISPONIBLE'); expect(est).toContain('ENSFID001=DISPONIBLE');
  expect(await sql(`select count(*) from public.recompensas_movimientos`)).toBe('0');
  expect(await sql(`select activo::text from public.recompensas_config`)).toBe('false');
});
