// Lectores del portal (mis_puntos, mi_fidelizacion, mis_cupones, catálogo público).
// Solo Supabase Local TEST. SQL con `set role authenticated/anon` + claims simulados:
// NO es una prueba de interfaz ni de sesión HTTP real.
//   node --test --test-concurrency=1 tests/e2e/recompensas-fase2-lectores.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg0, legacy;
before(async () => {
  await h.verificarLocalTest();
  cfg0 = await h.configActual();
  legacy = await h.json(`select row_to_json(c) from public.config_puntos c where id=1;`);
});
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const como = (uid, sql) => h.paso(uid, sql, { rol: true });
const una = async (uid, fn) => JSON.parse((await como(uid, `select row_to_json(t) from public.${fn}() t;`)).out);

describe('Programa apagado: los lectores no cambian', () => {
  before(async () => { await h.activar(false); });

  test('mis_puntos y mi_fidelizacion siguen la fórmula antigua', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(40);
    await h.admin(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
      select gen_random_uuid(), '${h.ADMIN}', '${serv}', '${c.clienteId}', 40, now() - (g || ' days')::interval, 'ACTIVO' from generate_series(1, 7) g;`);
    await h.admin(`update public.clientes set puntos_bono = 2 where id='${c.clienteId}'`);
    const p = await una(c.uid, 'mis_puntos');
    const esperado = Math.floor(7 * Number(legacy.puntos_por_visita) + 280 * Number(legacy.puntos_por_sol_gastado)) + 2;
    assert.equal(p.puntos, esperado);
    assert.equal(p.visitas, 7);
    const f = await una(c.uid, 'mi_fidelizacion');
    assert.equal(f.visitas_totales, 7);
    assert.equal(f.sellos_actuales, 2);
    assert.equal(f.recompensas_disponibles, 1);
  });

  test('con el programa apagado el libro nuevo no se refleja aunque tenga datos', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 500, 500);
    await h.darSellos(c.clienteId, 12);
    assert.equal((await una(c.uid, 'mis_puntos')).puntos, 0);
    assert.equal((await una(c.uid, 'mi_fidelizacion')).sellos_actuales, 0);
  });
});

describe('Programa activo: coherencia con el libro', () => {
  before(async () => { await h.activar(true); });

  test('mis_puntos: puntos = monedas disponibles; el nivel sale de la clasificación y gastar no lo baja', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 120.75, 120.75);
    let p = await una(c.uid, 'mis_puntos');
    assert.equal(p.puntos, 120);
    assert.equal(p.nivel, 'PREMIUM');
    assert.equal(p.umbral_premium, 50);
    assert.equal(p.umbral_vip, 150);
    assert.equal(p.puntos_para_siguiente, 30);
    await h.darMonedas(c.clienteId, -100, 0); // gasto
    p = await una(c.uid, 'mis_puntos');
    assert.equal(p.puntos, 20);
    assert.equal(p.nivel, 'PREMIUM', 'gastar monedas no baja el nivel');
    assert.equal(p.puntos_para_siguiente, 30);
    const s = await una(c.uid, 'mi_saldo_recompensas');
    assert.equal(Number(s.clasificacion), 120.75);
    assert.equal(Number(s.monedas), 20.75);
  });

  test('saldo negativo: no se trunca a cero', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, -15, 0);
    assert.equal((await una(c.uid, 'mis_puntos')).puntos, -15);
    assert.equal(Number((await una(c.uid, 'mi_saldo_recompensas')).monedas), -15);
  });

  test('mi_fidelizacion: sellos dentro de la tarjeta de 5, también con negativos y heredados > 20', async () => {
    for (const [sellos, actuales, disponibles] of [[0, 0, 0], [4, 4, 0], [7, 2, 1], [20, 0, 4], [35, 0, 7], [-1, 4, 0], [-5, 0, 0]]) {
      const c = await h.nuevaClienta();
      if (sellos !== 0) await h.darSellos(c.clienteId, sellos);
      const f = await una(c.uid, 'mi_fidelizacion');
      assert.equal(f.sellos_actuales, actuales, `${sellos} sellos`);
      assert.equal(f.recompensas_disponibles, disponibles, `${sellos} sellos`);
      assert.equal(f.visitas_por_recompensa, 5);
      assert.equal((await una(c.uid, 'mi_saldo_recompensas')).sellos, sellos);
    }
  });

  test('la clienta ve solo lo suyo: aislamiento entre dos cuentas', async () => {
    const a = await h.nuevaClienta(), b = await h.nuevaClienta();
    await h.darMonedas(a.clienteId, 80); await h.darMonedas(b.clienteId, 5);
    assert.equal((await una(a.uid, 'mis_puntos')).puntos, 80);
    assert.equal((await una(b.uid, 'mis_puntos')).puntos, 5);
    const ca = await h.nuevoCupon(a.clienteId, { valor: 5 });
    const mb = JSON.parse((await como(b.uid, `select coalesce(json_agg(t), '[]') from public.mis_cupones() t;`)).out);
    assert.equal(mb.some(x => x.id === ca.id), false);
  });

  test('mis_cupones devuelve condiciones congeladas, vigencia y vencido; anon no puede leerlo', async () => {
    const c = await h.nuevaClienta();
    await h.darMonedas(c.clienteId, 200);
    const premio = await h.nuevoPremio({ costoBasico: 30, tipo: 'PORCENTAJE', valor: 15, alcance: 'SERVICIOS', vigenciaDias: 10 });
    await h.admin(`update public.recompensas_catalogo set minimo_compra = 50, tope = 12 where id='${premio}'`);
    assert.ok((await como(c.uid, `select * from public.canjear_recompensa('${premio}', 'lec1');`)).ok);
    await h.admin(`update public.recompensas_catalogo set minimo_compra = 999, tope = 1, nombre = 'cambiado' where id='${premio}'`);
    const todos = JSON.parse((await como(c.uid, `select json_agg(t) from public.mis_cupones() t;`)).out);
    const k = todos.find(x => x.origen === 'RECOMPENSA_MONEDAS');
    assert.ok(k, 'cupón emitido visible');
    assert.equal(Number(k.minimo_compra), 50, 'conserva el mínimo con el que se emitió');
    assert.equal(Number(k.tope), 12);
    assert.equal(k.alcance, 'SERVICIOS');
    assert.notEqual(k.nombre_premio, 'cambiado');
    assert.equal(k.vencido, false);
    assert.ok(k.vigente_hasta);
    assert.equal(Number(k.costo_aplicado), 30);
    await h.admin(`update public.cupones set vigente_hasta = now() - interval '1 day' where id='${k.id}'`);
    const v = JSON.parse((await como(c.uid, `select json_agg(t) from public.mis_cupones() t where id='${k.id}';`)).out)[0];
    assert.equal(v.vencido, true);
    const anon = await h.admin(`set role anon; select * from public.mis_cupones();`);
    assert.equal(anon.ok, false);
  });
});

describe('Catálogo público (QA-037): exposición mínima', () => {
  test('con el programa apagado no devuelve nada, ni siquiera lo publicado', async () => {
    await h.activar(false);
    const p = await h.nuevoPremio({ costoBasico: 10 });
    const r = await h.admin(`set role anon; select count(*) from public.catalogo_recompensas_publico() where id='${p}';`);
    assert.ok(r.ok, r.err);
    assert.equal(r.out, '0');
  });

  test('con el programa activo: solo publicados, sin sesión, sin datos personales ni protección', async () => {
    await h.activar(true);
    const serv = await h.nuevoServicio(30, { materiales: 5, asistente: 5 });
    const sinProt = await h.nuevoServicio(30);
    const publicado = await h.nuevoPremio({ costoBasico: 20, costoVip: 10, tipo: 'SERVICIO', servicioId: serv });
    const mitad = await h.nuevoPremio({ costoBasico: 20, tipo: 'SERVICIO', servicioId: sinProt });
    const oculto = await h.nuevoPremio({ activo: false, costoBasico: 20 });
    const r = await h.admin(`set role anon; select json_agg(t) from public.catalogo_recompensas_publico() t;`);
    assert.ok(r.ok, r.err);
    const filas = JSON.parse(r.out);
    const f = filas.find(x => x.id === publicado);
    assert.ok(f);
    assert.equal(filas.some(x => x.id === oculto), false, 'lo no publicado no se expone');
    assert.equal(f.regla_servicio, 'PISO');
    assert.equal(filas.find(x => x.id === mitad).regla_servicio, 'MITAD');
    assert.equal(Number(f.costo_basico), 20);
    assert.equal(Number(f.costo_vip), 10);
    const columnas = Object.keys(f);
    for (const prohibida of ['materiales', 'asistente', 'otros', 'total', 'proteccion', 'pago_minimo', 'cliente_id', 'canjeable', 'cupo_global', 'saldo'])
      assert.ok(!columnas.includes(prohibida), `no debe exponer ${prohibida}`);
    // sin sesión no existe ninguna lectura personal ni canje
    for (const fn of ['mis_puntos()', 'mi_fidelizacion()', 'mi_saldo_recompensas()', 'mis_movimientos_recompensas()', 'mis_sellos_recompensas()'])
      assert.equal((await h.admin(`set role anon; select * from public.${fn};`)).ok, false, fn);
  });
});
