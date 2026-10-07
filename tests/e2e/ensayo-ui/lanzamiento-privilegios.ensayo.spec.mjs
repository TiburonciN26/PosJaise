// Ensayo de las migraciones 20261008000001 (confirmar_pedido_productos sin anon/service_role) y 20261008000002 (la activación
// de Recompensas queda bloqueada hasta que se ejecute la apertura). Solo la instancia desechable, Recompensas APAGADO.
// Comprueba: privilegios efectivos, pedido con sesión, rechazo sin sesión (sin crear nada), que ADMINISTRADOR no pueda encender el
// programa (ni por la función ni por UPDATE directo) y que la pantalla explique el bloqueo sin ofrecer una acción que termine en
// error. Control positivo: con la apertura marcada como ejecutada (lo que haría la función de apertura) la activación funciona y
// el estado se restaura a apagado. Uso: FRONT_PORT=5274 ESCENARIO=privilegios ENSAYO_PASSWORD=... (ver playwright.lanzamiento.config.mjs)
import { test, expect } from 'playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { R, ESCENARIO, sql, sqlJson, soloRedDelEnsayo, verificarEntorno, sesion, rpc, tabla, mensaje, loginUI } from './lanzamiento-ayuda.mjs';

test.describe.configure({ mode: 'serial' });
const casos = {};
const nota = (k, v) => { casos[k] = v; };
test.afterAll(async () => {
  await mkdir(new URL('../results-ensayo/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../results-ensayo/lanzamiento-${ESCENARIO}.json`, import.meta.url), JSON.stringify(casos, null, 1));
});

const FIRMA = 'public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric)';
const config = () => sqlJson(`select to_json(c) from (select activo, corte, apertura_ejecutada_en from public.recompensas_config where id = 1) c`);
const pedidos = async () => Number(await sql(`select count(*) from public.pedidos_web`));

let adm; let caja; let cli;
test.beforeAll(async ({ request }) => {
  await verificarEntorno(request);
  adm = await sesion(request, R.cuentas.ADMINISTRADOR); caja = await sesion(request, R.cuentas.CAJERA); cli = await sesion(request, R.cuentas.CLIENTE2);
});

test('0. punto de partida: programa apagado, sin corte ni apertura', async () => {
  const c = await config();
  nota('inicio', c);
  expect(c).toEqual({ activo: false, corte: null, apertura_ejecutada_en: null });
});

test('1. privilegios efectivos de confirmar_pedido_productos (15 parámetros)', async () => {
  const q = (rol) => sql(`select has_function_privilege('${rol}', '${FIRMA}', 'execute')`);
  const efectivo = { anon: await q('anon'), authenticated: await q('authenticated'), service_role: await q('service_role'), postgres: await q('postgres') };
  const publico = await sql(`select coalesce(bool_or(a.grantee = 0), false) from pg_proc p left join lateral aclexplode(p.proacl) a on true where p.oid = '${FIRMA}'::regprocedure`);
  nota('privilegios', { ...efectivo, public: publico });
  expect(efectivo).toEqual({ anon: 'f', authenticated: 't', service_role: 'f', postgres: 't' });
  expect(publico).toBe('f');
  // Y recompensas_establecer_activo: sigue solo para authenticated (la autoridad es la función, ver caso 3).
  expect(await sql(`select has_function_privilege('anon', 'public.recompensas_establecer_activo(boolean)', 'execute')`)).toBe('f');
  expect(await sql(`select has_function_privilege('authenticated', 'public.recompensas_establecer_activo(boolean)', 'execute')`)).toBe('t');
});

test('2. pedido CON sesión funciona (firma de 13 parámetros del frontend actual) y SIN sesión se rechaza sin crear nada', async ({ request }) => {
  const [p] = JSON.parse(await sql(`select json_agg(x) from (select id from public.productos where activo and costo > 0 and stock_actual >= 2 order by nombre limit 1) x`));
  const lunes = new Date(); do { lunes.setDate(lunes.getDate() + 1); } while (lunes.getDay() === 0);
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(lunes);
  const args = { p_producto_ids: [p.id], p_tipo_entrega: 'RECOJO_TIENDA', p_fecha_entrega: fecha, p_hora_entrega: '11:00', p_metodo_pago: 'YAPE', p_comprobante_url: 'ensayo/comprobante.jpg', p_zona_delivery_id: null, p_direccion: null, p_celular_entrega: null, p_codigo_cupon: null, p_tipo_comprobante: 'BOLETA', p_ruc: null, p_razon_social: null };
  const antes = await pedidos();
  // Sin sesión: la clave anon (sin usuaria). Debe rechazarse por permiso, antes de entrar a la función.
  const sin = await rpc(request, null, 'confirmar_pedido_productos', args);
  nota('sin_sesion', { status: sin.status, mensaje: mensaje(sin) });
  expect([401, 403, 404], `sin sesión: ${sin.status} ${mensaje(sin)}`).toContain(sin.status);
  expect(await pedidos(), 'sin sesión no crea pedidos').toBe(antes);
  // Con sesión.
  await tabla(request, cli.token, 'carrito_productos', { metodo: 'POST', data: { cliente_web_id: cli.uid, producto_id: p.id, cantidad: 1 } });
  const con = await rpc(request, cli.token, 'confirmar_pedido_productos', args);
  nota('con_sesion', { status: con.status, mensaje: con.status === 200 ? 'ok' : mensaje(con) });
  expect(con.status, mensaje(con)).toBe(200);
  expect(await pedidos()).toBe(antes + 1);
  // Limpieza del pedido de prueba (solo la instancia desechable): se cancela y se devuelve el stock reservado si lo hubo.
  await sql(`update public.pedidos_web set estado = 'CANCELADO' where id = (select id from public.pedidos_web order by creado_en desc limit 1)`);
});

test('3. ADMINISTRADOR no puede encender el programa; CAJERA tampoco; la configuración no cambia', async ({ request }) => {
  const viaAdmin = await rpc(request, adm.token, 'recompensas_establecer_activo', { p_activo: true });
  nota('admin_activar', { status: viaAdmin.status, mensaje: mensaje(viaAdmin) });
  expect(viaAdmin.status).toBeGreaterThanOrEqual(400);
  expect(mensaje(viaAdmin)).toMatch(/primero debe autorizarse y ejecutarse la apertura/);
  const viaCaja = await rpc(request, caja.token, 'recompensas_establecer_activo', { p_activo: true });
  expect(mensaje(viaCaja)).toMatch(/Solo el administrador/);
  // UPDATE directo por la API (activo/corte no tienen UPDATE para authenticated).
  const directo = await tabla(request, adm.token, 'recompensas_config?id=eq.1', { metodo: 'PATCH', data: { activo: true, corte: new Date().toISOString() } });
  nota('admin_update_directo', { status: directo.status });
  expect(directo.status).toBeGreaterThanOrEqual(400);
  const nuevo = await tabla(request, adm.token, 'recompensas_config?id=eq.1', { metodo: 'PATCH', data: { apertura_ejecutada_en: new Date().toISOString() } });
  nota('admin_marcar_apertura', { status: nuevo.status });
  expect(nuevo.status, 'ningún rol de la aplicación puede marcar la apertura').toBeGreaterThanOrEqual(400);
  expect(await config()).toEqual({ activo: false, corte: null, apertura_ejecutada_en: null });
  // Apagar sigue permitido (no-op con el programa apagado) y la tabla sin movimientos.
  const apagar = await rpc(request, adm.token, 'recompensas_establecer_activo', { p_activo: false });
  expect(apagar.status, mensaje(apagar)).toBeLessThan(300);
  expect(await sql(`select (select count(*) from public.recompensas_movimientos) + (select count(*) from public.recompensas_canjes) + (select count(*) from public.recompensas_apertura_aportes)`)).toBe('0');
});

test('4. pantalla de ADMINISTRADOR: explica el bloqueo y no ofrece «Activar programa»', async ({ page, context }) => {
  test.skip(process.env.FRONT_PORT !== '5274', 'solo el frontend de testing contiene el cambio de pantalla');
  await soloRedDelEnsayo(context);
  const http = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1:56321')) http.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`); });
  await loginUI(page, R.cuentas.ADMINISTRADOR);
  await page.goto('/recompensas-web');
  await page.getByRole('tab', { name: 'Programa' }).click();
  await expect(page.getByText('Estado del programa:')).toBeVisible();
  await expect(page.getByText('Apagado', { exact: true })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('La activación está bloqueada hasta que se autorice y se ejecute la apertura');
  await expect(page.getByRole('button', { name: 'Activar programa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apagar programa' })).toHaveCount(0);
  nota('ui_admin', { http });
  expect(http, `respuestas ≥ 400: ${http.join('; ')}`).toEqual([]);
});

test('5. control positivo: con la apertura marcada la activación funciona y se restaura apagado', async ({ request }) => {
  try {
    await sql(`update public.recompensas_config set apertura_ejecutada_en = now() where id = 1`); // lo que hará la función de apertura
    const ok = await rpc(request, adm.token, 'recompensas_establecer_activo', { p_activo: true });
    nota('control_positivo_activar', { status: ok.status });
    expect(ok.status, mensaje(ok)).toBeLessThan(300);
    expect((await config()).activo).toBe(true);
  } finally {
    await sql(`update public.recompensas_config set activo = false, corte = null, apertura_ejecutada_en = null where id = 1`);
  }
  expect(await config()).toEqual({ activo: false, corte: null, apertura_ejecutada_en: null });
});
