// Prepara la instancia desechable «JaiseEnsayo» para las pruebas de coherencia de Recompensas en el portal (Citas, detalle de
// servicio y de producto, carrito de servicios, Inicio y Recompensas).
//
// Sesiones REALES (GoTrue del ensayo): las cuentas CLIENTE se dan de alta por la API de Auth. Contraseña: ENSAYO_PASSWORD (solo en el
// entorno del proceso; es la de las cuentas FICTICIAS del ensayo, no la de QA). Nunca se imprime ni se guarda. Escribe SOLO en la
// instancia desechable (ensayo-destino.mjs rechaza cualquier otro destino). No toca Supabase Local QA.
//
// Los saldos de las escenas se siembran con SQL (movimientos de ajuste y sellos): es preparación de datos, no un flujo de venta. El gasto
// de monedas, la lectura y las ventas que prueban las reglas se hacen después por las sesiones reales, en la propia especificación.
// Catálogo: los premios propios se crean apagados; la especificación los enciende y apaga el resto del catálogo de sellos mientras corre.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { ejecutarEnsayo, clavesDelEnsayo, supabaseURL, verificarMismaBase } from './ensayo-destino.mjs';

const BASE = 'postgres';
const PW = process.env.ENSAYO_PASSWORD;
if (!PW || PW.length < 12) { console.error('Falta ENSAYO_PASSWORD (≥ 12 caracteres) en el entorno del proceso.'); process.exit(1); }
if (/[$'\\]/.test(PW)) { console.error('ENSAYO_PASSWORD no debe contener $, \' ni \\.'); process.exit(1); }
const SALIDA = new URL('./fixtures/ensayo-coherencia-runtime.json', import.meta.url);
const sql = async (s) => { const r = await ejecutarEnsayo(BASE, s); if (!r.ok) throw new Error(r.err); return r.out; };
const json = async (s) => { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };

const mismaBase = verificarMismaBase(BASE);
const claves = clavesDelEnsayo();
const nonce = randomBytes(4).toString('hex');

// 1) Migración de lectura pública de reglas (idempotente: solo si falta).
const hay = await json(`select to_json(to_regprocedure('public.recompensas_reglas_publicas()') is not null)`);
const migracion = new URL('../../supabase/migrations/20261005000004_recompensas_reglas_publicas.sql', import.meta.url);
let migracionAplicada = false;
if (!hay) {
  try { await sql(readFileSync(migracion, 'utf8')); migracionAplicada = true; } catch (e) { console.warn('Migración de reglas no aplicada:', String(e.message).split('\n')[0]); }
}

// Cuentas de personal del ensayo (la CAJERA confirma ventas; la ADMINISTRADORA anula): contraseña ficticia de este proceso.
const CUENTAS = { ADMINISTRADOR: 'administradortest01@test.local', CAJERA: 'cajeratest01@test.local' };
await sql(`update auth.users set encrypted_password = extensions.crypt('${PW}', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()) where email in (${Object.values(CUENTAS).map((e) => `'${e}'`).join(',')});`);
const adminId = await json(`select to_json(id) from public.usuarios where email = '${CUENTAS.ADMINISTRADOR}'`);

async function usuarioAuth(email) {
  const r = await fetch(`${supabaseURL}/auth/v1/admin/users`, {
    method: 'POST', redirect: 'error',
    headers: { apikey: claves.servicio, Authorization: `Bearer ${claves.servicio}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { ensayo: true } }),
  });
  if (!r.ok) throw new Error(`Alta de ${email} falló (${r.status})`);
  return (await r.json()).id;
}

// Una escena = una clienta con cuenta y, si se pide, saldo sembrado.
async function clienta(clave, { monedas = 0, clasificacion = 0, sellos = 0 } = {}) {
  const email = `ens-coh-${clave}-${nonce}@test.local`;
  const uid = await usuarioAuth(email);
  const id = randomUUID();
  const tel = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await sql(`insert into public.clientes_web (id, email) values ('${uid}', '${email}') on conflict (id) do nothing;
    insert into public.clientes (id, nombre, telefono, cliente_web_id) values ('${id}', 'TEST ENS coh ${clave} ${nonce}', '${tel}', '${uid}');`);
  if (monedas !== 0 || clasificacion !== 0) {
    await sql(`insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clasificacion, clave, detalle)
      values ('${id}', 'AJUSTE', ${monedas}, ${clasificacion}, 'ens-coh-${clave}-${nonce}', '{"ensayo":"coherencia"}'::jsonb);`);
  }
  for (let i = 0; i < sellos; i += 1) {
    await sql(`insert into public.recompensas_sellos_movs (cliente_id, tipo, delta, dia, clave, detalle)
      values ('${id}', 'SELLO', 1, (now() at time zone 'America/Lima')::date - ${i + 2}, 'ens-coh-sello-${clave}-${nonce}-${i}', '{"ensayo":"coherencia"}'::jsonb);`);
  }
  return { clave, email, uid, id, nombre: `TEST ENS coh ${clave} ${nonce}` };
}

const E = {};
// Gasto: BASICO con 40 de clasificación y 40 monedas (faltan 10 para Premium); canjeará el premio de 30 monedas.
E.gasto = await clienta('gasto', { monedas: 40, clasificacion: 40, sellos: 3 });
// Premium: 60 de clasificación y 60 monedas (faltan 90 para VIP).
E.premium = await clienta('premium', { monedas: 60, clasificacion: 60, sellos: 0 });
// Nueva: sin movimientos. Sirve para reserva / atención frente a venta confirmada.
E.nueva = await clienta('nueva');
// Negativa: monedas negativas por una anulación (la clasificación conserva su valor).
E.negativa = await clienta('negativa', { monedas: -12, clasificacion: 20, sellos: 0 });

// Servicio y producto propios con precios redondos (S/ 100 y S/ 80) para estimaciones exactas.
const servicioId = randomUUID();
const productoId = randomUUID();
const nombreServicio = `TEST ENS coh servicio ${nonce}`;
const nombreProducto = `TEST ENS coh producto ${nonce}`;
await sql(`insert into public.servicios (id, nombre, categoria, precio, duracion_min, activo, descripcion)
  values ('${servicioId}', '${nombreServicio}', 'Cabello', 100, 60, true, 'Servicio ficticio del ensayo de coherencia.');
  insert into public.productos (id, nombre, precio, costo, stock_actual, activo)
  values ('${productoId}', '${nombreProducto}', 80, 30, 50, true);
  insert into public.productos_proteccion (producto_id, transporte, otros, costo_confirmado) values ('${productoId}', 0, 0, false);`);

// Premios propios: uno de monedas (30) y uno de sellos con un beneficio DISTINTO de 20 % (25 %, tope S/ 8). Se crean APAGADOS: la
// especificación los enciende al empezar (y apaga el resto del catálogo de sellos) y lo restaura al terminar.
const premioMonedas = randomUUID();
const premioSellos = randomUUID();
const nombrePremioMonedas = `TEST ENS coh premio monedas ${nonce}`;
const nombrePremioSellos = `TEST ENS coh premio sellos ${nonce}`;
await sql(`update public.recompensas_catalogo set activo = false where nombre like 'TEST ENS coh premio%';
  insert into public.recompensas_catalogo (id, nombre, activo, origen, tipo, valor, alcance, nivel_minimo, costo_basico)
  values ('${premioMonedas}', '${nombrePremioMonedas}', false, 'MONEDAS', 'MONTO', 5, 'TODO', 'BASICO', 30);
  insert into public.recompensas_catalogo (id, nombre, activo, origen, tipo, valor, tope, alcance, nivel_minimo)
  values ('${premioSellos}', '${nombrePremioSellos}', false, 'SELLOS', 'PORCENTAJE', 25, 8, 'TODO', 'BASICO');`);

const config = await json(`select to_json(c) from public.recompensas_config c where id = 1`);

mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(SALIDA, JSON.stringify({
  nonce, preparadoEn: new Date().toISOString(), api: supabaseURL, mismaBase, migracionAplicada, cuentas: CUENTAS, adminId,
  clientas: E, servicio: { id: servicioId, nombre: nombreServicio, precio: 100 }, producto: { id: productoId, nombre: nombreProducto, precio: 80 },
  premios: { monedas: { id: premioMonedas, nombre: nombrePremioMonedas, costo: 30 }, sellos: { id: premioSellos, nombre: nombrePremioSellos, porcentaje: 25, tope: 8 } },
  configOriginal: config,
}, null, 2));
console.log(`Ensayo de coherencia preparado: ${Object.keys(E).length} clientas (nonce ${nonce}).`);
