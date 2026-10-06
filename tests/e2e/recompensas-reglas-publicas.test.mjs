// Lectura mínima y pública de las reglas vigentes de Recompensas (migración 20261005000004). Solo Supabase Local TEST.
//
// NIVEL DE EVIDENCIA: SQL con `set role anon` / `set role authenticated` dentro del contenedor local. Prueba EXECUTE, el contenido de
// la función y que no concede acceso a recompensas_config; NO es una sesión HTTP real (la lectura HTTP sin sesión se probó en la
// instancia desechable: ensayo-ui/coherencia-recompensas.ensayo.spec.mjs).
//
// Cada caso con el programa ACTIVO se ejecuta dentro de una transacción con ROLLBACK: la configuración de QA no se modifica jamás
// (el último caso lo comprueba con la huella completa de la fila, incluida actualizado_en). Recompensas sigue apagado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

const COLUMNAS = ['activo', 'tasa_serv_monedas', 'tasa_serv_soles', 'tasa_prod_monedas', 'tasa_prod_soles', 'umbral_premium', 'umbral_vip', 'sellos_max', 'sellos_por_premio'];
let huella0;
const huella = () => h.json(`select to_json(md5(x::text)) from public.recompensas_config x where id = 1;`);

before(async () => { await h.verificarLocalTest(); huella0 = await huella(); });
after(async () => { assert.equal(await huella(), huella0, 'la configuración de QA no debe cambiar'); });

// Ejecuta `consulta` con un rol dentro de una transacción que SIEMPRE se revierte, con la configuración indicada ya aplicada.
async function leer(rol, { config = '', consulta = 'select row_to_json(r) from public.recompensas_reglas_publicas() r' } = {}) {
  const r = await h.admin(`begin;
    ${config}
    set local role ${rol};
    ${consulta};
    rollback;`);
  if (!r.ok) throw new Error(r.err);
  return r.out.split('\n').filter((l) => l.startsWith('{') || l.startsWith('[')).map((l) => JSON.parse(l));
}
const ACTIVAR = `update public.recompensas_config set activo = true, tasa_serv_monedas = 3, tasa_serv_soles = 25, tasa_prod_monedas = 2,
  tasa_prod_soles = 16, umbral_premium = 30, umbral_vip = 90, sellos_max = 12, sellos_por_premio = 4 where id = 1;`;

test('programa APAGADO (estado real de QA): activo=false y TODO lo demás nulo, para anon y authenticated', async () => {
  const cfg = await h.configActual();
  assert.equal(cfg.activo, false, 'precondición: Recompensas apagado en QA');
  for (const rol of ['anon', 'authenticated']) {
    const [fila] = await leer(rol);
    assert.deepEqual(fila, Object.fromEntries(COLUMNAS.map((c) => [c, c === 'activo' ? false : null])), rol);
  }
});

test('programa ACTIVO (transacción revertida): devuelve las cifras vigentes a anon y a authenticated', async () => {
  for (const rol of ['anon', 'authenticated']) {
    const [fila] = await leer(rol, { config: ACTIVAR });
    assert.deepEqual(fila, {
      activo: true, tasa_serv_monedas: 3, tasa_serv_soles: 25, tasa_prod_monedas: 2, tasa_prod_soles: 16,
      umbral_premium: 30, umbral_vip: 90, sellos_max: 12, sellos_por_premio: 4,
    }, rol);
  }
});

test('expone EXACTAMENTE las columnas necesarias: ni costos, ni protección, ni corte, ni fechas, ni datos de clientas', async () => {
  const [fila] = await leer('anon', { config: ACTIVAR });
  assert.deepEqual(Object.keys(fila), COLUMNAS);
  const firma = await h.json(`select to_json(pg_get_function_result('public.recompensas_reglas_publicas()'::regprocedure));`);
  for (const prohibida of ['corte', 'actualizado', 'costo', 'proteccion', 'asistente', 'cliente', 'saldo', 'venta']) {
    assert.ok(!firma.includes(prohibida), `la firma no debe contener «${prohibida}»: ${firma}`);
  }
});

test('anon NO obtiene acceso a recompensas_config por esta vía (la función no abre la tabla)', async () => {
  const r = await h.admin(`begin; set local role anon; select count(*) from public.recompensas_config; rollback;`);
  assert.equal(r.ok, false);
  assert.match(r.err, /permission denied/i);
  const r2 = await h.admin(`begin; set local role anon; select count(*) from public.recompensas_catalogo; rollback;`);
  assert.equal(r2.ok, false, 'tampoco el catálogo administrativo');
});

test('permisos de la función: EXECUTE solo para anon, authenticated y service_role (no PUBLIC); SECURITY DEFINER con search_path fijo', async () => {
  const f = await h.json(`select json_build_object('definer', prosecdef, 'volatilidad', provolatile, 'config', proconfig, 'acl', proacl::text[])
    from pg_proc where oid = 'public.recompensas_reglas_publicas()'::regprocedure;`);
  assert.equal(f.definer, true);
  assert.equal(f.volatilidad, 's', 'STABLE (solo lectura)');
  assert.ok(f.config.some((c) => c.startsWith('search_path=')), JSON.stringify(f.config));
  const quienes = f.acl.map((a) => a.split('=')[0]).sort();
  assert.deepEqual(quienes, ['anon', 'authenticated', 'postgres', 'service_role']);
  assert.ok(!f.acl.some((a) => a.startsWith('=')), 'sin EXECUTE para PUBLIC');
});

test('es de SOLO LECTURA: ejecutarla no cambia ni una fila de la configuración (huella completa)', async () => {
  const antes = await huella();
  await leer('anon');
  await leer('authenticated', { config: ACTIVAR });
  assert.equal(await huella(), antes);
});
