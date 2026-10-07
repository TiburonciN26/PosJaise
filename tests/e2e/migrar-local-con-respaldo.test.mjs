// QA-076 — pruebas EN MEMORIA del control «no migrar si el respaldo previo falla». No tocan Docker, la base ni el disco:
// todas las dependencias (comandos, archivos, reloj) son dobles. No reaplican ninguna migración.
//
//   node --test tests/e2e/migrar-local-con-respaldo.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENEDOR_QA, RespaldoFallido, migrarConRespaldo, respaldarYVerificar } from './migrar-local-con-respaldo.mjs';

const HUELLA = 'a'.repeat(64);
const MARCA = '20261007T010000Z';
const ARCHIVO = `C:\\JaiseQA-Backups\\qa_pre_${MARCA}.dump`;

// Doble completo: `fallos` cambia UNA etapa; `bitacora` guarda el orden exacto de lo ejecutado.
function doble(fallos = {}) {
  const bitacora = [];
  let reloj = 1_000_000;
  const archivos = new Map(); // ruta → { tamano, mtimeMs, cabecera, sha }
  if (fallos.archivoPrevio) archivos.set(ARCHIVO, { tamano: 5000, mtimeMs: 1, cabecera: 'PGDMP', sha: HUELLA });

  const ejecutar = (cmd, args) => {
    bitacora.push(`${cmd} ${args.join(' ')}`);
    const a = args.join(' ');
    if (/auth\.users/.test(a)) return fallos.destino ?? { codigo: 0, salida: '0', error: '' };
    if (/pg_dump/.test(a)) return fallos.pgdump ?? { codigo: 0, salida: '', error: '' };
    if (/pg_restore --list/.test(a)) return fallos.lista ?? { codigo: 0, salida: '; TABLE DATA supabase_migrations schema_migrations', error: '' };
    if (/sha256sum/.test(a)) return fallos.hashInterno ?? { codigo: 0, salida: `${HUELLA}  /tmp/x`, error: '' };
    if (cmd === 'docker' && args[0] === 'cp') {
      if (fallos.cp) return fallos.cp;
      if (!fallos.cpSinArchivo) {
        reloj += 10;
        archivos.set(args[2], {
          tamano: fallos.tamano ?? 5_000_000,
          mtimeMs: fallos.mtime ? fallos.mtime(reloj) : reloj,
          cabecera: fallos.cabecera ?? 'PGDMP',
          sha: fallos.shaCopia ?? HUELLA,
        });
      }
      return { codigo: 0, salida: '', error: '' };
    }
    throw new Error('Comando inesperado en el doble: ' + cmd + ' ' + a);
  };
  const deps = {
    ahora: () => reloj,
    ejecutar,
    existe: (r) => archivos.has(r),
    estadisticas: (r) => (archivos.has(r) ? { tamano: archivos.get(r).tamano, mtimeMs: archivos.get(r).mtimeMs } : null),
    cabecera: (r) => archivos.get(r).cabecera,
    sha256: (r) => archivos.get(r).sha,
  };
  return { deps, bitacora, archivos };
}

const opciones = { etiqueta: 'qa_pre', marca: MARCA };

// Intenta migrar y devuelve cuántas veces se invocó `migrar`.
async function intentar(fallos) {
  const d = doble(fallos);
  let migraciones = 0;
  let error = null;
  try {
    await migrarConRespaldo(d.deps, () => { migraciones += 1; }, opciones);
  } catch (e) {
    error = e;
  }
  return { migraciones, error, ...d };
}

describe('QA-076 · la migración solo corre tras un respaldo previo verificado', () => {
  test('camino feliz: el respaldo se toma y verifica ANTES de migrar, en este orden', async () => {
    const r = await intentar({});
    assert.equal(r.error, null);
    assert.equal(r.migraciones, 1);
    const etapas = ['auth.users', 'pg_dump', 'pg_restore --list', 'sha256sum', 'cp '];
    const posiciones = etapas.map((e) => r.bitacora.findIndex((c) => c.includes(e)));
    assert.ok(posiciones.every((p) => p >= 0), `faltan etapas: ${posiciones}`);
    assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b), 'las etapas deben ir en orden');
  });

  test('la ruta de Windows llega intacta a docker cp (argumentos en arreglo, sin reescritura)', async () => {
    const r = await intentar({});
    const cp = r.bitacora.find((c) => c.startsWith('docker cp'));
    assert.ok(cp.endsWith(ARCHIVO), cp);
    assert.ok(cp.includes(`${CONTENEDOR_QA}:/tmp/`), cp);
  });

  const casos = [
    ['pg_dump falla', { pgdump: { codigo: 1, salida: '', error: 'pg_dump: error: connection failed' } }, 'pg_dump'],
    ['docker cp falla (el caso del incidente: ruta mal convertida)', { cp: { codigo: 1, salida: '', error: 'invalid output path' } }, 'docker cp'],
    ['docker cp «termina bien» pero el archivo no existe', { cpSinArchivo: true }, 'archivo'],
    ['el archivo está vacío', { tamano: 0 }, 'archivo'],
    ['el archivo está truncado', { tamano: 100 }, 'archivo'],
    ['el archivo no es un volcado (sin PGDMP)', { cabecera: 'HOLA!' }, 'archivo'],
    ['pg_restore --list no puede leer el volcado', { lista: { codigo: 1, salida: '', error: 'pg_restore: error: corrupt' } }, 'pg_restore --list'],
    ['el volcado no contiene la tabla de migraciones', { lista: { codigo: 0, salida: '; TABLE public clientes', error: '' } }, 'pg_restore --list'],
    ['no hay huella en el contenedor', { hashInterno: { codigo: 1, salida: '', error: 'sha256sum: no such file' } }, 'sha256 del contenedor'],
    ['la copia no coincide con el volcado (SHA-256)', { shaCopia: 'b'.repeat(64) }, 'sha256'],
    ['el destino no se puede consultar (Docker caído)', { destino: { codigo: 1, salida: '', error: 'Cannot connect to the Docker daemon' } }, 'destino'],
    ['la base tiene cuentas reales (no es TEST local)', { destino: { codigo: 0, salida: '3', error: '' } }, 'destino'],
    ['respuesta basura al verificar el destino', { destino: { codigo: 0, salida: 'ERROR', error: '' } }, 'destino'],
  ];
  for (const [nombre, fallos, etapa] of casos) {
    test(`NO migra si: ${nombre}`, async () => {
      const r = await intentar(fallos);
      assert.equal(r.migraciones, 0, 'migrar() no debe invocarse');
      assert.ok(r.error instanceof RespaldoFallido, String(r.error));
      assert.equal(r.error.etapa, etapa);
      assert.match(r.error.message, /No se ejecutó ninguna migración/);
    });
  }

  test('NO migra con un archivo del mismo nombre que ya existía (respaldo ajeno a esta ejecución)', async () => {
    const r = await intentar({ archivoPrevio: true });
    assert.equal(r.migraciones, 0);
    assert.equal(r.error.etapa, 'destino');
    assert.ok(!r.bitacora.some((c) => c.includes('pg_dump')), 'ni siquiera se vuelca encima');
  });

  test('NO acepta un archivo con fecha ANTERIOR al inicio (respaldo viejo)', async () => {
    const r = await intentar({ mtime: () => 1 });
    assert.equal(r.migraciones, 0);
    assert.equal(r.error.etapa, 'fecha');
    assert.match(r.error.message, /anterior al inicio/);
  });

  test('NO acepta un archivo con fecha POSTERIOR (un respaldo posterior no sustituye al previo)', async () => {
    const r = await intentar({ mtime: (t) => t + 60_000 });
    assert.equal(r.migraciones, 0);
    assert.equal(r.error.etapa, 'fecha');
    assert.match(r.error.message, /posterior/);
  });

  test('una etiqueta con ruta o espacios se rechaza antes de ejecutar nada', () => {
    const d = doble({});
    assert.throws(() => respaldarYVerificar(d.deps, { etiqueta: '..\\x' }), RespaldoFallido);
    assert.equal(d.bitacora.length, 0);
  });

  test('si la migración falla DESPUÉS de un respaldo bueno, el error se propaga y no se declara éxito', async () => {
    const d = doble({});
    await assert.rejects(
      migrarConRespaldo(d.deps, () => { throw new Error('migration up falló'); }, opciones),
      /migration up falló/,
    );
  });

  test('migrar() recibe los datos del respaldo verificado', async () => {
    const d = doble({});
    const { respaldo } = await migrarConRespaldo(d.deps, (r) => { assert.equal(r.archivo, ARCHIVO); assert.equal(r.sha256, HUELLA); }, opciones);
    assert.equal(respaldo.tamano, 5_000_000);
  });
});
