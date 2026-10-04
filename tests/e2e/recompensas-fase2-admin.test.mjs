// Contrato backend de la pantalla Web → Recompensas (src/pages/RecompensasWeb.jsx):
// las mismas sentencias que emite supabase-js, ejecutadas con `set role authenticated`
// y claims simulados. NO es una prueba de interfaz ni de sesión HTTP real.
//   node --test --test-concurrency=1 tests/e2e/recompensas-fase2-admin.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg0;
before(async () => { await h.verificarLocalTest(); cfg0 = await h.configActual(); });
after(async () => { if (cfg0) await h.restaurarConfig(cfg0); });

const auth = (uid, sql) => h.paso(uid, sql, { rol: true });

describe('Administración Web de Recompensas: ADMINISTRADOR', () => {
  test('lee catálogo, protección, canjes, configuración y servicios', async () => {
    for (const t of ['recompensas_catalogo', 'servicios_proteccion', 'recompensas_canjes', 'recompensas_config', 'servicios']) {
      const r = await auth(h.ADMIN, `select count(*) from public.${t};`);
      assert.ok(r.ok, `${t}: ${r.err}`);
    }
  });

  test('crea y edita un premio (nace sin publicar) y guarda protección con upsert', async () => {
    const nombre = `TEST F2 admin ${h.runId}`;
    const ins = await auth(h.ADMIN, `insert into public.recompensas_catalogo (nombre, origen, tipo, valor, costo_basico, activo)
      values ('${nombre}', 'MONEDAS', 'MONTO', 5, 40, false) returning id;`);
    assert.ok(ins.ok, ins.err);
    const id = ins.out.split('\n')[0];
    const upd = await auth(h.ADMIN, `update public.recompensas_catalogo set costo_premium = 30, cupon_vigencia_dias = 20 where id='${id}';`);
    assert.ok(upd.ok, upd.err);
    const fila = await h.json(`select row_to_json(c) from public.recompensas_catalogo c where id='${id}'`);
    assert.equal(fila.activo, false);
    assert.equal(Number(fila.costo_premium), 30);

    const serv = await h.nuevoServicio(30);
    const up = await auth(h.ADMIN, `insert into public.servicios_proteccion (servicio_id, materiales, asistente, otros, actualizado_en)
      values ('${serv}', 5, 5, 0, now())
      on conflict (servicio_id) do update set materiales=excluded.materiales, asistente=excluded.asistente, otros=excluded.otros;`);
    assert.ok(up.ok, up.err);
    assert.equal(Number(await h.json(`select to_json(total) from public.servicios_proteccion where servicio_id='${serv}'`)), 10);
    const del = await auth(h.ADMIN, `delete from public.servicios_proteccion where servicio_id='${serv}';`);
    assert.ok(del.ok, del.err);
    assert.equal(await h.json(`select to_json(count(*)) from public.servicios_proteccion where servicio_id='${serv}'`), 0, 'sin configurar = sin fila');
  });

  test('actualiza tasas y umbrales; no puede editar activo/corte directamente', async () => {
    const ok = await auth(h.ADMIN, `update public.recompensas_config set tasa_serv_monedas = 5, umbral_premium = 50, umbral_vip = 150, actualizado_en = now() where id = 1;`);
    assert.ok(ok.ok, ok.err);
    const directo = await auth(h.ADMIN, `update public.recompensas_config set activo = true where id = 1;`);
    assert.equal(directo.ok, false, 'activo solo cambia por recompensas_establecer_activo()');
    const rpc = await auth(h.ADMIN, `select public.recompensas_establecer_activo(false);`);
    assert.ok(rpc.ok, rpc.err);
  });

  test('restricciones de la base: porcentaje > 100, SERVICIO sin servicio, MONEDAS sin costo', async () => {
    for (const sql of [
      `insert into public.recompensas_catalogo (nombre, origen, tipo, valor, costo_basico) values ('x','MONEDAS','PORCENTAJE',150,10);`,
      `insert into public.recompensas_catalogo (nombre, origen, tipo, valor, costo_basico) values ('x','MONEDAS','SERVICIO',0,10);`,
      `insert into public.recompensas_catalogo (nombre, origen, tipo, valor) values ('x','MONEDAS','MONTO',5);`,
      `insert into public.recompensas_config (id) values (2);`,
      `update public.recompensas_config set umbral_vip = 10, umbral_premium = 50 where id = 1;`,
    ]) {
      const r = await auth(h.ADMIN, sql);
      assert.equal(r.ok, false, sql);
    }
  });
});

describe('Administración Web de Recompensas: otros roles (backend)', () => {
  test('CAJERA, ASISTENTE y clienta no leen ni escriben catálogo, protección ni configuración', async () => {
    const c = await h.nuevaClienta();
    const serv = await h.nuevoServicio(30);
    for (const uid of [h.CAJERA, h.ASISTENTE, c.uid]) {
      for (const sql of [
        `insert into public.recompensas_catalogo (nombre, origen, tipo, valor, costo_basico) values ('hack','MONEDAS','MONTO',5,1);`,
        `insert into public.servicios_proteccion (servicio_id, materiales) values ('${serv}', 1);`,
        `update public.recompensas_config set tasa_serv_monedas = 99 where id = 1;`,
        `select public.recompensas_establecer_activo(true);`,
      ]) {
        const r = await auth(uid, sql);
        // UPDATE bajo RLS filtra filas (no falla): comprobamos el efecto abajo.
        if (!sql.startsWith('update')) assert.equal(r.ok, false, `${uid}: ${sql}`);
      }
      assert.equal((await auth(uid, `select count(*) from public.recompensas_catalogo;`)).out, '0', 'catálogo no visible');
      assert.equal((await auth(uid, `select count(*) from public.servicios_proteccion;`)).out, '0', 'protección no visible');
    }
    const cfg = await h.configActual();
    assert.equal(Number(cfg.tasa_serv_monedas), 5, 'la tasa no cambió');
  });
});
