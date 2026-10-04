// Simulación de la transición ×5 (SOLO LECTURA). Supabase Local TEST, datos ficticios.
// Ejecutar en serie con los demás archivos de Fase 2:
//   node --test --test-concurrency=1 tests/e2e/recompensas-fase2-transicion.test.mjs
// Nivel de evidencia: SQL con `set role authenticated` + claims simulados (no HTTP real).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg, base;
before(async () => {
  await h.verificarLocalTest();
  cfg = await h.json(`select row_to_json(c) from public.config_puntos c where id=1;`);
  base = await estado();
});

const sim = async (clienteId) => {
  const r = await h.paso(h.ADMIN, `select row_to_json(t) from public.recompensas_simular_transicion() t where cliente_id='${clienteId}';`, { rol: true });
  assert.ok(r.ok, r.err);
  return JSON.parse(r.out);
};
const resumen = async () => {
  const r = await h.paso(h.ADMIN, `select public.recompensas_simular_transicion_resumen();`, { rol: true });
  assert.ok(r.ok, r.err);
  return JSON.parse(r.out);
};
const estado = () => h.json(`select jsonb_build_object(
  'mov', (select count(*) from public.recompensas_movimientos),
  'sellos', (select count(*) from public.recompensas_sellos_movs),
  'aportes', (select count(*) from public.recompensas_apertura_aportes),
  'cfg', (select row_to_json(c) from public.recompensas_config c where id=1),
  'bono', (select coalesce(sum(puntos_bono),0) from public.clientes),
  'ventas', (select count(*) from public.ventas));`);

// Fórmula antigua, calculada de forma independiente en JS.
const puntosAntiguos = (visitas, gastado, bono) =>
  Math.floor(visitas * Number(cfg.puntos_por_visita) + gastado * Number(cfg.puntos_por_sol_gastado)) + bono;
const nivel = (p, k = 1) => p >= Number(cfg.umbral_vip) * k ? 'VIP' : p >= Number(cfg.umbral_premium) * k ? 'PREMIUM' : 'BASICO';

async function clientaConHistoria({ dias, precio, bono = 0, reclamadas = 0, vinculada = true, atenciones = dias }) {
  const c = await h.nuevaClienta({ vinculada });
  const serv = await h.nuevoServicio(precio);
  if (atenciones > 0) {
    const r = await h.admin(`insert into public.registro_servicios (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
      select gen_random_uuid(), '${h.ADMIN}', '${serv}', '${c.clienteId}', ${precio},
             now() - (g || ' days')::interval, 'ACTIVO' from generate_series(1, ${atenciones}) g;`);
    assert.ok(r.ok, r.err);
  }
  await h.admin(`update public.clientes set puntos_bono=${bono}, fidelizacion_recompensas_reclamadas=${reclamadas} where id='${c.clienteId}'`);
  return c;
}

describe('Simulación ×5: reconciliación contra la fórmula antigua', () => {
  test('puntos ×5, aportes que suman exacto y nivel conservado', async () => {
    for (const [dias, precio, bono] of [[0, 10, 0], [3, 12.5, 2], [7, 40, 0], [12, 33.33, 1], [30, 9.99, 5]]) {
      const c = await clientaConHistoria({ dias, precio, bono });
      const s = await sim(c.clienteId);
      const esperado = puntosAntiguos(dias, dias * precio, bono);
      assert.equal(s.puntos_antiguos, esperado, `antiguos (${dias} días, S${precio})`);
      assert.equal(Number(s.monedas_apertura), esperado * 5);
      assert.equal(Number(s.clasificacion_inicial), esperado * 5, 'clasificación inicial separada pero igual al saldo de apertura');
      const suma = Number(s.aporte_visitas) + Number(s.aporte_atenciones) + Number(s.aporte_bono) + Number(s.aporte_redondeo);
      assert.ok(Math.abs(suma - esperado) < 1e-6, `aportes ${suma} vs ${esperado}`);
      assert.ok(Number(s.aporte_redondeo) <= 0 && Number(s.aporte_redondeo) > -1, 'redondeo global visible');
      assert.equal(s.nivel_antiguo, nivel(esperado));
      assert.equal(s.nivel_nuevo, s.nivel_antiguo, 'el nivel se conserva');
    }
  });

  test('bordes de nivel con los umbrales reales ×5 (se conserva el progreso)', async () => {
    const u1 = Number(cfg.umbral_premium), u2 = Number(cfg.umbral_vip);
    for (const p of [u1 - 1, u1, u2 - 1, u2]) {
      const c = await clientaConHistoria({ dias: 0, precio: 10, bono: p, atenciones: 0 });
      const s = await sim(c.clienteId);
      assert.equal(s.puntos_antiguos, p);
      assert.equal(s.nivel_antiguo, nivel(p));
      assert.equal(s.nivel_nuevo, nivel(p));
      assert.equal(Number(s.monedas_apertura), p * 5);
    }
  });

  test('el bono manual y las atenciones sin cobrar quedan atribuidos; los productos no suman', async () => {
    const c = await clientaConHistoria({ dias: 4, precio: 20, bono: 3 });
    const p = await h.nuevoProducto(500);
    await h.vender({ clienteId: c.clienteId, items: [h.itemProducto(p)] });
    const s = await sim(c.clienteId);
    assert.equal(Number(s.aporte_bono), 3);
    assert.equal(s.atenciones_sin_cobrar, 4);
    assert.ok(s.anomalias.includes('ATENCIONES_PENDIENTES_DE_COBRO'));
    assert.equal(s.puntos_antiguos, puntosAntiguos(4, 80, 3), 'la compra de productos no cambia los puntos antiguos');
  });
});

describe('Simulación ×5: sellos, anomalías y casos no atribuibles', () => {
  test('sellos pendientes = visitas − 5·reclamadas, íntegros aunque superen 20', async () => {
    for (const [visitas, reclamadas] of [[0, 0], [4, 0], [5, 0], [20, 0], [25, 0], [35, 0], [35, 2], [12, 1]]) {
      const c = await clientaConHistoria({ dias: visitas, precio: 10, reclamadas, atenciones: visitas });
      const s = await sim(c.clienteId);
      assert.equal(s.visitas, visitas);
      assert.equal(s.reclamadas, reclamadas);
      assert.equal(s.sellos_pendientes, visitas - 5 * reclamadas, `${visitas} visitas, ${reclamadas} reclamadas`);
      assert.equal(s.anomalias.includes('SELLOS_HEREDADOS_MAYOR_20'), visitas - 5 * reclamadas > 20);
    }
  });

  test('reclamadas que superan las visitas se reportan, no se corrigen ni se truncan', async () => {
    const c = await clientaConHistoria({ dias: 3, precio: 10, reclamadas: 2 });
    const s = await sim(c.clienteId);
    assert.equal(s.sellos_pendientes, -7);
    assert.ok(s.anomalias.includes('RECLAMADAS_SUPERAN_VISITAS'));
  });

  test('clientas sin cuenta web con puntos se reportan como decisión pendiente y no suman al total convertible', async () => {
    const c = await clientaConHistoria({ dias: 5, precio: 30, vinculada: false });
    const s = await sim(c.clienteId);
    assert.equal(s.vinculada, false);
    assert.ok(s.anomalias.includes('SIN_CUENTA_WEB_CON_PUNTOS'));
    const r = await resumen();
    assert.ok(r.sin_cuenta_web_con_puntos >= 1);
    assert.ok(r.puntos_sin_cuenta_web >= s.puntos_antiguos);
  });

  test('ventas históricas con servicios se cuentan (candidatas a anulación posterior al corte)', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(40);
    const at = await h.nuevaAtencion(c.clienteId, serv, 40);
    const v = await h.vender({ clienteId: c.clienteId, items: [h.itemServicio(at)] });
    assert.ok(v.ok, v.err);
    assert.equal((await sim(c.clienteId)).ventas_con_servicios, 1);
  });
});

describe('Simulación ×5: solo lectura, idempotencia y permisos', () => {
  test('no escribe nada y repetirla da el mismo resultado', async () => {
    const antes = await estado();
    const a = await resumen();
    const b = await resumen();
    assert.deepEqual(a, b, 'misma simulación, mismo resultado');
    assert.deepEqual(await estado(), antes, 'ninguna tabla cambió');
    assert.equal(a.solo_lectura, true);
    assert.equal(a.ya_hay_apertura, false, 'no existe ninguna apertura');
  });

  test('reconciliación total del resumen', async () => {
    const r = await resumen();
    assert.equal(r.conciliacion_x5_ok, true);
    assert.equal(r.conciliacion_aportes_ok, true);
    assert.equal(r.nivel_conservado_en_todas, true);
    assert.equal(Number(r.monedas_apertura_vinculadas), 5 * Number(r.puntos_antiguos_vinculadas));
    assert.deepEqual(r.umbrales.efectivos_x5, [Number(cfg.umbral_premium) * 5, Number(cfg.umbral_vip) * 5]);
    assert.match(r.exposicion_economica, /PENDIENTE/);
  });

  test('solo ADMINISTRADOR puede simular; CAJERA, ASISTENTE, clienta y anon no', async () => {
    const c = await h.nuevaClienta();
    for (const uid of [h.CAJERA, h.ASISTENTE, c.uid]) {
      const r = await h.paso(uid, `select count(*) from public.recompensas_simular_transicion();`, { rol: true });
      assert.equal(r.ok, false);
      assert.match(r.err, /Solo el administrador/);
      const r2 = await h.paso(uid, `select public.recompensas_simular_transicion_resumen();`, { rol: true });
      assert.equal(r2.ok, false);
    }
    const anon = await h.admin(`set role anon; select count(*) from public.recompensas_simular_transicion();`);
    assert.equal(anon.ok, false);
  });

  test('la simulación no activa el programa ni crea aportes de apertura', async () => {
    const e = await estado();
    assert.equal(e.aportes, base.aportes, 'la simulación no crea aportes (los previos son fixtures de otras pruebas)');
    const mov = await h.json(`select to_json(count(*)) from public.recompensas_movimientos where tipo='APERTURA'`);
    assert.equal(mov, 0);
  });
});
