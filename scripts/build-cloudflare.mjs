// Build para Cloudflare Pages (raíz del dominio). Uso: npm run build:cloudflare
//  · VITE_BASE_PATH=/ (la base ya es "/" en vite.config.js; GitHub Pages se retiró el 2026-11-18).
//  · Quita dist/404.html si apareciera (era el truco de SPA de GitHub Pages): con él, Pages no aplica su fallback de SPA.
//  · Copia cloudflare/_headers a la salida.
//  · En Cloudflare (CF_PAGES=1) valida ANTES de iniciar Vite el backend y la clave por entorno
//    (scripts/lib/entornos-supabase.mjs): preview → staging aprobado; producción → negocio aprobado.
//    Exige RAMA_PRODUCCION explícita (igual a la rama de producción configurada en Pages) y CF_PAGES_BRANCH.
//    Las VITE_* se incrustan al compilar: un build equivocado solo se corrige recompilando.
// Variables VITE_SUPABASE_* las pone el entorno de build de Cloudflare (preview ≠ producción).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { swExcluyeMedios } from './lib/sw-medios.mjs'
import { entornoDeCloudflare, escanearTextoSalida, validarSupabase, REF_PRODUCCION, REF_STAGING } from './lib/entornos-supabase.mjs'
import { agregarCspAHeaders, NOMBRE_CABECERA } from './lib/csp.mjs'
import { escribirSeo } from './lib/seo.mjs'

const falla = (m) => { console.error('build-cloudflare: ' + m); process.exit(1) }
const salida = resolve(process.env.CF_OUT_DIR ?? 'dist')
let refEsperado = null
let entornoCf = null // 'produccion' | 'preview' en Cloudflare; null en un build local

if (process.env.CF_PAGES) {
  const ent = entornoDeCloudflare(process.env)
  if (!ent.ok) falla(ent.motivo)
  entornoCf = ent.entorno
  const v = validarSupabase({ url: process.env.VITE_SUPABASE_URL, clave: process.env.VITE_SUPABASE_ANON_KEY, entorno: ent.entorno })
  if (!v.ok) falla(v.motivo)
  refEsperado = v.refEsperado
  console.log(`build-cloudflare: entorno=${ent.entorno} rama=${ent.rama} backend=${v.refEsperado === REF_PRODUCCION ? 'negocio' : 'staging'} clave=${v.tipoClave}`)
  // Marca de versión = commit corto (permite distinguir builds y probar la actualización PWA).
  if (process.env.CF_PAGES_COMMIT_SHA && !process.env.VITE_BUILD_ID) process.env.VITE_BUILD_ID = process.env.CF_PAGES_COMMIT_SHA.slice(0, 8)
}

// Solo para las pruebas de las salvaguardas: valida y sale ANTES de iniciar Vite.
if (process.argv.includes('--solo-validar')) { console.log('validación OK (--solo-validar: no se compila)'); process.exit(0) }

// Puerta de despliegue (auditoría global 2026-11-20, hallazgo 18.1). Cloudflare Pages ejecuta ESTE script en cada push,
// así que si el lint o los tests autónomos fallan, no hay build y no se publica nada: queda la versión anterior.
// Corre siempre en Cloudflare (CF_PAGES) y en local con --verificar (`npm run verificar`): el mismo camino en los dos.
// Vía de escape para un arreglo urgente con un test roto: variable SALTAR_VERIFICACION=1 en el entorno de Pages
// (Settings → Variables), y quitarla en cuanto se arregle el test. Queda impreso en el log del build.
if (process.env.CF_PAGES || process.argv.includes('--verificar')) {
  if (process.env.SALTAR_VERIFICACION === '1') {
    console.warn('build-cloudflare: ⚠ SALTAR_VERIFICACION=1 — se publica SIN lint ni tests. Quitar la variable cuanto antes.')
  } else {
    for (const [nombre, args] of [
      ['lint (oxlint)', [resolve('node_modules/oxlint/bin/oxlint')]],
      ['tests autónomos (npm test)', [resolve('scripts/probar-unitarios.mjs')]],
    ]) {
      console.log(`build-cloudflare: verificando — ${nombre}`)
      const v = spawnSync(process.execPath, args, { stdio: 'inherit' })
      if (v.status !== 0) falla(`${nombre} falló: NO se compila ni se publica. Corrige y vuelve a hacer push (o ver SALTAR_VERIFICACION arriba).`)
    }
  }
}

const vite = resolve('node_modules/vite/bin/vite.js')
const r = spawnSync(process.execPath, [vite, 'build', '--outDir', salida, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: '/' },
})
if (r.status !== 0) process.exit(r.status ?? 1)

rmSync(resolve(salida, '404.html'), { force: true })
copyFileSync(resolve('cloudflare/_headers'), resolve(salida, '_headers'))
// CSP (scripts/lib/csp.mjs): orígenes de ESTE build (los mismos VITE_* que leyó Vite: .env + entorno, el entorno manda)
// y hashes de los scripts inline del index.html ya compilado.
{
  const { loadEnv } = await import('vite')
  const envVite = loadEnv('production', process.cwd(), 'VITE_')
  const politica = agregarCspAHeaders(salida, envVite)
  console.log(`build-cloudflare: ${NOMBRE_CABECERA} (${politica.length} caracteres)`)
  // SEO (scripts/lib/seo.mjs): robots.txt + sitemap.xml. Preview de Cloudflare: no indexar. El catálogo (ids de servicios y
  // productos para el sitemap) se consulta solo en producción, o en local con --sitemap-con-catalogo para probarlo.
  const { secciones } = await import('../src/config/navegacion.js')
  const resumen = await escribirSeo(salida, {
    env: envVite,
    indexar: entornoCf !== 'preview',
    rutasPos: secciones.map((s) => s.path),
    consultarCatalogo: entornoCf === 'produccion' || process.argv.includes('--sitemap-con-catalogo'),
  })
  console.log(`build-cloudflare: ${resumen}`)
}
// Entrega de medios por Pages Functions (functions/medios*): SOLO /medios y /medios/* invocan Functions; el resto
// (SPA, assets, sw.js) sigue siendo estático. Debe estar en la SALIDA (dist), no en la raíz del repo.
writeFileSync(resolve(salida, '_routes.json'), JSON.stringify({ version: 1, include: ['/medios', '/medios/*'], exclude: [] }, null, 2) + '\n')

// Comprobaciones de la salida: nada apuntando a /PosJaise/ ni a un 404.html precacheado, y ninguna clave privilegiada.
if (existsSync(resolve(salida, '404.html'))) falla('404.html sigue en la salida')
const html = readFileSync(resolve(salida, 'index.html'), 'utf8')
if (html.includes('/PosJaise/')) falla('index.html referencia /PosJaise/')
if (readFileSync(resolve(salida, 'sw.js'), 'utf8').includes('404.html')) falla('sw.js precachea 404.html')
if (readFileSync(resolve(salida, 'manifest.webmanifest'), 'utf8').includes('PosJaise')) falla('manifest referencia PosJaise')
function archivos(d) { return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)])) }
for (const f of archivos(salida).filter((x) => /\.(js|html|json|webmanifest|css|txt)$/.test(x))) {
  const h = escanearTextoSalida(readFileSync(f, 'utf8'), refEsperado ?? REF_STAGING)
  // Fuera de Cloudflare (build manual local) el JWT local puede aparecer: solo se exige que no haya privilegiadas.
  const graves = refEsperado ? h : h.filter((x) => x === 'sb_secret_' || /role "service_role"|role "authenticated"/.test(x))
  if (graves.length) falla(`la salida contiene credenciales no permitidas (${graves[0]}) en ${f.replace(salida, '')}`)
}
const rutas = JSON.parse(readFileSync(resolve(salida, '_routes.json'), 'utf8'))
if (rutas.version !== 1 || rutas.include.join() !== '/medios,/medios/*' || rutas.exclude.length) falla('_routes.json inesperado')
const swSalida = readFileSync(resolve(salida, 'sw.js'), 'utf8')
if (!swExcluyeMedios(swSalida)) falla('sw.js no excluye /medios/ de la navegación (navigateFallbackDenylist)')
// Fase 8 V2 (F8-02): las reglas de caché por uso viven en sw-reglas-cache.js; sin él el SW no se instala (falla cerrado),
// pero el build no debe publicarse así.
if (!/importScripts\(\s*"sw-reglas-cache\.js"\s*\)/.test(swSalida) || !existsSync(resolve(salida, 'sw-reglas-cache.js'))) falla('sw.js no importa sw-reglas-cache.js o falta en la salida')
if (/sameOrigin\s*&&/.test(swSalida)) falla('sw.js conserva una regla de caché por «mismo origen» (F8-02)')
console.log('build-cloudflare: OK (base /, sin 404.html, _headers y _routes.json, SW sin fallback en /medios, reglas de caché por uso, sin credenciales privilegiadas)')
