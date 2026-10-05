// Concurrencia de la apertura histórica: carreras REALES entre sesiones simultáneas (cada una es un psql distinto) en la base
// «transicion» de la instancia desechable. Un rechazo comprobado en secuencia NO demuestra seguridad concurrente: aquí se fuerza el
// entrelazado con un disparador de pausa (solo existe en esta base de ensayo) que detiene una venta o un canje JUSTO antes de
// escribir en el libro, mientras otra sesión intenta revertir, activar o ejecutar.
//
// Variantes del borrador: por defecto el de docs/ (v2). Con ENSAYO_VARIANTE=v1 se usa la API antigua (sin modo definitivo) y se
// omite lo que no existe; el mismo conjunto de invariantes DEBE fallar en v1 (esa es la evidencia del defecto) y pasar en v2.
//   preparar:  ENSAYO_BORRADOR=<ruta> node tests/e2e/ensayo-preparar-transicion.mjs
//   ejecutar:  node --test --test-concurrency=1 tests/e2e/recompensas-concurrencia.ensayo.mjs
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { ejecutarEnsayo, comoEnsayo, verificarDestinoEnsayo } from './ensayo-destino.mjs';

const BASE = 'transicion';
const V1 = process.env.ENSAYO_VARIANTE === 'v1';
const ADMIN = 'f73eb105-8427-47e1-be5a-7078250df55c';
const CAJERA = 'b6e3a07a-c785-41c1-8c30-2b0ec7de5978';
const EVIDENCIA = process.env.ENSAYO_EVIDENCIA ?? 'C:/JaiseQA-Backups/evidencia';
const CORTE_ENSAYO = readFileSync(process.env.ENSAYO_CORTE_ARCHIVO ?? 'C:/JaiseQA-Backups/CORTE.txt', 'utf8').trim().split('|')[1];
const resultados = { variante: V1 ? 'v1' : 'v2' };
const PAUSA = 3000; // ms que se detiene la operación «en vuelo»

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await ejecutarEnsayo(BASE, s); if (!r.ok) throw new Error(r.err); return r.out; };
const json = async (s) => { const o = await sql(s); const l = o.split('\n').filter(Boolean).pop(); return l ? JSON.parse(l) : null; };
// Una sesión: devuelve { ok, out, err, ms } (ms = duración total de esa sesión).
async function sesion(uid, texto) {
  const ini = performance.now();
  const r = await ejecutarEnsayo(BASE, comoEnsayo(uid) + texto);
  return { ...r, ms: Math.round(performance.now() - ini) };
}
const primerJson = (r) => JSON.parse(r.out.split('\n').filter(Boolean)[0]);

async function pausar(clienteId, tabla) {
  await sql(`insert into ensayo_marker.pausa (cliente_id, tabla, seg) values ('${clienteId}', '${tabla}', ${PAUSA / 1000}) on conflict (cliente_id, tabla) do update set seg = excluded.seg;`);
}
async function sinPausa() { await sql(`truncate ensayo_marker.pausa;`); }

const F = {};
async function clienta(nombre, { vinculada = true } = {}) {
  const uid = randomUUID(); const id = randomUUID();
  let s = '';
  if (vinculada) s += `insert into auth.users (id, email) values ('${uid}', 'conc-${uid.slice(0, 8)}@test.local'); insert into public.clientes_web (id, email) values ('${uid}', 'conc-${uid.slice(0, 8)}@test.local');`;
  s += `insert into public.clientes (id, nombre, cliente_web_id) values ('${id}', 'TEST CONC ${nombre}', ${vinculada ? `'${uid}'` : 'null'});`;
  await sql(s);
  return { id, uid };
}
async function servicio(precio) { const id = randomUUID(); await sql(`insert into public.servicios (id, nombre, precio, duracion_min) values ('${id}', 'TEST CONC serv ${id.slice(0, 6)}', ${precio}, 30);`); return id; }
async function atencion(clienteId, servicioId, precio, haceDias = 1) {
  const id = randomUUID();
  await sql(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    values ('${id}', '${ADMIN}', '${servicioId}', '${clienteId}', ${precio}, date_trunc('day', now()) - interval '${haceDias} days' + interval '15 hours', 'ACTIVO');`);
  return id;
}
const saldo = (cid) => json(`select row_to_json(s) from public.recompensas_saldos('${cid}') s;`);
const items = (...xs) => `$j$${JSON.stringify(xs)}$j$::jsonb`;
const vender = (cid, ...its) => sesion(CAJERA, `select row_to_json(t) from public.confirmar_venta('Yape', null, ${items(...its)}, '${cid}'::uuid, 0, 0, null, null, 0) t;`);
// Invariante común: ninguna clienta con apertura puede quedar con actividad que dependía de ella y SIN apertura.
const violaciones = (ids) => json(`select coalesce(json_agg(c.id), '[]'::json) from public.clientes c where c.id = any('{${ids.join(',')}}'::uuid[])
  and not exists (select 1 from public.recompensas_movimientos m where m.cliente_id = c.id and m.tipo = 'APERTURA')
  and (exists (select 1 from public.recompensas_movimientos m where m.cliente_id = c.id and m.tipo in ('VENTA', 'CANJE'))
       or exists (select 1 from public.recompensas_canjes k where k.cliente_id = c.id)
       or exists (select 1 from public.recompensas_venta_detalle d join public.ventas v on v.id = d.venta_id where v.cliente_id = c.id and d.incluida_en_apertura));`);

describe(`Concurrencia de la apertura (${V1 ? 'borrador v1' : 'borrador v2'})`, () => {
  before(async () => {
    verificarDestinoEnsayo(BASE);
    // Disparador de pausa (solo en esta base de ensayo): detiene una operación en vuelo antes de escribir.
    await sql(`create table if not exists ensayo_marker.pausa (cliente_id uuid, tabla text, seg numeric, primary key (cliente_id, tabla));
      create or replace function ensayo_marker.pausar() returns trigger language plpgsql as $f$
      declare v_cliente uuid; v_seg numeric;
      begin
        v_cliente := NEW.cliente_id;
        select seg into v_seg from ensayo_marker.pausa where cliente_id = v_cliente and tabla = TG_TABLE_NAME;
        if v_seg is not null then perform pg_sleep(v_seg); end if;
        return NEW;
      end $f$;
      drop trigger if exists ensayo_pausa on public.recompensas_movimientos;
      create trigger ensayo_pausa before insert on public.recompensas_movimientos for each row execute function ensayo_marker.pausar();
      drop trigger if exists ensayo_pausa on public.ventas;
      create trigger ensayo_pausa before insert on public.ventas for each row execute function ensayo_marker.pausar();`);
    // La base preparada trae 17 aportes de fixtures antiguos (bloquean la apertura): se retiran en la copia desechable.
    await sql(`delete from public.recompensas_apertura_aportes where cliente_id in (select id from public.clientes where nombre like 'TEST F2 %');`);
    F.sv = await servicio(20); F.sv40 = await servicio(40);
    F.prod = randomUUID();
    await sql(`insert into public.productos (id, nombre, precio, costo, stock_actual) values ('${F.prod}', 'TEST CONC prod', 80, 1, 500);`);
    // Sin procesar aún (los toca la apertura): Z1 recibirá una atención NUEVA durante la apertura; Z2 tiene una venta en vuelo.
    F.z1 = await clienta('z1-atencion-durante'); await atencion(F.z1.id, F.sv, 20, 2);
    F.z2 = await clienta('z2-venta-en-vuelo'); F.z2.at = await atencion(F.z2.id, F.sv40, 40, 1);
    // Con apertura previa al ensayo de carreras (se crean antes de la apertura, así que la apertura los incluye).
    F.x = await clienta('x-revertir-vs-venta'); F.x.at = await atencion(F.x.id, F.sv40, 40, 1);
    F.w = await clienta('w-revertir-vs-canje'); for (let i = 1; i <= 6; i += 1) await atencion(F.w.id, F.sv, 20, i + 1); // 6 visitas + 120·0,05 = 12 pts → 60 monedas
    F.v = await clienta('v-revertir-vs-activar'); await atencion(F.v.id, F.sv, 20, 3);
    F.u = await clienta('u-doble-reversion'); await atencion(F.u.id, F.sv, 20, 4);
    F.premio = randomUUID();
    await sql(`insert into public.recompensas_catalogo (id, nombre, activo, origen, tipo, valor, alcance, nivel_minimo, costo_basico)
      values ('${F.premio}', 'TEST CONC premio', true, 'MONEDAS', 'MONTO', 5, 'TODO', 'BASICO', 25);`);
  });

  test('S3. ejecución DEFINITIVA con activación atómica: venta en vuelo, atención nueva y segunda ejecución simultáneas', { skip: V1 && 'la v1 no tiene modo definitivo' }, async () => {
    await sinPausa(); await pausar(F.z2.id, 'ventas');
    // t=0: venta de Z2 en vuelo (pausada dentro de ventas, con el bloqueo de escritura ya tomado).
    const venta = vender(F.z2.id, { tipo: 'SERVICIO', registro_servicio_id: F.z2.at, cantidad: 1 });
    await dormir(600);
    // t≈0,6: la apertura definitiva pide su bloqueo: debe ESPERAR a la venta en vuelo y retener el bloqueo 2 s antes de confirmar.
    const aperturaIni = performance.now();
    const apertura = sesion(ADMIN, `begin; select public.recompensas_ejecutar_apertura(null, true, true); select pg_sleep(2); commit;`);
    await dormir(900);
    const insertar = (id) => sesion(ADMIN, `insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
      values ('${id}', '${ADMIN}', '${F.sv}', '${F.z1.id}', 20, now(), 'ACTIVO');`);
    // t≈1,5 (la apertura aún ESPERA a la venta y no tiene el bloqueo de registro_servicios): una atención TEMPRANA entra sin
    // esperar y, al ser anterior al corte, queda DENTRO de la apertura.
    const tempranaId = randomUUID();
    const temprana = await insertar(tempranaId);
    assert.ok(temprana.ok, temprana.err);
    // t≈PAUSA+0,7: la apertura YA retiene el bloqueo: una atención TARDÍA debe esperar al COMMIT y quedar posterior al corte.
    await dormir(PAUSA + 700 - 900 - 100);
    const nuevaId = randomUUID();
    const nueva = insertar(nuevaId);
    await dormir(300);
    const segunda = sesion(ADMIN, `select public.recompensas_ejecutar_apertura(null, true, false);`);
    const [rv, ra, rn, rs] = await Promise.all([venta, apertura, nueva, segunda]);
    assert.ok(rv.ok, `la venta en vuelo termina bien: ${rv.err}`);
    assert.ok(ra.ok, `la apertura definitiva termina bien: ${ra.err}`);
    const rep = primerJson(ra);
    assert.equal(rep.modo, 'definitivo'); assert.equal(rep.activado, true);
    assert.equal(Number(rep.conciliacion.monedas_escritas_vinculadas), 5 * Number(rep.puntos_antiguos_vinculadas));
    const cfg = await json(`select json_build_object('activo', activo, 'corte', to_char(corte at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'corte_ts', extract(epoch from corte)) from public.recompensas_config`);
    assert.equal(cfg.activo, true);
    assert.ok(cfg.corte > CORTE_ENSAYO, 'el corte definitivo se tomó dentro del bloqueo y NO es el del ensayo');
    assert.ok(apertura && ra.ms >= 2000 + 1000, `la apertura esperó a la venta en vuelo y retuvo el bloqueo (${ra.ms} ms)`);
    assert.ok(rv.ms >= PAUSA - 200 && rv.ms < ra.ms, 'la venta en vuelo terminó ANTES que la apertura (esta la esperó)');
    // La venta en vuelo se confirmó con el programa apagado y su atención quedó DENTRO de la apertura (sin doble cómputo).
    assert.equal(Number((await saldo(F.z2.id)).monedas), 15, 'Z2: apertura de 1 visita + 40·0,05 = 3 puntos → 15 monedas');
    assert.equal(await json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${F.z2.id}' and tipo='VENTA'`), 0);
    // La atención nueva ESPERÓ al COMMIT y quedó posterior al corte: no está en el mapa de aportes.
    assert.ok(rn.ok, rn.err);
    assert.ok(rn.ms >= 1000, `la atención nueva esperó a la apertura (${rn.ms} ms)`);
    const pos = await json(`select json_build_object('despues_del_corte', rs.fecha > (select corte from public.recompensas_config),
      'en_mapa', exists (select 1 from public.recompensas_apertura_aportes a where a.registro_servicio_id = rs.id)) from public.registro_servicios rs where rs.id = '${nuevaId}'`);
    assert.deepEqual(pos, { despues_del_corte: true, en_mapa: false });
    const pre = await json(`select json_build_object('antes_del_corte', rs.fecha < (select corte from public.recompensas_config),
      'en_mapa', exists (select 1 from public.recompensas_apertura_aportes a where a.registro_servicio_id = rs.id)) from public.registro_servicios rs where rs.id = '${tempranaId}'`);
    assert.deepEqual(pre, { antes_del_corte: true, en_mapa: true }, 'la atención temprana (anterior al corte) quedó dentro de la apertura');
    assert.equal(Number((await saldo(F.z1.id)).monedas), 20, 'Z1: 2 visitas + (20+20)·0,05 = 4 puntos → 20 monedas; la tardía no cuenta');
    // La segunda ejecución simultánea se rechaza y no duplica.
    assert.equal(rs.ok, false); assert.match(rs.err, /ya está activo|corte distinto/);
    const dup = await json(`select json_build_object('claves_repetidas', (select count(*) from (select clave from public.recompensas_movimientos group by 1 having count(*) > 1) q),
      'max_por_clienta', (select max(c) from (select count(*) c from public.recompensas_movimientos where tipo='APERTURA' group by cliente_id) q))`);
    assert.deepEqual(dup, { claves_repetidas: 0, max_por_clienta: 1 });
    // Y esa atención nueva, cobrada después, SÍ acredita con las reglas nuevas (programa activo, fuera de la apertura).
    const antes = Number((await saldo(F.z1.id)).monedas);
    const v = await vender(F.z1.id, { tipo: 'SERVICIO', registro_servicio_id: nuevaId, cantidad: 1 });
    assert.ok(v.ok, v.err);
    assert.equal(Number((await saldo(F.z1.id)).monedas) - antes, 5, '20 soles de servicio / 20 × 5');
    resultados.S3 = { apertura_ms: ra.ms, atencion_nueva_esperó_ms: rn.ms, venta_en_vuelo_ms: rv.ms, segunda_rechazada: rs.err.split('\n')[0], corte: cfg.corte };
  });

  test('S1. reversión vs VENTA en vuelo con el programa ACTIVO: no puede quedar actividad sin su apertura', async () => {
    if (V1) { // la v1 no tiene modo definitivo: se ejecuta con el corte del ensayo y se activa aparte
      const r = await sesion(ADMIN, `select public.recompensas_ejecutar_apertura('${CORTE_ENSAYO}'::timestamptz, true); select public.recompensas_establecer_activo(true);`);
      assert.ok(r.ok, r.err);
    }
    await sinPausa(); await pausar(F.x.id, 'recompensas_movimientos');
    assert.equal(Number((await saldo(F.x.id)).monedas), 15);
    const venta = vender(F.x.id, { tipo: 'SERVICIO', registro_servicio_id: F.x.at, cantidad: 1 }, { tipo: 'PRODUCTO', producto_id: F.prod, cantidad: 1 });
    await dormir(800);
    const revertir = sesion(ADMIN, `select public.recompensas_revertir_apertura('${F.x.id}');`);
    const [rv, rr] = await Promise.all([venta, revertir]);
    await sinPausa();
    resultados.S1 = { venta_ok: rv.ok, reversion_ok: rr.ok, reversion_msg: (rr.ok ? rr.out : rr.err).split('\n')[0] };
    assert.ok(rv.ok, `la venta termina: ${rv.err}`);
    assert.deepEqual(await violaciones([F.x.id]), [], 'INVARIANTE: la clienta con venta posterior conserva su apertura');
    assert.equal(rr.ok, false, 'la reversión se rechaza: hay una venta en vuelo y el programa está activo');
    assert.equal(Number((await saldo(F.x.id)).monedas), 25, '15 de apertura + 10 del producto; el servicio no acredita otra vez');
  });

  test('S1b. reversión vs CANJE en vuelo con el programa ACTIVO', async () => {
    await sinPausa(); await pausar(F.w.id, 'recompensas_movimientos');
    assert.equal(Number((await saldo(F.w.id)).monedas), 60);
    const canje = sesion(F.w.uid, `select public.canjear_recompensa('${F.premio}'::uuid, 'conc-${F.w.id}');`);
    await dormir(800);
    const revertir = sesion(ADMIN, `select public.recompensas_revertir_apertura('${F.w.id}');`);
    const [rc, rr] = await Promise.all([canje, revertir]);
    await sinPausa();
    resultados.S1b = { canje_ok: rc.ok, reversion_ok: rr.ok, reversion_msg: (rr.ok ? rr.out : rr.err).split('\n')[0] };
    assert.ok(rc.ok, `el canje termina: ${rc.err}`);
    assert.deepEqual(await violaciones([F.w.id]), [], 'INVARIANTE: la clienta con canje conserva su apertura');
    assert.equal(rr.ok, false);
    assert.equal(Number((await saldo(F.w.id)).monedas), 35, '60 de apertura − 25 del canje');
  });

  test('S2. reversión en curso vs ACTIVACIÓN: la activación espera a que la reversión termine', async () => {
    await sesion(ADMIN, `select public.recompensas_establecer_activo(false);`);
    assert.equal(await json(`select to_json(activo) from public.recompensas_config`), false);
    const reversion = sesion(ADMIN, `begin; select public.recompensas_revertir_apertura('${F.v.id}'); select pg_sleep(2); commit;`);
    await dormir(800);
    const activacion = sesion(ADMIN, `select public.recompensas_establecer_activo(true);`);
    const [rr, ra] = await Promise.all([reversion, activacion]);
    resultados.S2 = { reversion_ms: rr.ms, activacion_ms: ra.ms, reversion_ok: rr.ok };
    assert.ok(rr.ok, rr.err); assert.ok(ra.ok, ra.err);
    assert.ok(ra.ms >= 1500, `la activación esperó a la reversión en curso (${ra.ms} ms)`);
    assert.equal(await json(`select to_json(activo) from public.recompensas_config`), true);
    assert.equal(await json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${F.v.id}' and tipo='APERTURA'`), 0, 'V quedó sin apertura (revertida antes de activar)');
    assert.deepEqual(await violaciones([F.v.id]), []);
  });

  test('S4. dos reversiones simultáneas de la misma clienta: una sola borra, la otra se rechaza', async () => {
    await sesion(ADMIN, `select public.recompensas_establecer_activo(false);`);
    const a = sesion(ADMIN, `begin; select public.recompensas_revertir_apertura('${F.u.id}'); select pg_sleep(1.5); commit;`);
    await dormir(500);
    const b = sesion(ADMIN, `select public.recompensas_revertir_apertura('${F.u.id}');`);
    const [ra, rb] = await Promise.all([a, b]);
    resultados.S4 = { a_ok: ra.ok, b_ok: rb.ok, b_msg: (rb.ok ? rb.out : rb.err).split('\n')[0] };
    assert.equal([ra, rb].filter((r) => r.ok).length, 1, 'exactamente una reversión tiene éxito');
    assert.match((ra.ok ? rb : ra).err, /no tiene apertura/);
    assert.equal(await json(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${F.u.id}' and tipo='APERTURA'`), 0);
    mkdirSync(EVIDENCIA, { recursive: true });
    writeFileSync(`${EVIDENCIA}/concurrencia_${resultados.variante}.json`, JSON.stringify(resultados, null, 2));
  });
});
