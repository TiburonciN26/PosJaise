// Pruebas aisladas (sin Docker ni base de datos) de la decisión de éxito/fallo del ensayo de respaldo:
// node --test tests/e2e/ensayo-respaldo-procedimiento.test.mjs
// Reproducen lo que Codex observó en memoria (el script terminaba sin error con restauración en código 1, datos distintos o
// pg_dumpall fallido) y los demás requisitos: controles negativos, clasificación de errores de roles y limpieza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarResultado, codigoDeSalida, clasificarErroresRoles, clasificarErroresSinRoles, sinOtorgante, ejecutarConLimpieza, CATEGORIAS_CONTRASTE } from './ensayo-respaldo-nucleo.mjs';

// Un resultado EXITOSO realista (misma forma que escribe el script).
const exitoso = () => ({
  mismo_mayor: true,
  pasos: {
    exportacion: { codigo: 0, bytes: 855011, sha256: 'a'.repeat(64) },
    lectura: { codigo: 0, lineas: 1230, entradas_acl: 230, alter_owner: 230, entrada_schema_public_omitida: 1 },
    roles: { codigo: 0, lineas_create_role: 16, contiene_contrasenas: false, dump_contiene_roles: false, roles_en_origen: new Array(16).fill('r') },
    restauracion_con_roles: { codigo: 0, diferencias: [] },
    contraste_sin_propietarios: { codigo: 0, categorias_que_difieren: [...CATEGORIAS_CONTRASTE] },
    restauracion_sin_roles: { codigo: 1, errores_rol_inexistente: 455 },
    restauracion_cluster_preparado: {
      preparacion_roles: { codigo_psql: 0, errores_total: 24, por_categoria: { rol_preexistente: 1, atributos_preexistente: 1, membresia_con_otorgante: 22 }, inesperados: [], reparacion: { aplicadas: 22, codigo: 0 } },
      verificacion_roles: { pertenencias_distintas: [], atributos_distintos: ['postgres'], atributos_distintos_esperados: ['postgres'] },
      roles_en_destino_despues: 16, codigo: 0, diferencias: [],
    },
    limpieza: { errores: [] },
  },
});
const con = (mutar) => { const r = exitoso(); mutar(r); return r; };
const fallos = (mutar) => evaluarResultado(con(mutar));
const unFallo = (mutar, patron) => { const f = fallos(mutar); assert.ok(f.length > 0, 'debe haber al menos un fallo'); assert.ok(f.some((x) => patron.test(x)), `ningún fallo coincide con ${patron}: ${f.join(' / ')}`); };

test('camino exitoso: sin fallos y código de salida 0', () => {
  const f = evaluarResultado(exitoso());
  assert.deepEqual(f, []);
  assert.equal(codigoDeSalida({ fallos: f, error: null }), 0);
});

test('Codex 1: la restauración devuelve código 1 → fallo y salida distinta de cero', () => {
  unFallo((r) => { r.pasos.restauracion_con_roles = { codigo: 1, salida: 'pg_restore: error: could not execute query' }; }, /restauración con roles: pg_restore terminó con código 1/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.codigo = 1; delete r.pasos.restauracion_cluster_preparado.diferencias; }, /clúster preparado: pg_restore terminó con código 1/);
  assert.equal(codigoDeSalida({ fallos: fallos((r) => { r.pasos.restauracion_con_roles.codigo = 1; }) }), 1);
});

test('Codex 2: la comparación detecta datos distintos → fallo', () => {
  unFallo((r) => { r.pasos.restauracion_con_roles.diferencias = ['datos']; }, /restauración con roles: difieren datos/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.diferencias = ['politicas', 'datos']; }, /clúster preparado: difieren politicas, datos/);
  unFallo((r) => { delete r.pasos.restauracion_con_roles.diferencias; }, /no se comparó la huella/);
});

test('Codex 3: pg_dumpall falla → fallo (también si no hay CREATE ROLE)', () => {
  unFallo((r) => { r.pasos.roles.codigo = 1; r.pasos.roles.error = 'permission denied'; }, /pg_dumpall terminó con código 1/);
  unFallo((r) => { r.pasos.roles.lineas_create_role = 0; }, /ningún CREATE ROLE/);
  unFallo((r) => { r.pasos.roles.contiene_contrasenas = true; }, /contiene contraseñas/);
  unFallo((r) => { r.pasos.roles.dump_contiene_roles = true; }, /contiene roles/);
});

test('exportación y lectura: código, archivo vacío, sin sha256, sin ACL/OWNER, sin omitir public', () => {
  unFallo((r) => { r.pasos.exportacion.codigo = 1; }, /pg_dump terminó con código 1/);
  unFallo((r) => { r.pasos.exportacion.bytes = 0; }, /archivo está vacío/);
  unFallo((r) => { r.pasos.exportacion.sha256 = ''; }, /sha256/);
  unFallo((r) => { r.pasos.lectura.codigo = 1; }, /pg_restore --list terminó con código 1/);
  unFallo((r) => { r.pasos.lectura.entradas_acl = 0; }, /ACL/);
  unFallo((r) => { r.pasos.lectura.alter_owner = 0; }, /OWNER TO/);
  unFallo((r) => { r.pasos.lectura.entrada_schema_public_omitida = 0; }, /SCHEMA - public/);
  unFallo((r) => { r.mismo_mayor = false; }, /mismo mayor/);
});

test('controles negativos: deben fallar COMO se espera; si no fallan, el ensayo falla', () => {
  // «sin roles» debe fallar y con «role … does not exist».
  unFallo((r) => { r.pasos.restauracion_sin_roles = { codigo: 0, errores_rol_inexistente: 0 }; }, /NO falló \(el control no discrimina\)/);
  unFallo((r) => { r.pasos.restauracion_sin_roles = { codigo: 1, errores_rol_inexistente: 0 }; }, /no hubo errores «role … does not exist»/);
  // «sin propietarios» debe restaurar y perder exactamente las 6 categorías.
  unFallo((r) => { r.pasos.contraste_sin_propietarios = { codigo: 0, categorias_que_difieren: [] }; }, /debían diferir/);
  unFallo((r) => { r.pasos.contraste_sin_propietarios.categorias_que_difieren = CATEGORIAS_CONTRASTE.slice(1); }, /debían diferir/);
  unFallo((r) => { r.pasos.contraste_sin_propietarios.categorias_que_difieren = [...CATEGORIAS_CONTRASTE, 'datos']; }, /difiere algo no esperado \(datos\)/);
  unFallo((r) => { r.pasos.contraste_sin_propietarios = { codigo: 1 }; }, /debía terminar y terminó con código 1/);
});

test('fallo deliberado ≠ fallo inesperado: «sin roles» con código 1 NO es un fallo; el mismo código 1 en una restauración real sí', () => {
  assert.deepEqual(evaluarResultado(exitoso()), []); // restauracion_sin_roles.codigo = 1 está en el camino exitoso
  unFallo((r) => { r.pasos.restauracion_con_roles.codigo = 1; }, /restauración con roles/);
});

const SQL = [
  '--', 'CREATE ROLE anon;', 'ALTER ROLE anon WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;', // 1-3
  'CREATE ROLE postgres;', 'ALTER ROLE postgres WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;', // 4-5
  'GRANT anon TO authenticator WITH INHERIT FALSE GRANTED BY supabase_admin;', // 6
  'GRANT anon TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;', // 7
  'DROP ROLE anon;', // 8 (no es de pg_dumpall; sirve para probar un error inesperado)
];
const e = (n, msg) => `psql:/tmp/respaldo-ensayo/roles.sql:${n}: ERROR:  ${msg}`;

test('clasificación de los errores de roles: cada uno explicado por su sentencia', () => {
  const lineas = [
    e(4, 'role "postgres" already exists'),
    e(5, 'permission denied to alter role'),
    e(6, 'permission denied to grant privileges as role "supabase_admin"'),
    e(7, 'permission denied to grant privileges as role "supabase_admin"'),
  ];
  const c = clasificarErroresRoles(lineas, ['postgres'], SQL);
  assert.deepEqual(c.inesperados, []);
  assert.deepEqual(c.porCategoria, { rol_preexistente: 1, atributos_preexistente: 1, membresia_con_otorgante: 2 });
  assert.equal(c.sentenciasPorReparar.length, 2);
  assert.equal(sinOtorgante(c.sentenciasPorReparar[1]), 'GRANT anon TO postgres WITH ADMIN OPTION, INHERIT TRUE;');
});

test('clasificación: un error NO explicado es inesperado aunque «la restauración posterior funcione»', () => {
  const casos = [
    e(2, 'role "anon" already exists'), // CREATE ROLE de un rol que NO existía antes → inesperado
    e(3, 'permission denied to alter role'), // ALTER de un rol no preexistente → inesperado
    e(8, 'permission denied to drop role'), // sentencia ajena
    e(6, 'syntax error at or near "GRANTED"'), // mismo GRANT, otro error
    'psql: error: connection to server failed', // sin número de línea
  ];
  const c = clasificarErroresRoles(casos, ['postgres'], SQL);
  assert.equal(c.inesperados.length, casos.length);
  assert.deepEqual(c.porCategoria, {});
  unFallo((r) => { Object.assign(r.pasos.restauracion_cluster_preparado.preparacion_roles, { errores_total: 25, inesperados: [casos[0]] }); }, /1 error\(es\) inesperado\(s\)/);
});

test('preparación de roles: errores sin clasificar, reparación incompleta y roles/pertenencias distintos → fallo', () => {
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.preparacion_roles.errores_total = 30; }, /errores sin clasificar/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.preparacion_roles.reparacion = { aplicadas: 20, codigo: 0 }; }, /no se re-aplicaron todas/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.preparacion_roles.reparacion = { aplicadas: 22, codigo: 3 }; }, /no se re-aplicaron todas/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.verificacion_roles.pertenencias_distintas = ['anon>authenticator|ftf']; }, /pertenencias distintas/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.verificacion_roles.atributos_distintos = ['postgres', 'anon']; }, /atributos distintos no esperados \(anon\)/);
  unFallo((r) => { r.pasos.restauracion_cluster_preparado.roles_en_destino_despues = 3; }, /el destino tiene 3 roles/);
  unFallo((r) => { delete r.pasos.restauracion_cluster_preparado.verificacion_roles; }, /verificación de roles/);
});

test('clasificación de los errores de pg_restore sin roles', () => {
  const c = clasificarErroresSinRoles(['pg_restore: error: could not execute query: ERROR:  role "supabase_admin" does not exist', 'pg_restore: error: algo distinto']);
  assert.equal(c.esperados.length, 1); assert.equal(c.otros.length, 1);
});

test('la limpieza fallida se registra como fallo', () => {
  unFallo((r) => { r.pasos.limpieza = { errores: ['quedaron residuos: bases=recup_a archivos=false'] }; }, /limpieza: quedaron residuos/);
  unFallo((r) => { delete r.pasos.limpieza; }, /limpieza/);
});

test('limpieza: el error ORIGINAL se conserva aunque también falle la limpieza', async () => {
  const original = new Error('pg_restore falló: código 1');
  const orden = [];
  await assert.rejects(
    ejecutarConLimpieza(async () => { throw original; }, [
      async () => { orden.push('a'); throw new Error('no se pudo borrar la base'); },
      async () => { orden.push('b'); },
      async () => { orden.push('c'); throw new Error('no se pudo detener el clúster'); },
    ]),
    (err) => {
      assert.equal(err, original, 'se relanza el MISMO error original');
      assert.equal(err.message, 'pg_restore falló: código 1');
      assert.deepEqual(err.limpiezaErrores, ['no se pudo borrar la base', 'no se pudo detener el clúster']);
      return true;
    },
  );
  assert.deepEqual(orden, ['a', 'b', 'c'], 'todas las limpiezas se intentan aunque una falle');
});

test('limpieza: si la acción sale bien y la limpieza falla, es un fallo; si todo sale bien, devuelve el valor', async () => {
  await assert.rejects(ejecutarConLimpieza(async () => 'ok', [async () => { throw new Error('residuo'); }]), /la limpieza falló: residuo/);
  assert.equal(await ejecutarConLimpieza(async () => 42, [async () => {}]), 42);
});

test('código de salida: error o fallos → 1; nada → 0', () => {
  assert.equal(codigoDeSalida({ fallos: [], error: null }), 0);
  assert.equal(codigoDeSalida({ fallos: ['x'], error: null }), 1);
  assert.equal(codigoDeSalida({ fallos: [], error: new Error('x') }), 1);
  assert.equal(codigoDeSalida(), 0);
});
