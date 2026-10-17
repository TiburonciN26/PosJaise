// ML-03 sobre el BUNDLE COMPILADO de un paquete de lectura mixta (no sobre el código fuente), sin tocar staging ni ninguna red real.
//   node scripts/verificar-ml03-bundle.cjs <carpeta-del-paquete> [--salida=<carpeta nueva>]
// Sirve <paquete>/dist en 127.0.0.1 (base «/», fallback SPA) y abre /nosotros en Chromium. TODA petición a otro host se intercepta:
// el RPC galeria_para_web devuelve filas ficticias, el resto de Supabase responde vacío y las imágenes se cumplen con un PNG de 1×1,
// registrando la URL que el bundle realmente pidió. Cualquier otro destino se aborta y hace fallar la corrida.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const paquete = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null
if (!paquete || !fs.existsSync(path.join(paquete, 'manifiesto-lectura-mixta.json'))) { console.error('uso: verificar-ml03-bundle.cjs <carpeta con manifiesto-lectura-mixta.json> [--salida=<carpeta>]'); process.exit(2) }
const manifiesto = JSON.parse(fs.readFileSync(path.join(paquete, 'manifiesto-lectura-mixta.json'), 'utf8'))
const cfg = manifiesto.configuracionMedios
const dist = path.join(paquete, 'dist')

const R2DEV = cfg.basesReconocidas // base antigua reconocida (solo lectura)
const PAGES = cfg.publica // <alias>/medios, con B activa
const U = (n) => `0f1e2d3c-4b5a-4968-8777-6655443322${String(n).padStart(2, '0')}`
const AJENA = 'https://ajena.example.org/fotos-galeria/' + U(9) + '/g.webp'
const filas = [
  { id: 'a', titulo: 'ML03 r2dev', antes_url: `${R2DEV}/fotos-galeria/${U(1)}/g.webp`, despues_url: `${R2DEV}/fotos-galeria/${U(2)}/m.webp` },
  { id: 'b', titulo: 'ML03 pages', antes_url: `${PAGES}/fotos-galeria/${U(3)}/g.webp`, despues_url: `${PAGES}/fotos-galeria/${U(4)}/m.webp` },
  { id: 'c', titulo: 'ML03 ajena y relativa', antes_url: AJENA, despues_url: 'inicio-web/antes-claro.webp' },
]

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
const servidor = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  let f = path.join(dist, p)
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html')
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res)
})

const casos = []
const caso = (nombre, fn) => {
  try { fn(); casos.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { casos.push({ nombre, ok: false, error: String(e.message).split('\n')[0].slice(0, 300) }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

;(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const origen = `http://127.0.0.1:${servidor.address().port}`
  const imagenes = [] // peticiones de imagen INTERCEPTADAS (prueba de que algo se pidió); locales y externas
  const otras = []
  const rpc = []
  const errores = []
  let srcs = []
  let navegador = null
  try {
    navegador = await chromium.launch()
    // serviceWorkers:'block' — browserContext.route no intercepta lo que atiende un Service Worker; sin esto la simulación de red
    // no estaría garantizada si el sw.js del paquete llegara a responder por su cuenta.
    const ctx = await navegador.newContext({ serviceWorkers: 'block' })
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url())
      if (u.origin === origen) {
        if (route.request().resourceType() === 'image') imagenes.push(route.request().url())
        return route.continue()
      }
      if (/\.supabase\.co$/.test(u.hostname) && u.pathname.endsWith('/rest/v1/rpc/galeria_para_web')) {
        rpc.push(u.pathname)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filas) })
      }
      if (/\.supabase\.co$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      if (route.request().resourceType() === 'image') { imagenes.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) }
      otras.push(`${route.request().resourceType()} ${route.request().url()}`)
      return route.abort()
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errores.push(String(e.message)))
    await page.goto(`${origen}/nosotros`, { waitUntil: 'load' })
    await page.getByText('Galería', { exact: true }).first().click() // pestaña «Galería» de /nosotros (usa galeria_para_web)
    await page.waitForFunction((n) => document.querySelectorAll('img').length >= n, 4, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1500)
    srcs = await page.$$eval('img', (is) => is.map((i) => i.currentSrc || i.src).filter(Boolean))
  } finally {
    await navegador?.close().catch(() => {})
    servidor.closeAllConnections?.()
    await new Promise((r) => servidor.close(r))
  }

  const pedidas = new Set(imagenes) // un src presente en el DOM NO prueba por sí solo una petición: se exige la petición interceptada
  const enDom = new Set(srcs)
  const tiene = (u) => pedidas.has(u)
  caso('el bundle pidió el RPC de galería (la prueba ejercita la ruta real)', () => assert.ok(rpc.length >= 1))
  caso('URL antigua r2.dev (destino fotos-galeria, UUID y variante g) → se pide por /medios del alias conservando UUID y variante', () => {
    assert.ok(tiene(`${PAGES}/fotos-galeria/${U(1)}/g.webp`), 'no se pidió la URL reescrita')
    assert.ok(![...pedidas].some((u) => u.startsWith(R2DEV)), 'el bundle sigue pidiendo directamente a r2.dev: ' + [...pedidas].filter((u) => u.startsWith(R2DEV)).join(' '))
  })
  caso('URL antigua r2.dev con variante m → /medios conservando la variante m', () => assert.ok(tiene(`${PAGES}/fotos-galeria/${U(2)}/m.webp`)))
  caso('URL ya en /medios del alias → intacta', () => assert.ok(tiene(`${PAGES}/fotos-galeria/${U(3)}/g.webp`) && tiene(`${PAGES}/fotos-galeria/${U(4)}/m.webp`)))
  caso('URL ajena → intacta (no se reescribe a /medios)', () => { assert.ok(tiene(AJENA)); assert.ok(![...pedidas].some((u) => u.startsWith(PAGES) && u.includes(U(9)))) })
  caso('ruta relativa histórica de /public → foto actual en el origen del propio sitio', () => assert.ok(tiene(`${origen}/inicio-web/hero-antes-claro.webp`)))
  caso('el DOM coincide con las peticiones: ninguna <img> apunta a r2.dev y las reescritas aparecen también como src', () => {
    assert.ok(![...enDom].some((u) => u.startsWith(R2DEV)))
    assert.ok(enDom.has(`${PAGES}/fotos-galeria/${U(1)}/g.webp`) && enDom.has(`${PAGES}/fotos-galeria/${U(2)}/m.webp`))
  })
  caso('ninguna petición a destinos no simulados (fuentes, analítica, etc. abortadas) ni errores de página', () => {
    assert.deepEqual(errores, [])
    const tercerosNoImagen = otras.filter((x) => !/fonts\.(googleapis|gstatic)\.com/.test(x))
    assert.deepEqual(tercerosNoImagen, [])
  })

  const fallos = casos.filter((c) => !c.ok)
  const salida = arg('salida')
  if (salida) {
    fs.mkdirSync(path.resolve(salida), { recursive: true })
    fs.writeFileSync(path.join(path.resolve(salida), 'ml03-bundle.json'), JSON.stringify({
      fecha: new Date().toISOString(), commit: manifiesto.commit, swSha256: manifiesto.swSha256, modulos: manifiesto.modulosConConfiguracion,
      configuracionMedios: cfg, filasSimuladas: filas, imagenesPedidas: [...pedidas], srcsEnDom: [...enDom], solicitudesAbortadas: otras, casos, total: casos.length, fallos: fallos.length,
    }, null, 2))
  }
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
