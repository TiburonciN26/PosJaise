// Ensayo de LANZAMIENTO: compatibilidad entre el frontend (main = el publicado hoy, testing = el nuevo) y el backend de la
// instancia desechable en dos momentos (ANTES y DESPUÉS de aplicar las 21 migraciones), con Recompensas APAGADO.
//   ESCENARIO = main-pre | main-post | testing-pre | testing-post    FRONT_PORT = 5273 (main) | 5274 (testing)
//   MODO = exigir (por omisión) | registrar (anota los hallazgos de humo sin fallar; para testing-pre, que se espera roto)
// Sesiones reales por el login normal; ninguna cuenta ni dato real de producción. Cada caso conserva sus hallazgos.
import { test, expect } from 'playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { R, FRENTE, ESCENARIO, MODO, ORIGEN_APP, estadoPrograma, sql, sqlJson, soloRedDelEnsayo, verificarEntorno, sesion, rpc, tabla, mensaje, loginUI } from './lanzamiento-ayuda.mjs';

test.describe.configure({ mode: 'serial' });
const hallazgos = { escenario: ESCENARIO, frente: FRENTE, humo: {}, casos: {} };
const nota = (clave, valor) => { hallazgos.casos[clave] = valor; };
test.afterAll(async () => {
  await mkdir(new URL('../results-ensayo/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../results-ensayo/lanzamiento-${ESCENARIO}.json`, import.meta.url), JSON.stringify(hallazgos, null, 1));
});

const rutasPos = async () => {
  const txt = await readFile(`C:/JaiseQA-Ensayo-front/${FRENTE}/src/config/navegacion.js`, 'utf8');
  return [...new Set([...txt.matchAll(/path:\s*'(\/[a-z0-9-]+)'/g)].map((m) => m[1]).filter((p) => p !== '/web'))];
};
const rutasCliente = FRENTE === 'testing'
  ? ['/inicio', '/servicios', '/productos', '/citas', '/nosotros', '/recompensas', '/mi-perfil', '/mi-perfil/pedidos', '/mi-perfil/referidos', '/mis-puntos', '/fidelizacion', '/ofertas', '/mis-resenas', '/carrito', '/citas/carrito']
  : ['/inicio', '/servicios', '/productos', '/citas', '/nosotros', '/mi-perfil', '/mi-perfil/pedidos', '/mi-perfil/referidos', '/mis-puntos', '/fidelizacion', '/ofertas', '/mis-resenas', '/carrito', '/citas/carrito'];

async function recorrer(page, rutas) {
  const salida = { rutas: rutas.length, http: [], pageerrors: [], consola: [] };
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1:56321')) { const u = new URL(r.url()); salida.http.push(`${r.request().method()} ${u.pathname}${u.search.slice(0, 60)} → ${r.status()}`); } });
  page.on('pageerror', (e) => salida.pageerrors.push(e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') salida.consola.push(m.text().slice(0, 160)); });
  for (const ruta of rutas) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  salida.http = [...new Set(salida.http)];
  salida.consola = [...new Set(salida.consola)].filter((t) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|fonts\.(googleapis|gstatic)/.test(t));
  return salida;
}
const limpio = (s) => s.http.length === 0 && s.pageerrors.length === 0 && s.consola.length === 0;

test('0. Entorno: el frontend sirve la URL del ensayo y Auth/REST/SQL usan la misma base', async ({ request }) => {
  const bases = await verificarEntorno(request);
  expect(bases).toEqual({ auth: 'postgres', rest: 'postgres', sql: 'postgres' });
  nota('migraciones_registradas_en_la_base', await sql(`select count(*) from supabase_migrations.schema_migrations`));
  nota('guardar_cita_pos_existe', await sql(`select to_regprocedure('public.guardar_cita_pos(uuid,uuid,text,uuid,timestamptz,text,numeric,jsonb)') is not null`));
  nota('programa_recompensas', await estadoPrograma());
});

for (const [rol, email] of [['ADMINISTRADOR', R.cuentas.ADMINISTRADOR], ['CAJERA', R.cuentas.CAJERA], ['ASISTENTE', R.cuentas.ASISTENTE], ['CLIENTE1', R.cuentas.CLIENTE1]]) {
  test(`1. Humo ${rol}: cada pantalla carga sin errores de página ni respuestas ≥ 400`, async ({ page, context }) => {
    await soloRedDelEnsayo(context);
    await loginUI(page, email);
    const rutas = rol.startsWith('CLIENTE') ? rutasCliente : await rutasPos();
    const s = await recorrer(page, rutas);
    hallazgos.humo[rol] = s;
    if (MODO === 'exigir') expect(s, `${rol}: hallazgos de humo`).toMatchObject({ http: [], pageerrors: [], consola: [] });
    else test.info().annotations.push({ type: 'hallazgos', description: `${rol}: ${s.http.length} http≥400, ${s.pageerrors.length} pageerror, ${s.consola.length} consola` });
  });
}

test('2. Caja por UI: vender un producto, ver el stock bajar, anularlo y ver el stock volver', async ({ page, context }) => {
  await soloRedDelEnsayo(context);
  const nombre = 'Producto ficticio 120';
  const antes = Number(await sql(`select stock_actual from public.productos where nombre='${nombre}'`));
  await loginUI(page, R.cuentas.CAJERA);
  await page.goto('/ventas');
  await page.getByRole('searchbox').first().fill(nombre);
  await page.getByRole('button', { name: new RegExp(nombre) }).first().click();
  await page.getByRole('button', { name: 'Yape', exact: true }).click();
  const respuesta = page.waitForResponse((r) => r.url().includes('/rpc/confirmar_venta'));
  await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  const r = await respuesta;
  expect(r.ok(), 'confirmar_venta responde 200').toBeTruthy();
  const venta = (await r.json()); const v = Array.isArray(venta) ? venta[0] : venta;
  nota('venta_codigo', v.codigo);
  expect(Number(await sql(`select stock_actual from public.productos where nombre='${nombre}'`))).toBe(antes - 1);
  await page.reload();
  await page.goto('/historial');
  await page.getByPlaceholder('Buscar por código o cliente...').fill(v.codigo);
  await page.getByText(v.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Anular venta', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Sí, anular', exact: true }).filter({ visible: true }).click();
  await expect.poll(() => sql(`select estado from public.ventas where codigo='${v.codigo}'`)).toBe('ANULADA');
  expect(Number(await sql(`select stock_actual from public.productos where nombre='${nombre}'`))).toBe(antes);
});

test('3. Cupones existentes con Recompensas apagado: bienvenida S/10 y fidelización 20 % en una venta de producto', async ({ request }) => {
  const caja = await sesion(request, R.cuentas.CAJERA);
  const admin = await sesion(request, R.cuentas.ADMINISTRADOR);
  const prod = await sqlJson(`select to_json(p) from (select id, nombre, precio, costo from public.productos where nombre = 'Producto ficticio 130') p`);
  const cl = (n) => sqlJson(`select to_json(c) from (select id from public.clientes where cliente_web_id = (select id from auth.users where email = '${R.cuentas[n]}')) c`);
  const c2 = await cl('CLIENTE2'); const c1 = await cl('CLIENTE1');
  const items = [{ tipo: 'PRODUCTO', producto_id: prod.id, registro_servicio_id: null, nombre: prod.nombre, cantidad: 2 }]; // forma exacta del frontend de main
  const resultados = {};
  for (const [codigo, cliente] of [['ENSBIE001', c2], ['ENSFID001', c1]]) {
    const r = await rpc(request, caja.token, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: items, p_cliente_id: cliente.id, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: codigo });
    resultados[codigo] = { status: r.status, mensaje: r.status === 200 ? 'ok' : mensaje(r), total: r.status === 200 ? (Array.isArray(r.cuerpo) ? r.cuerpo[0] : r.cuerpo)?.total : null };
    if (r.status === 200) { const v = Array.isArray(r.cuerpo) ? r.cuerpo[0] : r.cuerpo; await rpc(request, admin.token, 'anular_venta', { p_venta_id: v.venta_id ?? v.id }); }
  }
  nota('cupones_en_caja', { producto_precio: prod.precio, producto_costo: prod.costo, resultados });
  // ANTES de la actualización el cupón en Caja falla en la base de producción (QA-005/QA-019: «column reference … is ambiguous»,
  // defecto existente que corrige la migración 20261002000003): se anota sin hacer fallar el caso. DESPUÉS debe funcionar.
  if (ESCENARIO.endsWith('-pre')) { test.info().annotations.push({ type: 'defecto-existente', description: JSON.stringify(resultados) }); return; }
  for (const [codigo, r] of Object.entries(resultados)) expect(r.status, `${codigo}: ${r.mensaje}`).toBe(200);
});

test('4. Stock: agregar_stock como CAJERA y sin permiso como ASISTENTE', async ({ request }) => {
  const caja = await sesion(request, R.cuentas.CAJERA); const asist = await sesion(request, R.cuentas.ASISTENTE);
  const p = await sqlJson(`select to_json(p) from (select id, stock_actual from public.productos where nombre='Producto ficticio 140') p`);
  const ok = await rpc(request, caja.token, 'agregar_stock', { p_producto_id: p.id, p_cantidad: 2, p_nota: 'ensayo' });
  nota('agregar_stock_cajera', ok.status);
  expect(ok.status).toBe(200);
  expect(Number(await sql(`select stock_actual from public.productos where id='${p.id}'`))).toBe(p.stock_actual + 2);
  const no = await rpc(request, asist.token, 'agregar_stock', { p_producto_id: p.id, p_cantidad: 1, p_nota: 'ensayo' });
  nota('agregar_stock_asistente', { status: no.status, mensaje: no.status === 200 ? 'PERMITIDO' : mensaje(no) });
  if (ESCENARIO.endsWith('-post')) expect(no.status, 'QA-035: la asistente no agrega stock').not.toBe(200);
  await sql(`update public.productos set stock_actual = ${p.stock_actual} where id='${p.id}'`); // restaura el dato del ensayo
});

test('5. Roles de ventas: la ASISTENTE no vende (regla QA-033) y la CLIENTA tampoco', async ({ request }) => {
  const asist = await sesion(request, R.cuentas.ASISTENTE); const cli = await sesion(request, R.cuentas.CLIENTE1);
  const p = await sqlJson(`select to_json(p) from (select id, nombre from public.productos where nombre='Producto ficticio 150') p`);
  const venta = (t) => rpc(request, t, 'confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'PRODUCTO', producto_id: p.id, registro_servicio_id: null, nombre: p.nombre, cantidad: 1 }], p_cliente_id: null, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: null });
  const a = await venta(asist.token); const c = await venta(cli.token);
  nota('venta_asistente', { status: a.status, mensaje: a.status === 200 ? 'PERMITIDA' : mensaje(a) });
  nota('venta_clienta', { status: c.status, mensaje: c.status === 200 ? 'PERMITIDA' : mensaje(c) });
  expect(c.status, 'la clienta no vende').not.toBe(200);
  if (a.status === 200) { const v = Array.isArray(a.cuerpo) ? a.cuerpo[0] : a.cuerpo; const adm = await sesion(request, R.cuentas.ADMINISTRADOR); await rpc(request, adm.token, 'anular_venta', { p_venta_id: v.venta_id ?? v.id }); }
  if (ESCENARIO.endsWith('-post')) expect(a.status, 'QA-033: la asistente no vende').not.toBe(200);
});

test('6. Citas: guardado en 3 pasos del frontend de main y completar la cita', async ({ request }) => {
  const adm = await sesion(request, R.cuentas.ADMINISTRADOR);
  const ids = await sqlJson(`select json_build_object('cli', (select id from public.clientes order by nombre limit 1 offset 10), 'asi', (select id from public.asistentes where usuario_id is not null limit 1), 'srv', (select id from public.servicios where nombre='Servicio ficticio 3'))`);
  const fecha = new Date(Date.now() + 5 * 864e5).toISOString();
  const crear = await tabla(request, adm.token, 'citas?select=*', { metodo: 'POST', data: { cliente_id: ids.cli, asistente_id: ids.asi, fecha_hora: fecha, nota: 'ensayo lanzamiento', creado_por: R.ids.ADMINISTRADOR } });
  expect(crear.status, `insert citas: ${JSON.stringify(crear.cuerpo).slice(0, 120)}`).toBe(201);
  const citaId = crear.cuerpo[0].id;
  const lin = await tabla(request, adm.token, 'cita_servicios', { metodo: 'POST', data: [{ cita_id: citaId, servicio_id: ids.srv, duracion_min: 45, precio: 59 }] });
  expect(lin.status, 'insert cita_servicios').toBe(201);
  const upd = await tabla(request, adm.token, `citas?id=eq.${citaId}`, { metodo: 'PATCH', data: { nota: 'ensayo editada' } });
  expect(upd.status).toBe(200);
  const del = await tabla(request, adm.token, `cita_servicios?cita_id=eq.${citaId}`, { metodo: 'DELETE' });
  expect([200, 204]).toContain(del.status);
  const lin2 = await tabla(request, adm.token, 'cita_servicios', { metodo: 'POST', data: [{ cita_id: citaId, servicio_id: ids.srv, duracion_min: 45, precio: 59 }] });
  expect(lin2.status).toBe(201);
  nota('cita_tres_pasos', 'ok');
  const asist = await sesion(request, R.cuentas.ASISTENTE);
  const csId = await sql(`select id from public.cita_servicios where cita_id='${citaId}' limit 1`);
  // forma exacta del frontend de main (ModalRegistroAtencion): items por cita_servicio_id; la completa la persona asignada
  const comp = await rpc(request, asist.token, 'completar_cita', { p_cita_id: citaId, p_items: [{ cita_servicio_id: csId, precio: 59 }], p_cliente_id: ids.cli, p_fecha: fecha, p_nota: null });
  nota('completar_cita', { status: comp.status, mensaje: comp.status === 200 ? 'ok' : mensaje(comp) });
  expect(comp.status, mensaje(comp)).toBe(200);
  // limpieza del dato del ensayo
  await sql(`delete from public.registro_servicios where id in (select registro_servicio_id from public.cita_servicios where cita_id='${citaId}'); delete from public.cita_servicios where cita_id='${citaId}'; delete from public.citas where id='${citaId}'`);
});

test('7. Citas: guardar_cita_pos (frontend nuevo) existe y es atómica', async ({ request }) => {
  const existe = (await sql(`select to_regprocedure('public.guardar_cita_pos(uuid,uuid,text,uuid,timestamptz,text,numeric,jsonb)') is not null`)) === 't';
  nota('guardar_cita_pos_disponible', existe);
  test.skip(!existe, 'guardar_cita_pos no existe en este momento del backend (esperado ANTES de la actualización)');
  const adm = await sesion(request, R.cuentas.ADMINISTRADOR);
  const ids = await sqlJson(`select json_build_object('cli', (select id from public.clientes order by nombre limit 1 offset 12), 'asi', (select id from public.asistentes where usuario_id is not null limit 1), 'srv', (select id from public.servicios where nombre='Servicio ficticio 6'))`);
  const r = await rpc(request, adm.token, 'guardar_cita_pos', { p_cita_id: null, p_cliente_id: ids.cli, p_cliente_nombre_referencia: null, p_asistente_id: ids.asi, p_fecha_hora: new Date(Date.now() + 6 * 864e5).toISOString(), p_nota: 'ensayo', p_adelanto: null, p_servicios: [{ servicio_id: ids.srv, duracion_min: 30, precio: 69 }] });
  nota('guardar_cita_pos', { status: r.status, cuerpo: r.status === 200 ? 'ok' : mensaje(r) });
  expect(r.status).toBe(200);
  const id = typeof r.cuerpo === 'string' ? r.cuerpo : (r.cuerpo?.id ?? r.cuerpo?.[0]?.id ?? r.cuerpo);
  await sql(`delete from public.cita_servicios where cita_id='${id}'; delete from public.citas where id='${id}'`);
});

test('8. Pedido web con la firma de 13 parámetros del frontend de main y verificación del pago por el administrador', async ({ request }) => {
  const cli = await sesion(request, R.cuentas.CLIENTE2); const adm = await sesion(request, R.cuentas.ADMINISTRADOR);
  const p = await sqlJson(`select to_json(p) from (select id, nombre, precio, stock_actual from public.productos where nombre='Producto ficticio 160') p`);
  const lunes = new Date(); do { lunes.setDate(lunes.getDate() + 1); } while (lunes.getDay() === 0);
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(lunes);
  await tabla(request, cli.token, 'carrito_productos', { metodo: 'POST', data: { cliente_web_id: cli.uid, producto_id: p.id, cantidad: 1 } });
  const r = await rpc(request, cli.token, 'confirmar_pedido_productos', {
    p_producto_ids: [p.id], p_tipo_entrega: 'RECOJO_TIENDA', p_fecha_entrega: fecha, p_hora_entrega: '11:00', p_metodo_pago: 'YAPE', p_comprobante_url: 'ensayo/comprobante.jpg',
    p_zona_delivery_id: null, p_direccion: null, p_celular_entrega: null, p_codigo_cupon: null, p_tipo_comprobante: 'BOLETA', p_ruc: null, p_razon_social: null });
  nota('pedido_firma_13_parametros', { status: r.status, mensaje: r.status === 200 ? 'ok' : mensaje(r) });
  expect(r.status, mensaje(r)).toBe(200);
  const ped = await sqlJson(`select to_json(x) from (select id, total, estado from public.pedidos_web where cliente_id = (select id from public.clientes where cliente_web_id='${cli.uid}') order by creado_en desc limit 1) x`);
  const v = await rpc(request, adm.token, 'verificar_pago_pedido_web', { p_pedido_id: ped.id });
  nota('verificar_pago_pedido_web', { status: v.status, mensaje: v.status === 200 ? 'ok' : mensaje(v) });
  // ANTES de la actualización «Verificar pago» falla en la base de producción (QA-009: el pedido guarda 'YAPE' y la venta exige
  // 'Yape'; lo corrige la migración 20261002000003): se anota sin hacer fallar el caso. DESPUÉS debe funcionar.
  if (ESCENARIO.endsWith('-pre') && v.status !== 200) {
    test.info().annotations.push({ type: 'defecto-existente', description: `verificar_pago_pedido_web: ${mensaje(v)}` });
    await sql(`update public.pedidos_web set estado='CANCELADO' where id='${ped.id}'`);
    return;
  }
  expect(v.status, mensaje(v)).toBe(200);
  const ventaId = await sql(`select venta_id from public.pedidos_web where id='${ped.id}'`);
  const an = await rpc(request, adm.token, 'anular_venta', { p_venta_id: ventaId });
  nota('anular_venta_de_pedido', { status: an.status, pedido_tras_anular: await sql(`select estado from public.pedidos_web where id='${ped.id}'`) });
  expect([200, 204]).toContain(an.status); // anular_venta devuelve void (204)
});

test('9. Finanzas: resumen_dashboard conserva sus columnas antiguas (y añade envio_cobrado después)', async ({ request }) => {
  const adm = await sesion(request, R.cuentas.ADMINISTRADOR);
  const r = await rpc(request, adm.token, 'resumen_dashboard', { p_desde: '2020-01-01T00:00:00Z', p_hasta: '2030-01-01T00:00:00Z' });
  expect(r.status).toBe(200);
  const fila = Array.isArray(r.cuerpo) ? r.cuerpo[0] : r.cuerpo;
  nota('resumen_dashboard_columnas', Object.keys(fila).sort());
  for (const c of ['ingreso_productos', 'ingreso_servicios', 'costo_productos', 'comisiones_pagadas', 'descuentos', 'productos_vendidos', 'servicios_realizados', 'cantidad_ventas']) expect(Object.keys(fila), `columna antigua ${c}`).toContain(c);
});

test('10. Programa nuevo apagado: portal de la clienta sin movimientos de monedas y sin activar nada', async ({ request }) => {
  const cli = await sesion(request, R.cuentas.CLIENTE1);
  const out = {};
  for (const fn of ['mis_puntos', 'mi_fidelizacion', 'mis_cupones']) { const r = await rpc(request, cli.token, fn); out[fn] = { status: r.status, filas: Array.isArray(r.cuerpo) ? r.cuerpo.length : 1 }; expect(r.status, fn).toBe(200); }
  nota('lecturas_portal', out);
  const prog = await estadoPrograma();
  nota('programa_recompensas', prog);
  if (prog.tabla) {
    expect(prog.activo, 'Recompensas sigue apagado').toBe(false);
    expect(prog.corteNulo, 'corte = null').toBe(true);
    expect(prog.movimientos, 'sin movimientos de monedas').toBe(0);
  }
});
