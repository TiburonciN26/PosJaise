// Prepara la instancia desechable «JaiseEnsayo» para las pruebas HTTP y de interfaz con sesiones reales.
//
// Lo esencial: la apertura se ejecuta en la base «postgres» del ensayo, que es la que sirven GoTrue (Auth) y PostgREST (REST);
// la aplicación (Vite) se arranca contra esa misma instancia. Antes de seguir se comprueba, leyendo la configuración de los
// contenedores, que Auth y REST usan exactamente esa base (verificarMismaBase). Las pruebas SQL del ensayo de transición
// usaron la base «transicion», que ningún servicio sirve: esta vía es la que demuestra el recorrido completo.
//
// Contraseña: ENSAYO_PASSWORD (solo en el entorno del proceso; es la de las cuentas FICTICIAS del ensayo, no la de QA).
// Nunca se imprime ni se guarda. Qué escribe: solo en la instancia desechable. El JSON de salida lleva identificadores, no secretos.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  restaurarBase, ejecutarEnsayo, hacerPrincipal, verificarMismaBase, clavesDelEnsayo, comoEnsayo, supabaseURL, PUERTO_API,
} from './ensayo-destino.mjs';

const BASE = 'postgres';
const ADMIN = 'f73eb105-8427-47e1-be5a-7078250df55c';
const CAJERA = 'b6e3a07a-c785-41c1-8c30-2b0ec7de5978';
const SALIDA = new URL('./fixtures/ensayo-runtime.json', import.meta.url);
const PW = process.env.ENSAYO_PASSWORD;
if (!PW || PW.length < 12) { console.error('Falta ENSAYO_PASSWORD (≥ 12 caracteres) en el entorno del proceso.'); process.exit(1); }
if (/[$'\\]/.test(PW)) { console.error('ENSAYO_PASSWORD no debe contener $, \' ni \\.'); process.exit(1); }

const sql = async (s, base = BASE) => { const r = await ejecutarEnsayo(base, s); if (!r.ok) throw new Error(r.err); return r.out; };
const json = async (s) => { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };
const como = async (uid, s) => sql(comoEnsayo(uid) + s);

// 1) Base preparada: copia de QA + marca + borrador v2, y se hace la base «postgres» del ensayo.
await restaurarBase('/tmp/qa.dump', 'listo', { marcar: true });
const borrador = readFileSync(new URL('../../docs/recompensas-fase2/transicion/apertura-borrador.sql', import.meta.url), 'utf8');
{ const r = await ejecutarEnsayo('listo', borrador); if (!r.ok) throw new Error(r.err); }
await hacerPrincipal('listo');

// 2) Esperar a que Auth y REST vuelvan y comprobar que sirven ESTA base.
const claves = clavesDelEnsayo();
for (let i = 0; i < 60; i += 1) {
  try {
    const a = await fetch(`${supabaseURL}/auth/v1/health`, { headers: { apikey: claves.anon }, redirect: 'error' });
    const r = await fetch(`${supabaseURL}/rest/v1/`, { headers: { apikey: claves.anon }, redirect: 'error' });
    if (a.ok && r.ok) break;
  } catch { /* aún levantando */ }
  await new Promise((res) => setTimeout(res, 1000));
  if (i === 59) throw new Error('Auth/REST no volvieron a responder.');
}
const mismaBase = verificarMismaBase(BASE);

// 3) Contraseña de las cuentas de personal del ensayo (las de QA tienen otra y no se usa).
const CUENTAS = { ADMINISTRADOR: 'administradortest01@test.local', CAJERA: 'cajeratest01@test.local', ASISTENTE: 'asistentetest01@test.local' };
await sql(`update auth.users set encrypted_password = extensions.crypt('${PW}', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()) where email in (${Object.values(CUENTAS).map((e) => `'${e}'`).join(',')});`);

// 4) Cuentas CLIENTE por la API de Auth del ensayo (usuarios reales, con sesión posible) y sus fichas.
const nonce = randomBytes(4).toString('hex');
async function usuarioAuth(email) {
  const r = await fetch(`${supabaseURL}/auth/v1/admin/users`, {
    method: 'POST', redirect: 'error',
    headers: { apikey: claves.servicio, Authorization: `Bearer ${claves.servicio}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { ensayo: true } }),
  });
  if (!r.ok) throw new Error(`Alta de ${email} falló (${r.status})`);
  return (await r.json()).id;
}
async function clienta(clave, { vinculada = true, reclamadas = 0, bono = 0 }) {
  const email = `ens-${clave}-${nonce}@test.local`;
  const uid = await usuarioAuth(email);
  const id = randomUUID();
  const tel = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await sql(`insert into public.clientes_web (id, email) values ('${uid}', '${email}') on conflict (id) do nothing;
    insert into public.clientes (id, nombre, telefono, cliente_web_id, fidelizacion_recompensas_reclamadas, puntos_bono)
    values ('${id}', 'TEST ENS ${clave} ${nonce}', '${tel}', ${vinculada ? `'${uid}'` : 'null'}, ${reclamadas}, ${bono});`);
  return { clave, email, uid, id, telefono: tel };
}
async function servicio(precio) {
  const id = randomUUID();
  await sql(`insert into public.servicios (id, nombre, precio, duracion_min) values ('${id}', 'TEST ENS serv ${id.slice(0, 6)}', ${precio}, 30);`);
  return id;
}
async function atenciones(clienteId, servicioId, n, precio) {
  await sql(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    select gen_random_uuid(), '${ADMIN}', '${servicioId}', '${clienteId}', ${precio},
           date_trunc('day', now()) - (i || ' days')::interval + interval '15 hours', 'ACTIVO' from generate_series(1, ${n}) i;`);
}
async function unaAtencion(clienteId, servicioId, precio, dias) {
  const id = randomUUID();
  await sql(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    values ('${id}', '${ADMIN}', '${servicioId}', '${clienteId}', ${precio}, date_trunc('day', now()) - interval '${dias} days' + interval '15 hours', 'ACTIVO');`);
  return id;
}

const sv = await servicio(20);
const F = {};
F.h1 = await clienta('sellos-mayor-20', {}); await atenciones(F.h1.id, sv, 25, 20); // 25 sellos, 250 monedas, VIP
F.h2 = await clienta('sellos-negativos', { reclamadas: 2 }); await atenciones(F.h2.id, sv, 3, 20); // −7 sellos, 30 monedas
F.h3 = await clienta('atencion-pendiente', {}); const sv40 = await servicio(40); F.h3.atencion = await unaAtencion(F.h3.id, sv40, 40, 1); // 15 monedas
F.h4 = await clienta('en-espera', { vinculada: false }); await atenciones(F.h4.id, sv, 3, 33.34); // 40 monedas congeladas, 3 sellos
F.h5 = await clienta('para-canje', {}); await atenciones(F.h5.id, sv, 6, 20); // 6 visitas·1 + 120·0,05 = 12 → 60 monedas
F.h7 = await clienta('en-espera-ui', { vinculada: false }); await atenciones(F.h7.id, sv, 3, 33.34); // igual que h4, para la vinculación por la interfaz
F.h6 = await clienta('venta-historica', {}); const sv50 = await servicio(50); F.h6.atencion = await unaAtencion(F.h6.id, sv50, 50, 3);
const premio = randomUUID();
const producto = randomUUID();
await sql(`insert into public.recompensas_catalogo (id, nombre, activo, origen, tipo, valor, alcance, nivel_minimo, costo_basico)
  values ('${premio}', 'TEST ENS premio ${nonce}', true, 'MONEDAS', 'MONTO', 5, 'TODO', 'BASICO', 25);
  insert into public.productos (id, nombre, precio, costo, stock_actual) values ('${producto}', 'TEST ENS prod ${nonce}', 80, 1, 200);`);
// Venta anterior a la apertura, con el programa APAGADO (reglas antiguas).
const vh = await como(CAJERA, `select row_to_json(t) from public.confirmar_venta('Yape', null,
  $j$[{"tipo":"SERVICIO","registro_servicio_id":"${F.h6.atencion}","cantidad":1}]$j$::jsonb, '${F.h6.id}'::uuid, 0, 0, null, null, 0) t;`);
F.h6.venta = JSON.parse(vh.split('\n').filter(Boolean).pop()).venta_id;

// Canario: un dato que SOLO existe en esta base (se busca luego por REST, por Auth y en pantalla, y no debe estar en «transicion»).
const canarioEmail = `canario-${nonce}@test.local`;
const canarioUid = await usuarioAuth(canarioEmail);
const canarioFicha = randomUUID();
await sql(`insert into public.clientes_web (id, email) values ('${canarioUid}', '${canarioEmail}') on conflict (id) do nothing;
  insert into public.clientes (id, nombre, telefono, cliente_web_id) values ('${canarioFicha}', 'TEST ENS CANARIO ${nonce}', '9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', '${canarioUid}');`);

// 5) Apertura en MODO DEFINITIVO y activación en la misma transacción (corte tomado dentro del bloqueo, no reutilizado).
await sql(`delete from public.recompensas_apertura_aportes where cliente_id in (select id from public.clientes where nombre like 'TEST F2 %');`); // 17 fixtures antiguos (copia desechable)
const apertura = JSON.parse((await como(ADMIN, `select public.recompensas_ejecutar_apertura(null, true, true);`)).split('\n').filter(Boolean).pop());
if (!apertura.ejecutado || !apertura.activado) throw new Error('La apertura no quedó ejecutada y activada.');

// 6) Verdad en la base para comparar luego por HTTP y en pantalla.
const verdad = {};
for (const [k, c] of Object.entries(F)) {
  verdad[k] = await json(`select row_to_json(s) from public.recompensas_saldos('${c.id}') s;`);
}
const config = await json(`select row_to_json(c) from (select activo, corte from public.recompensas_config) c`);

mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(SALIDA, JSON.stringify({
  nonce, preparadoEn: new Date().toISOString(), api: supabaseURL, puertoApi: PUERTO_API, mismaBase,
  cuentas: CUENTAS, clientas: F, premio, producto, servicio: sv,
  canario: { email: canarioEmail, uid: canarioUid, ficha: canarioFicha, nombre: `TEST ENS CANARIO ${nonce}` },
  apertura, verdad, config,
}, null, 2));
console.log(`Ensayo HTTP/UI listo: apertura ${apertura.modo} + activada; Auth/REST/SQL → «${mismaBase.sql}». Fixtures en fixtures/ensayo-runtime.json`);
