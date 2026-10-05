// Ensayo de la transición histórica ×5 (decisiones A y B) — SOLO en la instancia desechable «JaiseEnsayo», base «transicion»
// (restaurada de la copia de QA). Usa ensayo-destino.mjs: cualquier destino que no sea esa instancia se rechaza antes de escribir.
// No es una prueba de interfaz ni HTTP: SQL con claims simulados (request.jwt.claims), igual que la capa node:test de QA.
//
// Orden (las pruebas son seriales y comparten estado a propósito; el orden ES el ensayo):
//   preparación → dry-run → ejecución → conciliación → idempotencia → reversión de una clienta sin actividad y reapertura →
//   activación → vinculación posterior (A) → atenciones pendientes → anulaciones (B) → reversión rechazada con actividad →
//   recuperación restaurando la copia previa.
// Ejecutar:  node --test --test-concurrency=1 tests/e2e/recompensas-transicion.ensayo.mjs   (la base «transicion» se
// consume: para repetir el ensayo hay que volver a restaurarla de la copia; ver RESULTADOS-ENSAYO.md).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { ejecutarEnsayo, comoEnsayo, volcarBase, restaurarBase, verificarDestinoEnsayo } from './ensayo-destino.mjs';

const BASE = 'transicion';
const ADMIN = 'f73eb105-8427-47e1-be5a-7078250df55c';
const CAJERA = 'b6e3a07a-c785-41c1-8c30-2b0ec7de5978';
const EVIDENCIA = process.env.ENSAYO_EVIDENCIA ?? 'C:/JaiseQA-Backups/evidencia';
const CORTE_ARCHIVO = process.env.ENSAYO_CORTE_ARCHIVO ?? 'C:/JaiseQA-Backups/CORTE.txt';
const resultados = {};

const sql = async (s) => { const r = await ejecutarEnsayo(BASE, s); if (!r.ok) throw new Error(r.err); return r.out; };
const comoAdmin = async (s) => sql(comoEnsayo(ADMIN) + s);
const json = async (s) => { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };
const jsonAdmin = async (s) => { const o = await comoAdmin(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };
const intentar = async (uid, s) => ejecutarEnsayo(BASE, comoEnsayo(uid) + s);

const huella = (tabla) => `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.${tabla} x`;
const TABLAS_HUELLA = ['recompensas_movimientos', 'recompensas_sellos_movs', 'recompensas_apertura_aportes', 'recompensas_apertura_espera',
  'recompensas_config', 'clientes', 'registro_servicios', 'ventas', 'venta_items'];
async function huellas(base = BASE) {
  const o = {};
  for (const t of TABLAS_HUELLA) { const r = await ejecutarEnsayo(base, huella(t) + ';'); if (!r.ok) throw new Error(r.err); o[t] = r.out; }
  return o;
}
async function saldos(cid) { return json(`select row_to_json(s) from public.recompensas_saldos('${cid}') s;`); }

const F = {}; // fixtures
let corte;    // instante del corte del ensayo (ISO)
let previa;   // huellas antes de ejecutar
let sim;      // resumen de la simulación antes de ejecutar

async function clienta({ nombre, vinculada = true, reclamadas = 0, bono = 0 }) {
  const uid = randomUUID(); const id = randomUUID();
  let s = '';
  if (vinculada) s += `insert into auth.users (id, email) values ('${uid}', 'ens-${uid.slice(0, 8)}@test.local'); insert into public.clientes_web (id, email) values ('${uid}', 'ens-${uid.slice(0, 8)}@test.local');`;
  s += `insert into public.clientes (id, nombre, cliente_web_id, fidelizacion_recompensas_reclamadas, puntos_bono) values ('${id}', 'TEST ENS ${nombre}', ${vinculada ? `'${uid}'` : 'null'}, ${reclamadas}, ${bono});`;
  await sql(s);
  return { id, uid };
}
async function servicio(precio) {
  const id = randomUUID();
  await sql(`insert into public.servicios (id, nombre, precio, duracion_min) values ('${id}', 'TEST ENS serv ${id.slice(0, 6)}', ${precio}, 30);`);
  return id;
}
// n atenciones ACTIVO en n días distintos (hace 1..n días, 10:00 de Lima), cada una de `precio`.
async function atenciones(clienteId, servicioId, n, precio, { sinVenta = true } = {}) {
  await sql(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    select gen_random_uuid(), '${ADMIN}', '${servicioId}', '${clienteId}', ${precio},
           date_trunc('day', now()) - (i || ' days')::interval + interval '15 hours', 'ACTIVO' from generate_series(1, ${n}) i;`);
}
async function unaAtencion(clienteId, servicioId, precio, haceDias = 1) {
  const id = randomUUID();
  const fecha = haceDias === null ? 'now()' : `date_trunc('day', now()) - interval '${haceDias} days' + interval '15 hours'`;
  await sql(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    values ('${id}', '${ADMIN}', '${servicioId}', '${clienteId}', ${precio}, ${fecha}, 'ACTIVO');`);
  return id;
}
async function vender(uid, clienteId, items) {
  const r = await intentar(uid, `select row_to_json(t) from public.confirmar_venta('Yape', null, $j$${JSON.stringify(items)}$j$::jsonb,
    ${clienteId ? `'${clienteId}'::uuid` : 'null'}, 0, 0, null, null, 0) t;`);
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true, venta: JSON.parse(r.out.split('\n').filter(Boolean).pop()) };
}

describe('Ensayo de transición histórica ×5 en la instancia desechable', () => {
  before(() => { verificarDestinoEnsayo(BASE); });

  test('0. destino: es la instancia desechable y la copia de QA (sin apertura previa)', async () => {
    const o = await json(`select json_build_object('apertura', (select count(*) from public.recompensas_movimientos where tipo='APERTURA'),
      'activo', (select activo from public.recompensas_config), 'corte', (select corte from public.recompensas_config),
      'usuarios_no_test', (select count(*) from auth.users where email not like '%@test.local'))`);
    assert.equal(o.apertura, 0); assert.equal(o.activo, false); assert.equal(o.corte, null); assert.equal(o.usuarios_no_test, 0);
  });

  test('1. fixtures de casos límite (sellos >20, negativos, redondeo/bono, pendiente, venta histórica, en espera)', async () => {
    const sv = await servicio(20);
    F.sv = sv;
    // F1: 25 visitas, 0 reclamadas → 25 sellos heredados (>20); 25 + 500·0,05 = 50 puntos → 250 monedas (VIP).
    F.f1 = await clienta({ nombre: 'sellos>20' }); await atenciones(F.f1.id, sv, 25, 20);
    // F2: 3 visitas y 2 reclamadas → −7 sellos (negativo, se conserva tal cual).
    F.f2 = await clienta({ nombre: 'negativos', reclamadas: 2 }); await atenciones(F.f2.id, sv, 3, 20);
    // F3: redondeo y bono: 1 visita de 33,33 → floor(1 + 1,6665) = 2; redondeo −0,6665; bono 7 → 9 puntos.
    F.f3 = await clienta({ nombre: 'redondeo-bono', bono: 7 });
    F.f3serv = await servicio(33.33); await unaAtencion(F.f3.id, F.f3serv, 33.33, 2);
    // F4: atención pendiente de cobro (sin venta) anterior al corte; se cobrará DESPUÉS del corte.
    F.f4 = await clienta({ nombre: 'pendiente' });
    F.f4serv = await servicio(40); F.f4atencion = await unaAtencion(F.f4.id, F.f4serv, 40, 1);
    F.prod = randomUUID();
    await sql(`insert into public.productos (id, nombre, precio, costo, stock_actual) values ('${F.prod}', 'TEST ENS prod', 80, 1, 50);`);
    // F5: atención anterior al corte cobrada con el programa APAGADO (reglas antiguas, sin movimientos en el libro nuevo).
    F.f5 = await clienta({ nombre: 'venta-historica' });
    F.f5serv = await servicio(50); F.f5atencion = await unaAtencion(F.f5.id, F.f5serv, 50, 3);
    const v = await vender(CAJERA, F.f5.id, [{ tipo: 'SERVICIO', registro_servicio_id: F.f5atencion, cantidad: 1 }]);
    assert.ok(v.ok, v.err); F.f5venta = v.venta.venta_id;
    // F6: SIN cuenta web con puntos (decisión A): 3 visitas, 100 → 3 + 5 = 8 puntos; sellos 3.
    F.f6 = await clienta({ nombre: 'en-espera', vinculada: false }); await atenciones(F.f6.id, sv, 3, 33.34);
    // F7: SIN cuenta web y sin actividad: nada que congelar.
    F.f7 = await clienta({ nombre: 'espera-vacia', vinculada: false });
    // F8: clienta sin actividad alguna, vinculada (apertura de cero).
    F.f8 = await clienta({ nombre: 'vacia' });
    // Cuenta web libre para la vinculación posterior (F6) y una segunda cuenta distinta.
    for (const k of ['cuentaA', 'cuentaB']) {
      const uid = randomUUID(); F[k] = uid;
      await sql(`insert into auth.users (id, email) values ('${uid}', 'ens-${uid.slice(0, 8)}@test.local'); insert into public.clientes_web (id, email) values ('${uid}', 'ens-${uid.slice(0, 8)}@test.local');`);
    }
    assert.ok(F.f1.id && F.f6.id);
  });

  test('2. dry-run: informa, no escribe, y detecta aportes preexistentes (bloqueo) de fixtures antiguos', async () => {
    previa = await huellas();
    sim = await jsonAdmin(`select public.recompensas_simular_transicion_resumen();`);
    // El corte del ensayo es la hora EXACTA de la copia (instante en que arrancó el volcado), no la de la ejecución.
    const [, iso, lima] = readFileSync(CORTE_ARCHIVO, 'utf8').trim().split('|');
    corte = iso;
    assert.match(corte, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const ultima = await json(`select to_json(max(fecha) < '${corte}'::timestamptz) from public.registro_servicios where fecha < now() - interval '1 minute'`);
    assert.equal(ultima, true);
    resultados.corte = { utc: corte, lima };
    const r = await jsonAdmin(`select public.recompensas_ejecutar_apertura('${corte}'::timestamptz, false);`);
    assert.equal(r.ejecutado, false);
    assert.equal(r.puntos_antiguos_vinculadas, sim.puntos_antiguos_vinculadas);
    assert.equal(Number(r.monedas_apertura_vinculadas), 5 * Number(sim.puntos_antiguos_vinculadas));
    assert.equal(r.vinculadas, sim.clientas_vinculadas);
    assert.equal(r.en_espera, sim.clientas_total - sim.clientas_vinculadas);
    assert.ok(r.bloqueos_aportes_preexistentes > 0, 'los 17 aportes de fixtures de pruebas anteriores bloquean la ejecución');
    assert.deepEqual(await huellas(), previa, 'el dry-run no cambió ninguna tabla');
    resultados.dry_run = r; resultados.simulacion = sim;
  });

  test('3. la ejecución se RECHAZA mientras haya bloqueos, sin escribir nada', async () => {
    const r = await intentar(ADMIN, `select public.recompensas_ejecutar_apertura('${corte}'::timestamptz, true);`);
    assert.equal(r.ok, false); assert.match(r.err, /aportes de apertura preexistentes/);
    assert.deepEqual(await huellas(), previa);
  });

  test('3b. preparación del ensayo: se retiran SOLO los 17 aportes de fixtures de pruebas anteriores (en la copia desechable)', async () => {
    const o = await json(`select json_build_object('filas', count(*), 'clientas_test_f2', count(*) filter (where c.nombre like 'TEST F2 %'))
      from public.recompensas_apertura_aportes a join public.clientes c on c.id = a.cliente_id`);
    assert.equal(o.filas, o.clientas_test_f2, 'todos los aportes preexistentes son de fixtures TEST F2');
    resultados.aportes_fixture_retirados = o.filas;
    await sql(`delete from public.recompensas_apertura_aportes where cliente_id in (select id from public.clientes where nombre like 'TEST F2 %');`);
    previa = await huellas(); // la copia previa para la recuperación se toma YA preparada
    await volcarBase(BASE, '/tmp/previa.dump');
  });

  test('4. ejecución: totales, conciliación por clienta, sellos heredados y negativos', async () => {
    const r = await jsonAdmin(`select public.recompensas_ejecutar_apertura('${corte}'::timestamptz, true);`);
    resultados.ejecucion = r;
    assert.equal(r.ejecutado, true);
    assert.equal(Number(r.conciliacion.monedas_escritas_vinculadas), 5 * Number(r.puntos_antiguos_vinculadas));
    assert.equal(Number(r.conciliacion.aportes_puntos_escritos), Number(r.conciliacion.puntos_esperados));
    assert.equal(r.conciliacion.filas_espera, r.en_espera);
    // Contra la simulación independiente: por clienta, monedas, sellos y nivel.
    const dif = await jsonAdmin(`select json_build_object(
      'monedas', count(*) filter (where s.vinculada and coalesce(m.monedas, -1) <> s.monedas_apertura),
      'sellos', count(*) filter (where s.vinculada and coalesce(l.delta, 0) <> s.sellos_pendientes),
      'nivel', count(*) filter (where s.vinculada and (case when coalesce(m.cla, 0) >= rc.umbral_vip then 'VIP' when coalesce(m.cla, 0) >= rc.umbral_premium then 'PREMIUM' else 'BASICO' end) <> s.nivel_nuevo),
      'clasificacion', count(*) filter (where s.vinculada and coalesce(m.cla, -1) <> s.clasificacion_inicial),
      'comparadas', count(*) filter (where s.vinculada))
      from public.recompensas_simular_transicion() s
      left join (select cliente_id, sum(monedas) monedas, sum(clasificacion) cla from public.recompensas_movimientos where tipo='APERTURA' group by 1) m on m.cliente_id = s.cliente_id
      left join (select cliente_id, sum(delta) delta from public.recompensas_sellos_movs where tipo='APERTURA' and clave like 'apertura-sellos:%' group by 1) l on l.cliente_id = s.cliente_id
      cross join public.recompensas_config rc;`);
    assert.deepEqual({ ...dif, comparadas: undefined }, { monedas: 0, sellos: 0, nivel: 0, clasificacion: 0, comparadas: undefined });
    assert.equal(dif.comparadas, sim.clientas_vinculadas);
    // Aportes por clienta suman exactamente los puntos antiguos.
    const ap = await jsonAdmin(`select json_build_object('desajustadas', count(*)) from (
      select s.cliente_id from public.recompensas_simular_transicion() s
      left join (select cliente_id, sum(puntos_antiguos) p from public.recompensas_apertura_aportes group by 1) a on a.cliente_id = s.cliente_id
      where abs(coalesce(a.p, 0) - s.puntos_antiguos) > 0.000001) q;`);
    assert.equal(ap.desajustadas, 0);
    // Casos límite.
    const s1 = await saldos(F.f1.id); assert.equal(Number(s1.monedas), 250); assert.equal(s1.sellos, 25); assert.equal(s1.nivel, 'VIP');
    const s2 = await saldos(F.f2.id); assert.equal(s2.sellos, -7); assert.equal(Number(s2.monedas), 5 * (3 + 3));
    const s3 = await saldos(F.f3.id); assert.equal(Number(s3.monedas), 45);
    const ap3 = await json(`select json_object_agg(origen, p) from (select origen, sum(puntos_antiguos) p from public.recompensas_apertura_aportes where cliente_id='${F.f3.id}' group by 1) q`);
    assert.equal(Number(ap3.REDONDEO), -0.6665); assert.equal(Number(ap3.BONO_MANUAL), 7); assert.equal(Number(ap3.ATENCION), 1.6665);
    const s4 = await saldos(F.f4.id); assert.equal(Number(s4.monedas), 15);
    const s8 = await saldos(F.f8.id); assert.equal(Number(s8.monedas), 0); assert.equal(s8.sellos, 0);
    // Sin cuenta web: congelado, sin saldo gastable.
    const e6 = await json(`select row_to_json(e) from public.recompensas_apertura_espera e where cliente_id='${F.f6.id}'`);
    assert.equal(e6.estado, 'EN_ESPERA'); assert.equal(Number(e6.monedas), 40); assert.equal(e6.sellos, 3);
    const s6 = await saldos(F.f6.id); assert.equal(Number(s6.monedas), 0); assert.equal(s6.sellos, 0);
    // Sellos heredados > 20 y negativos del conjunto completo.
    const ext = await json(`select json_build_object('mayor_20', count(*) filter (where d > 20), 'negativos', count(*) filter (where d < 0)) from (
      select sum(delta) d from public.recompensas_sellos_movs where tipo='APERTURA' and clave like 'apertura-sellos:%' group by cliente_id) q`);
    assert.ok(ext.mayor_20 >= sim.sellos_heredados_mayor_20, 'los heredados >20 se conservan íntegros');
    assert.ok(ext.negativos >= sim.reclamadas_superan_visitas, 'los negativos se conservan, no se truncan');
    resultados.extremos = ext;
    resultados.config_corte = await json(`select to_json(corte) from public.recompensas_config`);
  });

  test('5. idempotencia: una segunda ejecución no duplica nada; otro corte se rechaza', async () => {
    const antes = await huellas();
    const r = await jsonAdmin(`select public.recompensas_ejecutar_apertura('${corte}'::timestamptz, true);`);
    assert.equal(r.clientas_por_procesar, 0);
    assert.deepEqual(await huellas(), antes, 'ninguna tabla cambió en la segunda ejecución');
    const otro = await intentar(ADMIN, `select public.recompensas_ejecutar_apertura(now() - interval '1 hour', true);`);
    assert.equal(otro.ok, false); assert.match(otro.err, /corte distinto/);
    const dup = await json(`select json_build_object('claves_repetidas', (select count(*) from (select clave from public.recompensas_movimientos group by 1 having count(*) > 1) q),
      'aperturas_por_clienta_max', (select max(c) from (select count(*) c from public.recompensas_movimientos where tipo='APERTURA' group by cliente_id) q))`);
    assert.equal(dup.claves_repetidas, 0); assert.equal(dup.aperturas_por_clienta_max, 1);
    resultados.idempotencia = { segunda_ejecucion: r, ...dup };
  });

  test('6. permisos: solo ADMINISTRADOR ejecuta, consulta o revierte', async () => {
    for (const uid of [CAJERA, '6fdc4f66-68ee-4429-924a-879318416f3b']) {
      for (const f of [`public.recompensas_ejecutar_apertura(now(), false)`, `public.recompensas_apertura_reversible()`, `public.recompensas_revertir_apertura('${F.f3.id}')`]) {
        const r = await intentar(uid, `select * from ${f};`);
        assert.equal(r.ok, false, f); assert.match(r.err, /Solo el administrador/);
      }
    }
    const anon = await ejecutarEnsayo(BASE, `set role anon; select public.recompensas_ejecutar_apertura(now(), false);`);
    assert.equal(anon.ok, false); assert.match(anon.err, /permission denied/);
    const interna = await ejecutarEnsayo(BASE, `set role authenticated; select public.recompensas_habilitar_apertura('${F.f6.id}');`);
    assert.equal(interna.ok, false); assert.match(interna.err, /permission denied/);
  });

  test('7. reversión dirigida SIN actividad posterior y reapertura idéntica (antes de activar)', async () => {
    const antes = await saldos(F.f3.id);
    const rv = await jsonAdmin(`select public.recompensas_revertir_apertura('${F.f3.id}');`);
    assert.equal(rv.movimientos, 1); assert.ok(rv.aportes >= 3);
    const vacio = await saldos(F.f3.id); assert.equal(Number(vacio.monedas), 0);
    const r = await jsonAdmin(`select public.recompensas_ejecutar_apertura('${corte}'::timestamptz, true);`);
    assert.equal(r.clientas_por_procesar, 1);
    assert.deepEqual(await saldos(F.f3.id), antes, 'la reapertura reproduce exactamente el saldo y los sellos');
    // Con el programa APAGADO, la actividad posterior (aquí un movimiento) también bloquea la reversión y no borra nada.
    await sql(`insert into public.recompensas_movimientos (cliente_id, tipo, monedas, clasificacion, clave) values ('${F.f8.id}', 'AJUSTE', 1, 1, 'ens-ajuste-f8');`);
    const huellaAntes = await huellas();
    const rechazo = await intentar(ADMIN, `select public.recompensas_revertir_apertura('${F.f8.id}');`);
    assert.equal(rechazo.ok, false); assert.match(rechazo.err, /ya tiene ventas, canjes o movimientos posteriores/);
    assert.deepEqual(await huellas(), huellaAntes);
    await sql(`delete from public.recompensas_movimientos where clave = 'ens-ajuste-f8';`);
    resultados.reversion_sin_actividad = { revertido: rv, reabierta_igual: true, rechazada_con_actividad_programa_apagado: true };
  });

  test('8. activación del programa con el corte de la apertura', async () => {
    await comoAdmin(`select public.recompensas_establecer_activo(true);`);
    const c = await json(`select json_build_object('activo', activo, 'corte_igual', corte = '${corte}'::timestamptz) from public.recompensas_config`);
    assert.equal(c.activo, true); assert.equal(c.corte_igual, true, 'el corte de la configuración sigue siendo el de la copia');
  });

  test('9. decisión A: vinculación posterior habilita UNA sola vez el saldo congelado', async () => {
    // Actividad posterior al corte sin cuenta: no acredita y no cambia el saldo congelado.
    const at = await unaAtencion(F.f6.id, F.sv, 20, null);
    const venta = await vender(CAJERA, F.f6.id, [{ tipo: 'SERVICIO', registro_servicio_id: at, cantidad: 1 }]);
    assert.ok(venta.ok, venta.err);
    assert.equal(Number((await saldos(F.f6.id)).monedas), 0, 'sin cuenta no se acredita');
    await sql(`update public.clientes set cliente_web_id = '${F.cuentaA}' where id = '${F.f6.id}';`);
    const s = await saldos(F.f6.id);
    assert.equal(Number(s.monedas), 40, 'se habilita el saldo congelado al corte (no incluye lo posterior)');
    assert.equal(s.sellos, 3);
    // Desvincular, revincular a la misma cuenta y a otra: sin segunda apertura.
    await sql(`update public.clientes set cliente_web_id = null where id = '${F.f6.id}'; update public.clientes set cliente_web_id = '${F.cuentaA}' where id = '${F.f6.id}'; update public.clientes set cliente_web_id = null where id = '${F.f6.id}'; update public.clientes set cliente_web_id = '${F.cuentaB}' where id = '${F.f6.id}';`);
    assert.equal(Number((await saldos(F.f6.id)).monedas), 40);
    const n = await json(`select json_build_object('aperturas', (select count(*) from public.recompensas_movimientos where cliente_id='${F.f6.id}' and tipo='APERTURA'),
      'sellos_apertura', (select count(*) from public.recompensas_sellos_movs where cliente_id='${F.f6.id}' and tipo='APERTURA'),
      'estado', (select estado from public.recompensas_apertura_espera where cliente_id='${F.f6.id}'))`);
    assert.deepEqual(n, { aperturas: 1, sellos_apertura: 1, estado: 'HABILITADA' });
    // Una clienta SIN saldo congelado que se vincula: nada que habilitar y sin error.
    await sql(`update public.clientes set cliente_web_id = '${F.cuentaA}' where id = '${F.f7.id}';`);
    assert.equal(Number((await saldos(F.f7.id)).monedas), 0);
    resultados.vinculacion_posterior = n;
  });

  test('10. atenciones pendientes de cobro: el servicio anterior al corte no se acredita otra vez; el producto sí', async () => {
    const antes = await saldos(F.f4.id); assert.equal(Number(antes.monedas), 15);
    const v = await vender(CAJERA, F.f4.id, [
      { tipo: 'SERVICIO', registro_servicio_id: F.f4atencion, cantidad: 1 },
      { tipo: 'PRODUCTO', producto_id: F.prod, cantidad: 1 }]);
    assert.ok(v.ok, v.err); F.f4venta = v.venta.venta_id;
    const despues = await saldos(F.f4.id);
    assert.equal(Number(despues.monedas) - Number(antes.monedas), 10, 'solo el producto (80 soles / 40 × 5) acredita; el servicio ya estaba en la apertura');
    const det = await json(`select json_agg(row_to_json(d) order by linea) from (select linea, tipo, incluida_en_apertura from public.recompensas_venta_detalle where venta_id='${F.f4venta}') d`);
    assert.deepEqual(det.map((d) => [d.tipo, d.incluida_en_apertura]), [['SERVICIO', true], ['PRODUCTO', false]]);
    resultados.atencion_pendiente = { antes: antes.monedas, despues: despues.monedas };
  });

  test('11. decisión B: anular una venta histórica no descuenta apertura; las nuevas se revierten una sola vez', async () => {
    // (a) Venta histórica creada por las reglas antiguas (F5) y una venta histórica real de la copia con clienta vinculada.
    const real = await json(`select row_to_json(t) from (select v.id as venta, v.cliente_id as cliente from public.ventas v
      join public.clientes c on c.id = v.cliente_id and c.cliente_web_id is not null
      join public.venta_items i on i.venta_id = v.id and i.tipo = 'SERVICIO'
      where v.estado = 'ACTIVA' and v.id <> '${F.f5venta}' and v.fecha < '${corte}'
        and not exists (select 1 from public.recompensas_movimientos m where m.venta_id = v.id) order by v.id limit 1) t`);
    assert.ok(real, 'hay una venta histórica real sin movimientos en el libro nuevo');
    for (const [cliente, venta] of [[F.f5.id, F.f5venta], [real.cliente, real.venta]]) {
      const antes = await saldos(cliente);
      const r = await intentar(ADMIN, `select public.anular_venta('${venta}');`);
      assert.ok(r.ok, r.err);
      assert.deepEqual(await saldos(cliente), antes, 'la apertura queda intacta al anular una venta histórica');
      const rev = await json(`select to_json(count(*)) from public.recompensas_movimientos where venta_id='${venta}'`);
      assert.equal(rev, 0, 'no se creó ningún movimiento por esa venta');
    }
    // (b) Venta nueva con producto: se acredita y la anulación la revierte exactamente una vez, también si se repite.
    const base = await saldos(F.f1.id);
    const v = await vender(CAJERA, F.f1.id, [{ tipo: 'PRODUCTO', producto_id: F.prod, cantidad: 1 }]);
    assert.ok(v.ok, v.err);
    assert.equal(Number((await saldos(F.f1.id)).monedas) - Number(base.monedas), 10);
    assert.ok((await intentar(ADMIN, `select public.anular_venta('${v.venta.venta_id}');`)).ok);
    const tras = await saldos(F.f1.id);
    assert.equal(Number(tras.monedas), Number(base.monedas), 'solo se revirtió el aporte nuevo; la apertura sigue completa');
    await intentar(ADMIN, `select public.anular_venta('${v.venta.venta_id}');`); // repetir: no debe revertir de nuevo
    assert.equal(Number((await saldos(F.f1.id)).monedas), Number(base.monedas));
    const revs = await json(`select to_json(count(*)) from public.recompensas_movimientos where venta_id='${v.venta.venta_id}' and tipo='VENTA_REVERSION'`);
    assert.equal(revs, 1);
    resultados.anulaciones = { historicas_probadas: 2, reversion_nueva: revs };
  });

  test('12. reversión RECHAZADA cuando ya hay ventas o canjes posteriores', async () => {
    const lista = await jsonAdmin(`select json_object_agg(cliente_id, json_build_object('reversible', reversible, 'motivo', motivo)) from public.recompensas_apertura_reversible() where cliente_id in ('${F.f1.id}', '${F.f4.id}', '${F.f8.id}')`);
    assert.equal(lista[F.f1.id].reversible, false); assert.equal(lista[F.f4.id].reversible, false);
    assert.equal(lista[F.f8.id].reversible, true);
    const antes = await huellas();
    for (const cid of [F.f1.id, F.f4.id]) {
      const r = await intentar(ADMIN, `select public.recompensas_revertir_apertura('${cid}');`);
      assert.equal(r.ok, false); assert.match(r.err, /Recompensas está activo/);
    }
    assert.deepEqual(await huellas(), antes, 'los intentos rechazados no borraron nada');
    // Un canje posterior también bloquea.
    const prem = randomUUID(); const cup = randomUUID();
    await sql(`insert into public.recompensas_catalogo (id, nombre, activo, origen, tipo, valor, alcance, nivel_minimo, costo_basico)
      values ('${prem}', 'TEST ENS premio', true, 'MONEDAS', 'MONTO', 5, 'TODO', 'BASICO', 25);
      insert into public.cupones (id, cliente_id, codigo, origen, valor, tipo_descuento, alcance, nivel_minimo)
      values ('${cup}', '${F.f8.id}', 'ENS${cup.slice(0, 6).toUpperCase()}', 'PROMOCION', 5, 'MONTO_FIJO', 'TODO', 'BASICO');
      insert into public.recompensas_canjes (cliente_id, catalogo_id, clave_idem, origen, costo, nivel_aplicado, cupon_id)
      values ('${F.f8.id}', '${prem}', 'ens-canje-${cup}', 'MONEDAS', 25, 'BASICO', '${cup}');`);
    const conCanje = await jsonAdmin(`select to_json(reversible) from public.recompensas_apertura_reversible() where cliente_id = '${F.f8.id}'`);
    assert.equal(conCanje, false, 'un canje posterior bloquea la reversión aunque no haya otros movimientos');
    const r8 = await intentar(ADMIN, `select public.recompensas_revertir_apertura('${F.f8.id}');`);
    assert.equal(r8.ok, false); assert.match(r8.err, /Recompensas está activo/);
    resultados.reversibilidad = { f1: lista[F.f1.id], f4: lista[F.f4.id], f8: lista[F.f8.id] };
  });

  test('13. recuperación: restaurar la copia previa recupera el estado anterior a la apertura', async () => {
    const posterior = await huellas();
    assert.notDeepEqual(posterior, previa, 'la apertura sí cambió el estado');
    await restaurarBase('/tmp/previa.dump', 'recuperacion');
    const recuperada = await huellas('recuperacion');
    assert.deepEqual(recuperada, previa, 'la base recuperada es idéntica (conteo y huella) a la anterior a la apertura');
    const n = await ejecutarEnsayo('recuperacion', `select count(*) from public.recompensas_movimientos where tipo='APERTURA';`);
    assert.equal(n.out, '0');
    resultados.recuperacion = { tablas_comparadas: TABLAS_HUELLA.length, identica: true };
    mkdirSync(EVIDENCIA, { recursive: true });
    writeFileSync(`${EVIDENCIA}/transicion_resultados.json`, JSON.stringify(resultados, null, 2));
  });
});
