// Ayudas del ensayo de LANZAMIENTO (compatibilidad frontend/backend). Todo opera contra la instancia desechable «JaiseEnsayo»
// y contra uno de los dos Vite del ensayo (FRONT_PORT: 5273 = frontend de main, 5274 = frontend de testing). SQL pasa por
// ensayo-destino.mjs, que rechaza cualquier destino que no sea el ensayo. Sin contraseñas ni claves en el código: ENSAYO_PASSWORD
// llega por el entorno del proceso y las claves del ensayo se leen del CLI en memoria.
import { readFileSync } from 'node:fs';
import { expect } from 'playwright/test';
import { ejecutarEnsayo, clavesDelEnsayo, supabaseURL, verificarMismaBase } from '../ensayo-destino.mjs';

export const R = JSON.parse(readFileSync(new URL('../fixtures/ensayo-lanzamiento-runtime.json', import.meta.url), 'utf8'));
export const PW = process.env.ENSAYO_PASSWORD;
export const PUERTO = process.env.FRONT_PORT ?? '5273';
export const FRENTE = process.env.FRONT_LABEL ?? (PUERTO === '5273' ? 'main' : 'testing');
export const ESCENARIO = process.env.ESCENARIO ?? `${FRENTE}-?`;
export const MODO = process.env.MODO ?? 'exigir'; // 'registrar' no falla por los hallazgos de humo; los anota
export const ORIGEN_APP = `http://localhost:${PUERTO}`;
const claves = clavesDelEnsayo();
export const ANON = claves.anon;
export { supabaseURL };

if (!PW) throw new Error('Falta ENSAYO_PASSWORD en el entorno del proceso.');
if (!['5273', '5274'].includes(PUERTO)) throw new Error('FRONT_PORT debe ser 5273 (main) o 5274 (testing) del ensayo.');
if (!supabaseURL.startsWith('http://127.0.0.1:56321')) throw new Error('El destino HTTP no es el del ensayo.');

export async function sql(s) { const r = await ejecutarEnsayo('postgres', s); if (!r.ok) throw new Error(r.err); return r.out; }
export async function sqlJson(s) { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; }

// La red del navegador solo puede llegar a la app del ensayo y a su API (los tipos de letra de Google se bloquean).
export async function soloRedDelEnsayo(context) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (![ORIGEN_APP, supabaseURL].includes(url.origin)) return route.abort('blockedbyclient');
    return route.continue();
  });
}

export async function verificarEntorno(request) {
  const modulo = await (await request.get(`${ORIGEN_APP}/src/lib/supabase.js`)).text();
  const url = modulo.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1];
  expect(url, 'la app sirve la URL del ensayo').toBe(supabaseURL);
  expect(modulo.includes('supabase.co'), 'la app no referencia ningún proyecto remoto').toBe(false);
  return verificarMismaBase('postgres');
}

export async function sesion(request, email) {
  const r = await request.post(`${supabaseURL}/auth/v1/token?grant_type=password`, { headers: { apikey: ANON }, data: { email, password: PW } });
  expect(r.status(), `login de ${email.split('@')[0]}`).toBe(200);
  const j = await r.json();
  return { token: j.access_token, uid: j.user.id };
}
const cab = (token) => ({ apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' });
export async function rpc(request, token, fn, args = {}) {
  const r = await request.post(`${supabaseURL}/rest/v1/rpc/${fn}`, { headers: cab(token), data: args });
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status(), cuerpo };
}
export async function tabla(request, token, ruta, { metodo = 'GET', data } = {}) {
  const r = await request.fetch(`${supabaseURL}/rest/v1/${ruta}`, { method: metodo, headers: { ...cab(token), Prefer: 'return=representation' }, data });
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status(), cuerpo };
}
export const mensaje = (r) => (typeof r.cuerpo === 'string' ? r.cuerpo : (r.cuerpo?.message ?? JSON.stringify(r.cuerpo)));

export async function loginUI(page, email) {
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor();
}

// Huella de los datos de negocio EXISTENTES (cuentas y md5 de las columnas que ya existían antes de la actualización):
// debe ser idéntica antes y después de aplicar las migraciones.
export async function huellaNegocio() {
  const t = (nombre, cols, extra = '') => `'${nombre}', (select count(*)::text || ':' || md5(coalesce(string_agg(row(${cols})::text, '|' order by row(${cols})::text), '')) from public.${nombre} ${extra})`;
  return sqlJson(`select json_build_object(
    ${t('productos', 'id,codigo_barras,nombre,precio,costo,stock_actual,activo')},
    ${t('servicios', 'id,nombre,precio,activo')},
    ${t('clientes', 'id,nombre,telefono,cliente_web_id,puntos_bono,fidelizacion_recompensas_reclamadas')},
    ${t('ventas', 'id,codigo,estado,total,metodo_pago,vendedor_id,cliente_id,descuento_pct,descuento_monto')},
    ${t('venta_items', 'id,venta_id,tipo,nombre,cantidad,precio_unitario,subtotal')},
    ${t('citas', 'id,cliente_id,asistente_id,fecha_hora,estado')},
    ${t('cita_servicios', 'id,cita_id,servicio_id,precio')},
    ${t('registro_servicios', 'id,usuario_id,servicio_id,cliente_id,precio,estado,venta_id')},
    ${t('cupones', 'id,cliente_id,codigo,origen,valor,estado,tipo_descuento')},
    ${t('promociones', 'id,titulo,tipo_descuento,valor,activo')},
    ${t('pedidos_web', 'id,cliente_id,estado,total')},
    ${t('config_puntos', 'id,umbral_vip,umbral_premium,puntos_por_visita,puntos_por_sol_gastado')},
    ${t('config_referidos', 'id,credito_referido,credito_referidor')},
    ${t('config_fidelizacion', 'id,porcentaje_recompensa')},
    ${t('usuarios', 'id,email,rol,activo')},
    ${t('asistentes', 'id,usuario_id,nombres_completos,activo')},
    ${t('porcentajes', 'servicio_id,asistente_id,porcentaje')})`);
}

// Lecturas del portal de la clienta y del panel que existían ANTES: se comparan antes/después (con el programa apagado).
export const LECTURAS = [
  ['mis_puntos', {}], ['mi_fidelizacion', {}], ['mi_historial_fidelizacion', {}], ['mis_cupones', {}],
  ['mi_estado_referidos', {}], ['mi_codigo_referido', {}], ['resenas_publicas', {}], ['datos_contacto', {}], ['horario_atencion', {}],
  ['servicios_mas_pedidos', { dias: 30 }],
];

// Estado del programa nuevo. Antes de la actualización la tabla no existe (se informa «sin_tabla»); después, activo/corte reales.
export async function estadoPrograma() {
  const existe = (await sql(`select to_regclass('public.recompensas_config') is not null`)) === 't';
  if (!existe) return { tabla: false, activo: null, corteNulo: null, movimientos: 0 };
  return sqlJson(`select json_build_object('tabla', true, 'activo', (select activo from public.recompensas_config limit 1),
    'corteNulo', (select corte is null from public.recompensas_config limit 1), 'movimientos', (select count(*) from public.recompensas_movimientos))`);
}
