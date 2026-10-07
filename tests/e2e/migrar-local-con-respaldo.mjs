// QA-076 — Migrar la base QA LOCAL solo después de un respaldo previo verificado.
//
// Incidente que lo motivó: la migración 20261005000004 se aplicó en QA local sin respaldo previo porque el comando de copia
// falló (ruta de Windows mal convertida) y el siguiente comando (`migration up`) se ejecutó de todos modos. Aquí la migración es
// el ÚLTIMO paso de una cadena donde cada eslabón debe cumplirse; cualquier fallo lanza RespaldoFallido y `migrar` NO se invoca.
//
// El respaldo lo toma ESTA ejecución (no se acepta uno existente): así un archivo viejo, o uno tomado después de migrar, no puede
// hacerse pasar por el respaldo previo. Cadena (en orden, sin saltos):
//   1. destino local verificado (contenedor de QA, solo cuentas @test.local) y archivo de destino inexistente;
//   2. pg_dump -Fc dentro del contenedor, con código de salida 0;
//   3. pg_restore --list del volcado (legible, con la tabla de migraciones) y su SHA-256, dentro del contenedor;
//   4. docker cp al equipo con argumentos en arreglo (sin shell: la ruta de Windows no se reescribe);
//   5. el archivo existe, no está vacío, empieza con la firma PGDMP, su SHA-256 coincide con el del contenedor y su fecha de
//      modificación cae dentro de esta ejecución (después del inicio, antes de empezar a migrar);
//   6. solo entonces, `migrar()`.
//
//   node tests/e2e/migrar-local-con-respaldo.mjs [etiqueta]      (rama testing; usa `npx supabase migration up --local`)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CONTENEDOR_QA = 'supabase_db_WedJaiseReact';
export const DIR_RESPALDOS = 'C:\\JaiseQA-Backups';
const FIRMA_PGDMP = 'PGDMP';
const TAMANO_MINIMO = 1024; // un volcado real de QA pesa millones de bytes; menos que esto es un archivo vacío o truncado

export class RespaldoFallido extends Error {
  constructor(etapa, detalle) {
    super(`Respaldo previo NO verificado (${etapa}): ${detalle}. No se ejecutó ninguna migración.`);
    this.name = 'RespaldoFallido';
    this.etapa = etapa;
  }
}

const primeraLinea = (t) => String(t ?? '').split('\n')[0].trim() || 'sin mensaje';
const sha256Archivo = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

// Dependencias reales. Todo comando se lanza con argumentos en arreglo y sin shell.
export function depsReales() {
  const ejecutar = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    return { codigo: r.error ? -1 : r.status, salida: (r.stdout ?? '').trim(), error: (r.error ? String(r.error.message) : (r.stderr ?? '')).trim() };
  };
  return {
    ahora: () => Date.now(),
    ejecutar,
    existe: (ruta) => existsSync(ruta),
    estadisticas: (ruta) => {
      if (!existsSync(ruta)) return null;
      const s = statSync(ruta);
      return { tamano: s.size, mtimeMs: s.mtimeMs };
    },
    cabecera: (ruta, n) => {
      const fd = openSync(ruta, 'r');
      try {
        const b = Buffer.alloc(n);
        const leidos = readSync(fd, b, 0, n, 0);
        return b.subarray(0, leidos).toString('latin1');
      } finally {
        closeSync(fd);
      }
    },
    sha256: sha256Archivo,
  };
}

// Verifica que el contenedor es la base QA local (solo cuentas ficticias) — mismo criterio que el resto del arnés.
export function verificarDestino(deps) {
  const r = deps.ejecutar('docker', ['exec', CONTENEDOR_QA, 'psql', '-U', 'postgres', '-At', '-q', '-c',
    "select count(*) from auth.users where email not like '%@test.local'"]);
  if (r.codigo !== 0) throw new RespaldoFallido('destino', `no se pudo consultar la base local: ${primeraLinea(r.error)}`);
  if (!/^\d+$/.test(r.salida)) throw new RespaldoFallido('destino', `respuesta inesperada («${r.salida.slice(0, 40)}»)`);
  if (r.salida !== '0') throw new RespaldoFallido('destino', `la base tiene ${r.salida} cuenta(s) que no son @test.local: no es el TEST local`);
}

// Toma y verifica el respaldo. Devuelve { archivo, sha256, tamano, inicio, listo } o lanza RespaldoFallido.
export function respaldarYVerificar(deps, { etiqueta = 'qa', dir = DIR_RESPALDOS, marca } = {}) {
  if (!/^[\w-]+$/.test(etiqueta)) throw new RespaldoFallido('entrada', `etiqueta no válida («${etiqueta}»)`);
  const inicio = deps.ahora();
  const sello = marca ?? new Date(inicio).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const nombre = `${etiqueta}_${sello}.dump`;
  const archivo = path.win32.join(dir, nombre);
  const interno = `/tmp/${nombre}`;

  verificarDestino(deps);
  if (deps.existe(archivo)) throw new RespaldoFallido('destino', `ya existe ${nombre}: no se reutiliza un respaldo ajeno a esta ejecución`);

  const dump = deps.ejecutar('docker', ['exec', CONTENEDOR_QA, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', '-f', interno]);
  if (dump.codigo !== 0) throw new RespaldoFallido('pg_dump', `terminó con código ${dump.codigo}: ${primeraLinea(dump.error)}`);

  const lista = deps.ejecutar('docker', ['exec', CONTENEDOR_QA, 'pg_restore', '--list', interno]);
  if (lista.codigo !== 0) throw new RespaldoFallido('pg_restore --list', `el volcado no se puede leer (código ${lista.codigo}): ${primeraLinea(lista.error)}`);
  if (!/schema_migrations/.test(lista.salida)) throw new RespaldoFallido('pg_restore --list', 'el volcado no contiene la tabla de migraciones');

  const hashInterno = deps.ejecutar('docker', ['exec', CONTENEDOR_QA, 'sha256sum', interno]);
  const esperado = hashInterno.salida.split(/\s+/)[0];
  if (hashInterno.codigo !== 0 || !/^[0-9a-f]{64}$/.test(esperado)) throw new RespaldoFallido('sha256 del contenedor', primeraLinea(hashInterno.error) || 'sin huella');

  const copia = deps.ejecutar('docker', ['cp', `${CONTENEDOR_QA}:${interno}`, archivo]);
  if (copia.codigo !== 0) throw new RespaldoFallido('docker cp', `terminó con código ${copia.codigo}: ${primeraLinea(copia.error)}`);

  const est = deps.estadisticas(archivo);
  if (!est) throw new RespaldoFallido('archivo', `no existe ${archivo} tras la copia`);
  if (est.tamano < TAMANO_MINIMO) throw new RespaldoFallido('archivo', `el archivo pesa ${est.tamano} bytes (vacío o truncado)`);
  if (deps.cabecera(archivo, FIRMA_PGDMP.length) !== FIRMA_PGDMP) throw new RespaldoFallido('archivo', 'no tiene la firma de un volcado de PostgreSQL (PGDMP)');
  const huella = deps.sha256(archivo);
  if (huella !== esperado) throw new RespaldoFallido('sha256', 'la copia en el equipo no coincide con el volcado del contenedor');
  const listo = deps.ahora();
  // La fecha del archivo debe pertenecer a ESTA ejecución: ni de antes (un archivo viejo) ni de después (uno posterior a migrar).
  // Margen de 2 s por la resolución del sistema de archivos.
  if (est.mtimeMs < inicio - 2000) throw new RespaldoFallido('fecha', 'el archivo es anterior al inicio de esta ejecución (no es un respaldo nuevo)');
  if (est.mtimeMs > listo + 2000) throw new RespaldoFallido('fecha', 'el archivo es posterior a la verificación (un respaldo posterior no sustituye a uno previo)');

  return { archivo, sha256: huella, tamano: est.tamano, inicio, listo };
}

// Respaldo verificado → migración. `migrar` solo se invoca si TODO lo anterior se cumplió.
export async function migrarConRespaldo(deps, migrar, opciones = {}) {
  const respaldo = respaldarYVerificar(deps, opciones);
  const resultado = await migrar(respaldo);
  return { respaldo, resultado };
}

function migrarReal() {
  const r = spawnSync('npx', ['--no-install', 'supabase', 'migration', 'up', '--local'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`supabase migration up terminó con código ${r.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const rama = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (rama !== 'testing') {
    console.error('Se requiere la rama testing; no se ejecuta nada.');
    process.exit(1);
  }
  try {
    const { respaldo } = await migrarConRespaldo(depsReales(), (r) => {
      console.log(`Respaldo previo verificado: ${r.archivo} (${r.tamano} bytes, SHA-256 ${r.sha256}). Migrando…`);
      migrarReal();
    }, { etiqueta: process.argv[2] ?? 'qa_pre_migracion' });
    console.log(`Migración aplicada. Respaldo previo: ${respaldo.archivo}`);
  } catch (e) {
    console.error(String(e.message));
    process.exit(1);
  }
}
