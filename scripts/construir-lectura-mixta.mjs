// Build de REVERSIÓN con LECTURA MIXTA y revocación B (plan V2 de Codex §7). SOLO LOCAL: no publica, no despliega, no toca Cloudflare.
//   node scripts/construir-lectura-mixta.mjs --commit=<ref> --salida=<carpeta NUEVA> [--reemplazar] [--conservar]
//   La salida debe ser una carpeta NUEVA y dedicada (bajo .codex/ o fuera del proyecto); nunca la raíz, un ancestro ni una carpeta ajena.
//   --reemplazar solo actúa sobre un artefacto propio (marca en el manifiesto) y borra únicamente dist/, servidor/ y el manifiesto.
//
// Qué es: el mismo commit compilado SIN subidas nuevas a R2 (VITE_MEDIOS_PROVEEDOR vacío → «supabase») pero conservando
//   · la lectura de referencias `r2:` y de URLs de Galería por la Function /medios (base pública = <alias>/medios, con B activa);
//   · la URL del Worker para ELIMINAR objetos R2 ya existentes;
//   · r2.dev solo como base RECONOCIDA de URLs de Galería ya guardadas (no como entrega), hasta migrarlas.
// Un retorno a r2.dev público o a una Function con A NO satisface el contrato de retirada. Por eso el artefacto va acompañado de la
// Function del MISMO commit (functions/ + cloudflare/medios-pages/) y el manifiesto comprueba que REVOCAR_CON_R2 está activa.
// Reproducible: construye desde `git archive` del commit exacto, con `npm ci`, y escribe un manifiesto con hashes. Despliegue manual y
// con autorización aparte (esto no lo hace).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { swExcluyeMedios } from './lib/sw-medios.mjs'
import { HIJOS_PROPIOS, MARCA, temporalPropio, validarSalida } from './lib/salida-segura.mjs'

const require = createRequire(import.meta.url)
const G = require('./lib/guardas-interfaz-r2.cjs')
const falla = (m) => { console.error('construir-lectura-mixta: ' + m); process.exit(1) }
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const REF = arg('commit')
const raizProyecto = process.cwd()
const v = validarSalida({
  salida: arg('salida'), raiz: raizProyecto, reemplazar: process.argv.includes('--reemplazar'),
  fs: {
    existe: existsSync, esCarpeta: (r) => statSync(r).isDirectory(),
    leerMarca: (r) => { try { return JSON.parse(readFileSync(join(r, MARCA), 'utf8')) } catch { return null } },
  },
})
if (!REF) falla('uso: --commit=<ref> --salida=<carpeta nueva>')
if (!v.ok) falla(`salida rechazada: ${v.motivo}`)
const SALIDA = v.salida

const sha = spawnSync('git', ['rev-parse', '--verify', `${REF}^{commit}`], { encoding: 'utf8' })
if (sha.status !== 0) falla(`el commit ${REF} no existe`)
const commit = sha.stdout.trim()

const envLocal = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^VITE_[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const envBuild = {
  CF_PAGES: '1', CF_PAGES_BRANCH: 'feat/cloudflare-pages', RAMA_PRODUCCION: 'cloudflare-produccion', CF_PAGES_COMMIT_SHA: commit,
  VITE_SUPABASE_URL: envLocal.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: envLocal.VITE_SUPABASE_ANON_KEY, VITE_CULQI_PUBLIC_KEY: '',
  VITE_MEDIOS_PROVEEDOR: '', // ← sin subidas nuevas a R2
  VITE_MEDIOS_API_URL: G.WORKER_APROBADO,
  VITE_MEDIOS_PUBLIC_URL: `${G.ALIAS_APROBADO}/medios`,
  VITE_MEDIOS_BASES_RECONOCIDAS: G.PUBLICO_APROBADO,
}

const tmp = mkdtempSync(join(tmpdir(), 'lectura-mixta-'))
const clon = join(tmp, 'clon')
mkdirSync(clon, { recursive: true })
const a = spawnSync('git', ['archive', '--format=tar', '-o', join(tmp, 'commit.tar'), commit], { encoding: 'utf8' })
if (a.status !== 0) falla('git archive falló: ' + a.stderr)
const x = spawnSync('tar', ['-xf', '../commit.tar'], { cwd: clon, encoding: 'utf8' })
if (x.status !== 0) falla('tar falló: ' + x.stderr)
if (['.env', '.env.local', '.env.staging.local'].some((f) => existsSync(join(clon, f)))) falla('el commit contiene un archivo .env con secretos')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const sh = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
const dist = join(SALIDA, 'dist')
const servidor = join(SALIDA, 'servidor')
if (v.reemplazo) for (const h of HIJOS_PROPIOS) rmSync(join(SALIDA, h), { recursive: true, force: true }) // solo hijos conocidos de un artefacto propio
mkdirSync(SALIDA, { recursive: true })
console.log(`commit ${commit}; clon en ${clon}`)
const ci = sh(npm, ['ci', '--no-audit', '--no-fund'], clon)
if (ci.status !== 0) falla('npm ci falló:\n' + ci.stderr.slice(-800))
const b = sh(npm, ['run', 'build:cloudflare'], clon, { ...envBuild, CF_OUT_DIR: dist })
if (b.status !== 0) falla('el build FALLÓ:\n' + (b.stdout + b.stderr).slice(-1200))

const archivos = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)]))
const rel = (base, f) => f.slice(base.length + 1).replaceAll('\\', '/')
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

// ---- comprobaciones del artefacto ----
const problemas = []
const hallazgos = []
for (const f of archivos(dist).filter((p) => p.endsWith('.js'))) {
  const c = G.configuracionDeMediosEnBundle(readFileSync(f, 'utf8'))
  if (c) hallazgos.push({ f: rel(dist, f), c })
}
const esperado = G.entregaEsperada('mixta')
if (!hallazgos.length) problemas.push('no se encontró la configuración de medios en el bundle')
for (const { f, c } of hallazgos) {
  const t = c.configs
  const ok = t.length === 1 && t[0].proveedor === esperado.proveedor && t[0].api === esperado.api && t[0].publica === esperado.publica && c.extras.length === 1 && c.extras[0] === esperado.extras
  if (!ok) problemas.push(`${f}: configuración de medios inesperada ${JSON.stringify(c)}`)
}
const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
if (!swExcluyeMedios(sw)) problemas.push('el service worker no excluye /medios del fallback')
const rutas = JSON.parse(readFileSync(join(dist, '_routes.json'), 'utf8'))
if (JSON.stringify(rutas.include) !== JSON.stringify(['/medios', '/medios/*'])) problemas.push('_routes.json no limita las Functions a /medios')
const entrega = readFileSync(join(clon, 'cloudflare/medios-pages/entrega.js'), 'utf8')
const bActiva = /export const REVOCAR_CON_R2 = true\b/.test(entrega)
if (!bActiva) problemas.push('la Function de este commit NO tiene la revocación B activa (REVOCAR_CON_R2 = true)')
if (existsSync(join(dist, '404.html'))) problemas.push('404.html en la salida')

// ML-02: el paquete lleva el SERVIDOR del mismo commit: functions/ + cloudflare/medios-pages (sin pruebas), con la estructura que
// Pages espera junto a dist (functions/ en la raíz del proyecto). Los imports relativos deben resolverse DENTRO del paquete.
for (const carpeta of ['functions', 'cloudflare/medios-pages']) {
  cpSync(join(clon, carpeta), join(servidor, carpeta), { recursive: true, filter: (o) => !/[\\/]test([\\/]|$)/.test(o) })
}
const delServidor = archivos(servidor)
for (const f of delServidor.filter((x) => x.endsWith('.js'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const destino = resolve(join(f, '..'), m[1])
    if (!existsSync(destino) || !destino.startsWith(servidor)) problemas.push(`${rel(servidor, f)}: el import ${m[1]} no se resuelve dentro del paquete`)
  }
}
if (!existsSync(join(servidor, 'functions/medios.js')) || !existsSync(join(servidor, 'functions/medios/[[ruta]].js'))) problemas.push('faltan los entrypoints functions/medios*.js en el paquete')
const functions = delServidor
const manifiesto = {
  fecha: new Date().toISOString(), commit, tipo: 'reversión con lectura mixta + B', publicado: false,
  configuracionMedios: { proveedor: esperado.proveedor, api: esperado.api, publica: esperado.publica, basesReconocidas: esperado.extras },
  revocacionBActiva: bActiva, swSha256: hash(join(dist, 'sw.js')), modulosConConfiguracion: hallazgos.map((h) => h.f),
  servidor: Object.fromEntries(functions.map((f) => [rel(servidor, f), hash(f)])),
  archivosDist: archivos(dist).length, problemas,
  diseño: 'dist/ = frontend; servidor/functions + servidor/cloudflare = Function del MISMO commit (con B). Pages exige functions/ en la raíz del proyecto desplegado.',
  nota: 'No se publicó nada. Desplegar dist + servidor del MISMO commit exige autorización aparte. Volver a r2.dev o a una Function con A reabriría el enlace antiguo.',
}
writeFileSync(join(SALIDA, MARCA), JSON.stringify(manifiesto, null, 2))
console.log(JSON.stringify({ commit, bActiva, swSha256: manifiesto.swSha256, modulos: manifiesto.modulosConConfiguracion, problemas }, null, 2))
if (!process.argv.includes('--conservar') && temporalPropio({ tmp, tmpdir: tmpdir() })) rmSync(tmp, { recursive: true, force: true })
process.exit(problemas.length ? 1 : 0)
