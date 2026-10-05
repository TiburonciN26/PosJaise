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
export const BASES_PERMITIDAS = ['postgres', 'restauracion', 'transicion', 'recuperacion', 'listo', 'instalacion_limpia'];
export const CLI = 'C:/JaiseQA-Tools/supabase.exe';
export const DIRECTORIO_CLI = 'C:/JaiseQA-Ensayo';

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

// ---------------------------------------------------------------------------------------------------------------------------
// Ruta HTTP/interfaz: Auth, REST y la aplicación deben apuntar a LA MISMA base donde se ejecutó la apertura.
// Los servicios de la instancia (GoTrue, PostgREST) sirven siempre la base «postgres» del ensayo; por eso la base preparada
// se intercambia a ese nombre (hacerPrincipal) y se comprueba, leyendo la configuración de los contenedores, que ambos usan
// esa base y no otra. Solo se extrae el NOMBRE de la base de las URL de conexión; nunca se imprime una URL ni una clave.
export const SERVICIOS = ['auth', 'rest', 'storage', 'realtime', 'pg_meta', 'studio'];
const contenedorDe = (servicio) => `supabase_${servicio}_${PROYECTO}`;

function nombreDeBaseEn(servicio, variables) {
  const env = JSON.parse(docker(['inspect', contenedorDe(servicio)]))[0].Config.Env;
  for (const v of variables) {
    const fila = env.find((e) => e.startsWith(`${v}=`));
    if (!fila) continue;
    const valor = fila.slice(v.length + 1);
    try { return new URL(valor).pathname.replace(/^\//, ''); } catch { return valor; }
  }
  return null;
}

// Devuelve { auth, rest } con la base que usa cada servicio.
export function basesDeLosServicios() {
  return {
    auth: nombreDeBaseEn('auth', ['GOTRUE_DB_DATABASE_URL', 'DATABASE_URL']),
    rest: nombreDeBaseEn('rest', ['PGRST_DB_URI']),
  };
}

export function verificarMismaBase(baseDeLaApertura) {
  verificarDestinoEnsayo(baseDeLaApertura);
  const { auth, rest } = basesDeLosServicios();
  const m = [];
  if (auth !== baseDeLaApertura) m.push(`Auth usa «${auth}», no «${baseDeLaApertura}»`);
  if (rest !== baseDeLaApertura) m.push(`REST usa «${rest}», no «${baseDeLaApertura}»`);
  if (m.length) throw new Error(`Auth/REST/SQL no apuntan a la misma base: ${m.join('; ')}`);
  return { auth, rest, sql: baseDeLaApertura };
}

// Claves del ensayo (no son las de QA ni las de producción). Se leen del CLI en memoria; nunca se imprimen ni se guardan.
export function clavesDelEnsayo() {
  const salida = JSON.parse(execFileSync(CLI, ['status', '-o', 'json', '--workdir', DIRECTORIO_CLI], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (!salida.API_URL?.includes(`:${PUERTO_API}`)) throw new Error('El CLI no apunta a la API del ensayo; se aborta.');
  return { anon: salida.ANON_KEY, servicio: salida.SERVICE_ROLE_KEY };
}

// Deja `origen` como la base «postgres» de la instancia (la que sirven Auth y REST). La base «postgres» anterior se conserva
// como «instalacion_limpia». Se detienen los servicios mientras se renombra y se vuelven a levantar después.
export async function hacerPrincipal(origen) {
  if (origen === 'postgres' || !BASES_PERMITIDAS.includes(origen)) throw new Error(`Base no permitida: ${origen}`);
  verificarDestinoEnsayo(origen);
  for (const s of SERVICIOS) { try { docker(['stop', contenedorDe(s)]); } catch { /* ya detenido */ } }
  const psqlMant = (...cmds) => docker(['exec', CONTENEDOR, 'psql', '-U', 'supabase_admin', '-d', 'restauracion', '-v', 'ON_ERROR_STOP=1', '-q',
    ...cmds.flatMap((c) => ['-c', c])]);
  psqlMant(`drop database if exists instalacion_limpia with (force)`,
    `select pg_terminate_backend(pid) from pg_stat_activity where datname in ('postgres', '${origen}') and pid <> pg_backend_pid()`,
    `alter database postgres rename to instalacion_limpia`,
    `alter database ${origen} rename to postgres`);
  for (const s of SERVICIOS) { try { docker(['start', contenedorDe(s)]); } catch { /* sin contenedor */ } }
  verificadas.clear();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Archivos de Storage del ensayo (backend de archivos del contenedor de storage-api). Solo el contenedor del ensayo y solo
// rutas bajo /mnt/stub: ninguna operación puede alcanzar el Storage de QA.
export const CONTENEDOR_STORAGE = `supabase_storage_${PROYECTO}`;
const rutaStorageValida = (r) => /^\/mnt\/stub(\/[\w.@%+=,~ -]+)*\/?$/.test(r) && !r.includes('..');
export function shStorage(comando) {
  return docker(['exec', CONTENEDOR_STORAGE, 'sh', '-c', comando]);
}
export function copiarDesdeStorage(rutaContenedor, destinoLocal) {
  if (!rutaStorageValida(rutaContenedor)) throw new Error(`Ruta de Storage no permitida: ${rutaContenedor}`);
  docker(['cp', `${CONTENEDOR_STORAGE}:${rutaContenedor}`, destinoLocal]);
}
export function copiarHaciaStorage(origenLocal, rutaContenedor) {
  if (!rutaStorageValida(rutaContenedor)) throw new Error(`Ruta de Storage no permitida: ${rutaContenedor}`);
  docker(['cp', origenLocal, `${CONTENEDOR_STORAGE}:${rutaContenedor}`]);
}
export const archivosDeStorage = () => Number(shStorage('find /mnt/stub -type f | wc -l'));
