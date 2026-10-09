// Prueba de reproducibilidad (Fase 2B, B5): construye desde los archivos CANDIDATOS a commit, en una carpeta limpia
// y con `npm ci`, y compara hash a hash con el build del árbol de trabajo bajo las MISMAS variables.
//  · Candidatos = `git ls-files --cached --others --exclude-standard` (lo que Git subiría; NO incluye archivos ignorados ni
//    secretos locales como .env*), menos las exclusiones propuestas (.codex/, resultados de pruebas).
//  · Variables fijas y de staging; VITE_CULQI_PUBLIC_KEY vacía en ambos para que `.env.local` del árbol no contamine el build.
// Uso: node scripts/probar-clon-limpio.mjs [salida.json]      (no hace add/commit/push)
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
if (!candidatos.includes('src/assets/login/foto-login.jpeg')) falla('foto-login.jpeg NO está entre los candidatos a commit')
if (candidatos.some((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== '.env.example')) falla('hay un .env* entre los candidatos')

const tmp = mkdtempSync(join(tmpdir(), 'clon-limpio-'))
const clon = join(tmp, 'clon')
for (const f of candidatos) { mkdirSync(dirname(join(clon, f)), { recursive: true }); cpSync(f, join(clon, f)) }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const sh = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
console.log(`candidatos: ${candidatos.length} archivos; clon en ${clon}`)
const ci = sh(npm, ['ci', '--no-audit', '--no-fund'], clon)
if (ci.status !== 0) falla('npm ci falló en el clon:\n' + ci.stderr.slice(-800))
const b1 = sh(npm, ['run', 'build:cloudflare'], clon, { ...envBuild, CF_OUT_DIR: join(tmp, 'dist-clon') })
if (b1.status !== 0) falla('build en el clon limpio FALLÓ:\n' + (b1.stdout + b1.stderr).slice(-1200))
const b2 = sh(npm, ['run', 'build:cloudflare'], process.cwd(), { ...envBuild, CF_OUT_DIR: join(tmp, 'dist-arbol') })
if (b2.status !== 0) falla('build del árbol de trabajo FALLÓ:\n' + (b2.stdout + b2.stderr).slice(-1200))

const hashes = (dir) => {
  const out = {}
  const rec = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? rec(join(d, e.name)) : (out[join(d, e.name).slice(dir.length + 1).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(join(d, e.name))).digest('hex'))))
  rec(dir)
  return out
}
const hc = hashes(join(tmp, 'dist-clon'))
const ha = hashes(join(tmp, 'dist-arbol'))
const claves = new Set([...Object.keys(hc), ...Object.keys(ha)])
const dif = [...claves].filter((k) => hc[k] !== ha[k])
const res = { fecha: new Date().toISOString(), candidatos: candidatos.length, incluyeImagenLogin: true, archivosClon: Object.keys(hc).length, archivosArbol: Object.keys(ha).length, diferencias: dif.length, ejemploDiferencias: dif.slice(0, 5), identico: dif.length === 0 }
console.log(JSON.stringify(res))
if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(res, null, 2))
rmSync(tmp, { recursive: true, force: true })
process.exit(res.identico ? 0 : 1)
