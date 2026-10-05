// Prepara la instancia desechable «JaiseEnsayo» para las pruebas HTTP/UI de QA-054 (cupón validado antes de pedir el pago).
//
// Usa sesiones REALES (GoTrue del ensayo): las cuentas CLIENTE se dan de alta por la API de Auth y el personal ya existe en la copia.
// Contraseña: ENSAYO_PASSWORD (solo en el entorno del proceso; es la de las cuentas FICTICIAS del ensayo, no la de QA). Nunca se
// imprime ni se guarda. Escribe SOLO en la instancia desechable (ensayo-destino.mjs rechaza cualquier otro destino).
// Aplica a la base «postgres» del ensayo las dos migraciones de la protección de cupones si todavía no están.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { ejecutarEnsayo, clavesDelEnsayo, supabaseURL, verificarMismaBase } from './ensayo-destino.mjs';

const BASE = 'postgres';
const PW = process.env.ENSAYO_PASSWORD;
if (!PW || PW.length < 12) { console.error('Falta ENSAYO_PASSWORD (≥ 12 caracteres) en el entorno del proceso.'); process.exit(1); }
if (/[$'\\]/.test(PW)) { console.error('ENSAYO_PASSWORD no debe contener $, \' ni \\.'); process.exit(1); }
const SALIDA = new URL('./fixtures/ensayo-cupon-runtime.json', import.meta.url);
const sql = async (s) => { const r = await ejecutarEnsayo(BASE, s); if (!r.ok) throw new Error(r.err); return r.out; };
const json = async (s) => { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };

const mismaBase = verificarMismaBase(BASE);
const claves = clavesDelEnsayo();

// 1) Migraciones de la protección de cupones (idempotente: solo si faltan).
for (const [funcion, archivo] of [
  ['public.recompensas_proteccion_servicio(uuid,numeric)', '20261005000001_cupones_proteccion_global.sql'],
  ['public.recompensas_evaluar_cupon(uuid,jsonb)', '20261005000002_cupones_validacion_pedido.sql'],
  ['public.vista_previa_cupon_pedido(text,uuid[],jsonb)', '20261005000003_pedido_cantidades_total_anunciado.sql'],
]) {
  const hay = await json(`select to_json(to_regprocedure('${funcion}') is not null)`);
  if (!hay) await sql(readFileSync(new URL(`../../supabase/migrations/${archivo}`, import.meta.url), 'utf8'));
}

// 2) Contraseña de las cuentas de personal del ensayo (la ADMIN verifica pagos).
const CUENTAS = { ADMINISTRADOR: 'administradortest01@test.local', CAJERA: 'cajeratest01@test.local' };
await sql(`update auth.users set encrypted_password = extensions.crypt('${PW}', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()) where email in (${Object.values(CUENTAS).map((e) => `'${e}'`).join(',')});`);
// Negocio abierto para el pedido: lunes a sábado en horario del ensayo (copia de QA: 10:00-13:00).
await sql(`update public.estado_negocio set dias_atencion = '{1,2,3,4,5,6}' where id = 1;`);

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

// Una escena = una clienta con su carrito y sus cupones; cada prueba usa la suya (los pedidos y cupones se consumen).
async function escena(clave, { precio = 50, costo = 20, transporte = 3, otros = 25, cantidad = 1, stock = 10, cupones = [], nombreProducto } = {}) {
  const email = `ens-cupon-${clave}-${nonce}@test.local`;
  const uid = await usuarioAuth(email);
  const clienteId = randomUUID();
  const tel = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const productoId = randomUUID();
  const nombre = nombreProducto ?? `TEST ENS cupon ${clave} ${nonce}`;
  await sql(`insert into public.clientes_web (id, email) values ('${uid}', '${email}') on conflict (id) do nothing;
    insert into public.clientes (id, nombre, telefono, cliente_web_id) values ('${clienteId}', 'TEST ENS cupon ${clave} ${nonce}', '${tel}', '${uid}');
    insert into public.productos (id, nombre, precio, costo, stock_actual) values ('${productoId}', '${nombre}', ${precio}, ${costo}, ${stock});
    insert into public.productos_proteccion (producto_id, transporte, otros, costo_confirmado) values ('${productoId}', ${transporte}, ${otros}, ${Number(costo) === 0});
    insert into public.carrito_productos (cliente_web_id, producto_id, cantidad) values ('${uid}', '${productoId}', ${cantidad});`);
  const misCupones = [];
  for (const c of cupones) {
    const codigo = ('EC' + randomBytes(4).toString('hex')).toUpperCase();
    await sql(`insert into public.cupones (cliente_id, codigo, origen, valor, tipo_descuento, alcance, minimo_compra, tope, nivel_minimo)
      values ('${clienteId}', '${codigo}', 'PROMOCION', ${c.valor}, '${c.tipo ?? 'MONTO_FIJO'}', '${c.alcance ?? 'TODO'}', ${c.minimo ?? 'null'}, ${c.tope ?? 'null'}, 'BASICO');`);
    misCupones.push({ ...c, codigo });
  }
  return { clave, email, uid, clienteId, productoId, nombre, precio, cupones: misCupones };
}

const E = {};
// Escenario de Codex: producto S50, costo S20 + transporte S3 + otros S25 = protección S48; cupón S10 (fuera) y S2 (dentro).
E.rechazo = await escena('rechazo', { cupones: [{ valor: 10 }] });
E.valido = await escena('valido', { cupones: [{ valor: 2 }] });
E.lento = await escena('lento', { cupones: [{ valor: 2 }] });
E.cantidad = await escena('cantidad', { precio: 25, costo: 5, transporte: 0, otros: 0, cantidad: 2, cupones: [{ valor: 5, minimo: 50 }] });
E.servicios = await escena('servicios', { precio: 50, costo: 10, transporte: 0, otros: 0, cupones: [{ valor: 5, alcance: 'SERVICIOS' }] });
E.directo = await escena('directo', { cupones: [{ valor: 10 }] });
E.posterior = await escena('posterior', { cupones: [{ valor: 2 }] });
E.preview = await escena('preview', { precio: 50, costo: 10, transporte: 0, otros: 0, cupones: [
  { valor: 50, tipo: 'PORCENTAJE', tope: 5 }, { valor: 10, minimo: 60 }, { valor: 100, tipo: 'PORCENTAJE', tope: 45 }] });
// Costo DESCONOCIDO (0 sin confirmar) y cero CONFIRMADO.
E.desconocido = await escena('desconocido', { precio: 40, costo: 0, transporte: 0, otros: 0, cupones: [{ valor: 5 }] });
await sql(`delete from public.productos_proteccion where producto_id = '${E.desconocido.productoId}';`);
E.cero = await escena('cero', { precio: 40, costo: 0, transporte: 0, otros: 0, cupones: [{ valor: 5 }] });

// QA-057: producto S50, protección S25 (costo 25), cupón propio S10, carrito de UNA unidad (una escena por variante).
for (const v of ['q57carrera', 'q57rapido', 'q57patch', 'q57tarde', 'q57precio']) {
  E[v] = await escena(v, { precio: 50, costo: 25, transporte: 0, otros: 0, cantidad: 1, stock: 20, cupones: [{ valor: 10 }] });
}

mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(SALIDA, JSON.stringify({ nonce, preparadoEn: new Date().toISOString(), api: supabaseURL, mismaBase, cuentas: CUENTAS, escenas: E }, null, 2));
console.log(`Ensayo preparado: ${Object.keys(E).length} escenas (nonce ${nonce}).`);
