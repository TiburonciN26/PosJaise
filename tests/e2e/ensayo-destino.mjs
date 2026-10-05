// Vía de pruebas SEPARADA para la instancia desechable «JaiseEnsayo» (ensayo de instalación limpia, restauración y transición).
//
// NO sustituye ni relaja las guardas de la suite de QA (local-safety.mjs, recompensas-fase2-helpers.mjs): esas siguen fijas a
// Supabase Local QA (contenedor supabase_db_WedJaiseReact, puertos 54321/5173). Este módulo es lo contrario: solo puede escribir
// en la instancia desechable y rechaza cualquier otro destino ANTES de ejecutar nada. Se importa solo desde los archivos
// *-ensayo.* y no tiene ninguna ruta de código que dirija una escritura a QA.
//
// Cuatro condiciones, todas obligatorias (si una falla, no se escribe):
//   1. El contenedor es exactamente el de la instancia desechable (el nombre sale de una constante, no del entorno).
//   2. Docker confirma: etiqueta com.supabase.cli.project = JaiseEnsayo y puerto 5432 publicado en 56322 (no en 54322).
//   3. La base de datos destino contiene la marca ensayo_marker.destino = 'JaiseEnsayo' (QA no la tiene).
//   4. La base destino es una de las bases del ensayo (lista cerrada), nunca «postgres» de QA ni un nombre arbitrario.
import { execFileSync, spawn } from 'node:child_process';

export const PROYECTO = 'JaiseEnsayo';
export const CONTENEDOR = 'supabase_db_JaiseEnsayo';
export const PUERTO_DB = 56322;
export const PUERTO_API = 56321;
export const appURL = 'http://localhost:5273'; // Vite de ensayo (aún no usado: la UI no se ejecuta en este lote)
export const supabaseURL = `http://127.0.0.1:${PUERTO_API}`;
export const BASES_PERMITIDAS = ['postgres', 'restauracion', 'transicion', 'recuperacion'];

// Destinos de QA que este módulo debe rechazar siempre (aunque alguien los pase por error).
const DESTINOS_QA = {
  contenedores: ['supabase_db_WedJaiseReact', 'supabase_kong_WedJaiseReact', 'supabase_auth_WedJaiseReact'],
  puertos: [54321, 54322, 54323, 54324, 54327, 54329],
  origenes: ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://localhost:5173', 'http://127.0.0.1:5173'],
};

// Validación PURA (sin Docker): recibe lo que se observó y devuelve la lista de motivos de rechazo (vacía = aceptable).
export function motivosDeRechazo({ contenedor, base, etiquetaProyecto, puertoPublicado, marca }) {
  const m = [];
  if (DESTINOS_QA.contenedores.includes(contenedor)) m.push(`el contenedor ${contenedor} es de QA`);
  if (contenedor !== CONTENEDOR) m.push(`el contenedor debe ser ${CONTENEDOR}`);
  if (!BASES_PERMITIDAS.includes(base)) m.push(`la base «${base}» no está en la lista del ensayo`);
  if (etiquetaProyecto !== PROYECTO) m.push(`la etiqueta del proyecto es «${etiquetaProyecto}», no ${PROYECTO}`);
  if (DESTINOS_QA.puertos.includes(Number(puertoPublicado))) m.push(`el puerto ${puertoPublicado} es de QA`);
  if (Number(puertoPublicado) !== PUERTO_DB) m.push(`el puerto de la BD debe ser ${PUERTO_DB}`);
  if (marca !== PROYECTO) m.push('la base no tiene la marca de instancia desechable');
  return m;
}

export function origenPermitido(origen) {
  if (DESTINOS_QA.origenes.includes(origen)) return false;
  return [new URL(appURL).origin, supabaseURL].includes(origen);
}

// Igual que localNetworkOnly de la suite de QA, pero con los orígenes del ensayo; aborta cualquier otro (incluido QA).
export async function soloRedDelEnsayo(context) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (!origenPermitido(url.origin)) return route.abort('blockedbyclient');
    return route.continue();
  });
}

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function psqlSincrono(base, sql) {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'supabase_admin', '-d', base, '-v', 'ON_ERROR_STOP=1', '-At', '-q'], {
    encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function verificarDestinoEnsayo(base) {
  let etiquetaProyecto = null; let puertoPublicado = null; let marca = null;
  try {
    const info = JSON.parse(docker(['inspect', CONTENEDOR]))[0];
    etiquetaProyecto = info.Config.Labels?.['com.supabase.cli.project'] ?? null;
    const enlace = info.NetworkSettings.Ports?.['5432/tcp']?.[0];
    puertoPublicado = enlace ? Number(enlace.HostPort) : null;
  } catch (e) {
    throw new Error(`No se pudo inspeccionar ${CONTENEDOR}; se aborta sin escribir. ${String(e.message).split('\n')[0]}`);
  }
  if (BASES_PERMITIDAS.includes(base)) {
    try { marca = psqlSincrono(base, `select instancia from ensayo_marker.destino limit 1;`); } catch { marca = null; }
  }
  const motivos = motivosDeRechazo({ contenedor: CONTENEDOR, base, etiquetaProyecto, puertoPublicado, marca });
  if (motivos.length) throw new Error(`Destino de ensayo RECHAZADO (no se escribe): ${motivos.join('; ')}`);
}

// Ejecuta SQL SOLO en la base indicada de la instancia desechable. Verifica el destino antes de cada ejecución distinta de
// base (la verificación se cachea por base dentro del proceso).
const verificadas = new Set();
export async function ejecutarEnsayo(base, sql) {
  if (!verificadas.has(base)) { verificarDestinoEnsayo(base); verificadas.add(base); }
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'supabase_admin', '-d', base, '-v', 'ON_ERROR_STOP=1', '-At', '-q'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, out: '', err: String(e.message) }));
    p.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}

export function comoEnsayo(uid, { rol = false } = {}) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  return `select set_config('request.jwt.claims', $c$${claims}$c$, false) \\g /dev/null\n` + (rol ? 'set role authenticated;\n' : '');
}

// Volcado y restauración dentro del contenedor de la instancia desechable (rutas internas /tmp; nada sale a QA).
export async function volcarBase(base, archivo) {
  if (!verificadas.has(base)) { verificarDestinoEnsayo(base); verificadas.add(base); }
  if (!/^\/tmp\/[\w.-]+$/.test(archivo)) throw new Error('El archivo de volcado debe estar en /tmp del contenedor del ensayo.');
  docker(['exec', CONTENEDOR, 'pg_dump', '-U', 'supabase_admin', '-d', base, '-Fc', '-f', archivo]);
}

// Crea (reemplaza) una base del ensayo distinta de «postgres» y restaura en ella el volcado.
export async function restaurarBase(archivo, baseNueva, { marcar = false } = {}) {
  if (baseNueva === 'postgres' || !BASES_PERMITIDAS.includes(baseNueva)) throw new Error(`Base de restauración no permitida: ${baseNueva}`);
  verificarDestinoEnsayo('postgres');
  docker(['exec', CONTENEDOR, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-c', `drop database if exists ${baseNueva} with (force)`, '-c', `create database ${baseNueva}`]);
  docker(['exec', CONTENEDOR, 'pg_restore', '-U', 'supabase_admin', '-d', baseNueva, '--exit-on-error', archivo]);
  // Un volcado tomado de QA no trae la marca de instancia desechable: se la pone aquí (solo en una base del ensayo).
  if (marcar) {
    docker(['exec', CONTENEDOR, 'psql', '-U', 'supabase_admin', '-d', baseNueva, '-v', 'ON_ERROR_STOP=1', '-q',
      '-c', 'create schema if not exists ensayo_marker',
      '-c', 'create table if not exists ensayo_marker.destino(instancia text primary key, creado_en timestamptz default now())',
      '-c', `insert into ensayo_marker.destino(instancia) values ('${PROYECTO}') on conflict do nothing`]);
  }
  verificadas.delete(baseNueva);
  verificarDestinoEnsayo(baseNueva);
}
