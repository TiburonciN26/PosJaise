// Compila el frontend para el preview de Cloudflare Pages (Direct Upload) con las variables
// de STAGING y base raíz. Las variables VITE_* se incrustan en el JS al compilar: cambiarlas
// después en el dashboard de Pages NO tiene efecto sobre archivos ya compilados.
//
// Uso:  node scripts/build-preview-staging.mjs [--deploy]
//   Secretos: archivo local `.env.staging.local` (ignorado por git; NO se pega en chats) o variables de entorno:
//     VITE_SUPABASE_URL=https://<ref-staging>.supabase.co
//     VITE_SUPABASE_ANON_KEY=<anon/publishable de staging>
//     (opcional) VITE_CULQI_PUBLIC_KEY=<llave de PRUEBAS>
//   --deploy: `wrangler pages deploy` al proyecto pos-jaise-preview (rama `preview`), usando la sesión
//   de `wrangler login` o CLOUDFLARE_API_TOKEN local; el token nunca pasa por este script.
// Salvaguardas: se niega a compilar si la URL es local/no-HTTPS, es el proyecto de PRODUCCIÓN, o si el
// bundle resultante contiene otra URL de Supabase distinta a la de staging.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, copyFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { escanearTextoSalida, validarSupabase, REF_PRODUCCION, REF_STAGING } from './lib/entornos-supabase.mjs'

const PROYECTO_PAGES = 'pos-jaise-preview'
const argv = process.argv.slice(2)
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
// --out=<carpeta> (por defecto dist-preview; debe ser ignorada por git) · --build-id=<marca> (versión distinguible, p. ej. para probar la actualización PWA)
const salida = resolve(opt('out') ?? 'dist-preview')
const buildId = opt('build-id')

function leerEnvLocal() {
  const f = resolve('.env.staging.local')
  const out = {}
  if (!existsSync(f)) return out
  for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}
const env = { ...leerEnvLocal(), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_SUPABASE') || k === 'VITE_CULQI_PUBLIC_KEY')) }
const falla = (m) => { console.error('build-preview-staging: ' + m); process.exit(1) }

const url = env.VITE_SUPABASE_URL
// Clasificación compartida con build-cloudflare (ANTES de iniciar Vite; nunca imprime la clave): exige el backend de
// STAGING aprobado y una clave anon/publishable válida; rechaza sb_secret_, service_role, authenticated, rotas y desconocidas.
const v = validarSupabase({ url, clave: env.VITE_SUPABASE_ANON_KEY, entorno: 'preview' })
if (!v.ok) falla(v.motivo)

// Solo para las pruebas de las salvaguardas: valida y sale ANTES de iniciar Vite.
if (process.argv.includes('--solo-validar')) { console.log('validación OK (--solo-validar: no se compila)'); process.exit(0) }

rmSync(salida, { recursive: true, force: true })
const r = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', salida, '--emptyOutDir'], {
  stdio: 'inherit',
  // Las VITE_* del entorno del proceso tienen prioridad sobre .env.local (que apunta al Supabase local);
  // igualmente el artefacto se verifica abajo y se rechaza si contiene el endpoint local.
  env: { ...process.env, ...env, VITE_BASE_PATH: '/', ...(buildId ? { VITE_BUILD_ID: buildId } : {}) },
})
if (r.status !== 0) process.exit(r.status ?? 1)
rmSync(join(salida, '404.html'), { force: true })
copyFileSync(resolve('cloudflare/_headers'), join(salida, '_headers'))
// Pages preview: sin indexación
// (Pages ya añade X-Robots-Tag: noindex a *.pages.dev, esto es solo cinturón y tirantes en el mismo archivo)
const headers = readFileSync(join(salida, '_headers'), 'utf8') + '\n/*\n  X-Robots-Tag: noindex, nofollow\n'
writeFileSync(join(salida, '_headers'), headers)

// Verificación del artefacto
function archivos(d) { return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)])) }
const urlsSupabase = new Set()
let contieneStaging = false
for (const f of archivos(salida).filter((x) => /\.(js|html|webmanifest)$/.test(x))) {
  const t = readFileSync(f, 'utf8')
  if (t.includes(url.replace(/\/$/, ''))) contieneStaging = true
  for (const m of t.matchAll(/https?:\/\/[a-z0-9]{20}\.supabase\.co/g)) urlsSupabase.add(m[0])
  if (t.includes('127.0.0.1:54321') || t.includes(REF_PRODUCCION)) falla(`${f} referencia el Supabase local o de producción`)
  const privados = escanearTextoSalida(t, REF_STAGING)
  if (privados.length) falla(`${f.replace(salida, '')} contiene credenciales no permitidas (${privados[0]})`)
  if (/\/PosJaise\//.test(t) && /index\.html$|manifest/.test(f)) falla(`${f} referencia /PosJaise/`)
}
if (!contieneStaging) falla('el bundle no contiene la URL de staging')
if ([...urlsSupabase].some((u) => u !== url.replace(/\/$/, ''))) falla('el bundle contiene otra URL de Supabase: ' + [...urlsSupabase].join(', '))
console.log(`build-preview-staging: OK → ${salida} (${archivos(salida).length} archivos, ${(archivos(salida).reduce((a, f) => a + statSync(f).size, 0) / 1048576).toFixed(1)} MiB); Supabase = ${url}`)

if (process.argv.includes('--deploy')) {
  const w = spawnSync('npx', ['wrangler', 'pages', 'deploy', salida, `--project-name=${PROYECTO_PAGES}`, '--branch=preview', '--commit-dirty=true'], { stdio: 'inherit', shell: true })
  process.exit(w.status ?? 1)
}
