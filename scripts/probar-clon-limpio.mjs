// Prueba de reproducibilidad (Fase 2B, B5): construye desde los archivos CANDIDATOS a commit, en una carpeta limpia
// y con `npm ci`, y compara hash a hash con el build del árbol de trabajo bajo las MISMAS variables.
//  · Candidatos = `git ls-files --cached --others --exclude-standard` (lo que Git subiría; NO incluye archivos ignorados ni
//    secretos locales como .env*), menos las exclusiones propuestas (.codex/, resultados de pruebas).
//  · Variables fijas y de staging; VITE_CULQI_PUBLIC_KEY vacía en ambos para que `.env.local` del árbol no contamine el build.
// Uso: node scripts/probar-clon-limpio.mjs [salida.json] [--commit[=<ref>]]      (no hace add/commit/push)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const falla = (m) => { console.error('probar-clon-limpio: ' + m); process.exit(1) }
const envLocal = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^VITE_[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const envBuild = {
  CF_PAGES: '1', CF_PAGES_BRANCH: 'feat/cloudflare-pages', RAMA_PRODUCCION: 'cloudflare-produccion', CF_PAGES_COMMIT_SHA: '0123456789abcdef',
  VITE_SUPABASE_URL: envLocal.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: envLocal.VITE_SUPABASE_ANON_KEY, VITE_CULQI_PUBLIC_KEY: '',
}
const EXCLUIR = [/^\.codex\//, /^tests\/e2e\/(results|artifacts)/]
const lista = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter(Boolean)
const candidatos = lista.filter((f) => existsSync(f) && !EXCLUIR.some((re) => re.test(f)))
if (!process.argv.some((a) => a.startsWith('--commit')) && !candidatos.includes('src/assets/login/foto-login.jpeg')) falla('foto-login.jpeg NO está entre los candidatos a commit')
if (candidatos.some((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== '.env.example')) falla('hay un .env* entre los candidatos')

const tmp = mkdtempSync(join(tmpdir(), 'clon-limpio-'))
const clon = join(tmp, 'clon')
// --commit[=<ref>]: en vez de los archivos candidatos, usa el CHECKOUT EXACTO del commit (git archive): es lo que Cloudflare compilará.
const optCommit = process.argv.find((a) => a === '--commit' || a.startsWith('--commit='))
let refCommit = null
if (optCommit) {
  refCommit = optCommit.includes('=') ? optCommit.split('=')[1] : 'HEAD'
  mkdirSync(clon, { recursive: true })
  const tar = join(tmp, 'commit.tar')
  const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, refCommit], { encoding: 'utf8' })
  if (a.status !== 0) falla('git archive falló: ' + a.stderr)
  const x = spawnSync('tar', ['-xf', '../commit.tar'], { cwd: clon, encoding: 'utf8' }) // ruta relativa: GNU tar toma «C:» como host
  if (x.status !== 0) falla('tar falló: ' + x.stderr)
  if (!existsSync(join(clon, 'src/assets/login/foto-login.jpeg'))) falla('el commit NO contiene foto-login.jpeg')
  // .codex/config.toml ya estaba versionado desde antes (configuración de shadcn); los informes de Codex NO deben entrar.
  if (existsSync(join(clon, '.codex')) && readdirSync(join(clon, '.codex')).some((f) => f !== 'config.toml')) falla('el commit contiene informes de .codex/')
  if (['.env', '.env.local', '.env.staging.local'].some((f) => existsSync(join(clon, f)))) falla('el commit contiene un archivo .env con secretos')
} else {
  for (const f of candidatos) { mkdirSync(dirname(join(clon, f)), { recursive: true }); cpSync(f, join(clon, f)) }
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const sh = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
console.log(`candidatos: ${candidatos.length} archivos; clon en ${clon}`)
const ci = sh(npm, ['ci', '--no-audit', '--no-fund'], clon)
if (ci.status !== 0) falla('npm ci falló en el clon:\n' + ci.stderr.slice(-800))
const b1 = sh(npm, ['run', 'build:cloudflare'], clon, { ...envBuild, CF_OUT_DIR: join(tmp, 'dist-clon') })
if (b1.status !== 0) falla('build en el clon limpio FALLÓ:\n' + (b1.stdout + b1.stderr).slice(-1200))
const cwdArbol = process.cwd()
const b2 = sh(npm, ['run', 'build:cloudflare'], cwdArbol, { ...envBuild, CF_OUT_DIR: join(tmp, 'dist-arbol') })
if (b2.status !== 0) falla('build del árbol de trabajo FALLÓ:\n' + (b2.stdout + b2.stderr).slice(-1200))

// En Windows `core.autocrlf=true` deja los archivos de texto del árbol con CRLF, pero el commit guarda LF (lo que compilará
// Cloudflare en Linux). Se comparan los hashes exactos y, aparte, con el fin de línea normalizado: una diferencia que
// desaparece al normalizar es SOLO de fin de línea (archivos estáticos de public/), no de contenido ni del bundle.
const TEXTO = /(\.(svg|html|css|js|json|webmanifest|txt|xml)|(^|\/)_headers)$/i
const hashes = (dir, normalizar) => { // normalizar = ignorar SOLO fin de línea y revisiones del precache derivadas de él
  const out = {}
  const rec = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) return rec(join(d, e.name))
    const k = join(d, e.name).slice(dir.length + 1).replaceAll('\\', '/')
    let b = readFileSync(join(d, e.name))
    if (normalizar && TEXTO.test(k)) {
      let t = b.toString('utf8').replace(/\r/g, '') // todos los CR, también los internos del HTML minificado
      if (k === 'sw.js') t = t.replace(/revision:"[^"]*"/g, 'revision:""') // el precache lleva el hash del index.html (que depende del fin de línea)
      b = Buffer.from(t, 'utf8')
    }
    out[k] = createHash('sha256').update(b).digest('hex')
  })
  rec(dir)
  return out
}
const unir = (a, b) => new Set([...Object.keys(a), ...Object.keys(b)])
const hc = hashes(join(tmp, 'dist-clon'), false)
const ha = hashes(join(tmp, 'dist-arbol'), false)
const dif = [...unir(hc, ha)].filter((k) => hc[k] !== ha[k])
const hcN = hashes(join(tmp, 'dist-clon'), true)
const haN = hashes(join(tmp, 'dist-arbol'), true)
const difReal = [...unir(hcN, haN)].filter((k) => hcN[k] !== haN[k])
const soloFinDeLinea = dif.filter((k) => !difReal.includes(k))
const res = { fecha: new Date().toISOString(), modo: refCommit ? `checkout exacto de ${refCommit} (${spawnSync('git', ['rev-parse', refCommit], { encoding: 'utf8' }).stdout.trim()})` : 'archivos candidatos', candidatos: candidatos.length, incluyeImagenLogin: true, archivosClon: Object.keys(hc).length, archivosArbol: Object.keys(ha).length, diferenciasExactas: dif.length, diferenciasSoloFinDeLinea: soloFinDeLinea.length, ejemploSoloFinDeLinea: soloFinDeLinea.slice(0, 12), diferenciasDeContenido: difReal.length, ejemploDiferencias: difReal.slice(0, 5), identico: difReal.length === 0 }
console.log(JSON.stringify(res))
if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(res, null, 2))
if (!process.env.KEEP_TMP) rmSync(tmp, { recursive: true, force: true })
process.exit(res.identico ? 0 : 1)
