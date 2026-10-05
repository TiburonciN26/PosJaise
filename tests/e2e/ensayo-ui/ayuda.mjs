// Ayudas de las pruebas HTTP/interfaz del ensayo. Todo opera contra la instancia desechable: las llamadas HTTP validan el
// origen, y SQL pasa por ensayo-destino.mjs (que rechaza cualquier destino que no sea el ensayo).
import { readFileSync } from 'node:fs';
import { expect } from 'playwright/test';
import { ejecutarEnsayo, comoEnsayo, clavesDelEnsayo, soloRedDelEnsayo, supabaseURL, verificarMismaBase } from '../ensayo-destino.mjs';

export const R = JSON.parse(readFileSync(new URL('../fixtures/ensayo-runtime.json', import.meta.url), 'utf8'));
export const PW = process.env.ENSAYO_PASSWORD;
export const BASE = 'postgres';
export { soloRedDelEnsayo, supabaseURL, comoEnsayo };
const claves = clavesDelEnsayo();
export const ANON = claves.anon;

if (!PW) throw new Error('Falta ENSAYO_PASSWORD en el entorno del proceso.');
if (!supabaseURL.startsWith('http://127.0.0.1:56321')) throw new Error('El destino HTTP no es el del ensayo.');

// SQL contra la base «postgres» del ensayo (la que sirven Auth y REST).
export async function sql(s) { const r = await ejecutarEnsayo(BASE, s); if (!r.ok) throw new Error(r.err); return r.out; }
export async function sqlJson(s) { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; }
export const sqlComo = (uid, s) => ejecutarEnsayo(BASE, comoEnsayo(uid) + s);

// Comprobación previa común: Vite sirve la URL del ensayo y Auth/REST/SQL usan la misma base.
export async function verificarEntorno(request) {
  const modulo = await (await request.get('http://localhost:5273/src/lib/supabase.js')).text();
  const url = modulo.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1];
  expect(url, 'la app sirve la URL del ensayo').toBe(supabaseURL);
  expect(modulo.includes('supabase.co'), 'la app no referencia ningún proyecto remoto').toBe(false);
  return verificarMismaBase(BASE);
}

// Sesión real contra GoTrue del ensayo. Devuelve { token, uid }.
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

// Huella de las tablas del libro (conteo + MD5) para comprobar que un intento rechazado no cambió nada.
export async function huellaLibros() {
  return sqlJson(`select json_build_object(
    'mov', (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.recompensas_movimientos x),
    'sellos', (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.recompensas_sellos_movs x),
    'aportes', (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.recompensas_apertura_aportes x),
    'espera', (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.recompensas_apertura_espera x),
    'config', (select md5(x::text) from public.recompensas_config x))`);
}
