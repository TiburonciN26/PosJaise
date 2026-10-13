// Medición de la Fase 6 (sesiones largas, pantallas montadas y animación) sobre un build servido (vite preview) y el Supabase LOCAL.
// SOLO LECTURA: no escribe en la base.
//   node scripts/medir-fase6.cjs --app=http://localhost:5195 --cuentas=<json con admin> --etiqueta=antes --salida=<archivo.json> [--ciclos=3]
//
// Recorre las 27 rutas del POS (administrador) en orden, vuelve a Ventas y repite el ciclo (por defecto 3 veces, comparables entre sí).
// Tras cada ciclo registra, con recolección de basura forzada (HeapProfiler.collectGarbage) y métricas de CDP:
//   · nodos del DOM, pantallas montadas (hijos de <main>), heap JS usado, escuchas de eventos;
//   · en reposo (4 s): llamadas a requestAnimationFrame y setTimeout por segundo, intervalos activos, y la variación de
//     TaskDuration / ScriptDuration / LayoutCount / RecalcStyleCount.
// Una «fuga» solo se afirma si el heap o los nodos CRECEN ciclo a ciclo tras el primero; esta herramienta solo mide.
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app')
const ETIQUETA = arg('etiqueta', 'medicion')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const CICLOS = Number(arg('ciclos', '3'))
const CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(path.resolve(arg('cuentas')), 'utf8'))
if (!APP || !CUENTAS || !SALIDA) { console.error('uso: --app=<url> --cuentas=<json> --salida=<archivo> [--etiqueta=antes] [--ciclos=3]'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
if (env.VITE_SUPABASE_URL !== API) { console.error(`.env.local no apunta a ${API}: no se ejecuta.`); process.exit(2) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const RUTAS = ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas', '/auditoria', '/clientes', '/deudas', '/porcentajes', '/gastos', '/asistentes', '/mobiliario', '/web', '/promociones', '/pedidos-web', '/resenas-web', '/contacto-web', '/puntos-web', '/referidos-web', '/fidelizacion-web', '/recompensas-web', '/catalogo-web', '/libro-reclamaciones-web', '/galeria-web']

async function main() {
  const navegador = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
  // sesión
  const c0 = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const p0 = await c0.newPage()
  await p0.goto(`${APP}/login`)
  await p0.fill('#email', CUENTAS.admin.email)
  await p0.fill('#password', CUENTAS.admin.password)
  await p0.click('button[type=submit]')
  await p0.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
  await p0.waitForTimeout(1200)
  const estado = await c0.storageState()
  await c0.close()

  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estado })
  await ctx.addInitScript(() => {
    const m = { raf: 0, timeouts: 0, intervalos: new Set(), tareasLargas: [] }
    window.__m = m
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => { m.raf += 1; return raf(cb) }
    const st = window.setTimeout.bind(window)
    window.setTimeout = (cb, ms, ...a) => { m.timeouts += 1; return st(cb, ms, ...a) }
    const si = window.setInterval.bind(window)
    const ci = window.clearInterval.bind(window)
    window.setInterval = (cb, ms, ...a) => { const id = si(cb, ms, ...a); m.intervalos.add(id); return id }
    window.clearInterval = (id) => { m.intervalos.delete(id); return ci(id) }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.tareasLargas.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch { /* sin soporte */ }
  })
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== new URL(APP).origin && route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (u.origin === API && u.pathname.includes('/storage/v1/object/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    return route.continue()
  })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  let enVuelo = 0
  let ultima = Date.now()
  page.on('request', (r) => { if (new URL(r.url()).origin === API) { enVuelo += 1; ultima = Date.now() } })
  page.on('requestfinished', (r) => { if (new URL(r.url()).origin === API) { enVuelo = Math.max(0, enVuelo - 1); ultima = Date.now() } })
  page.on('requestfailed', (r) => { if (new URL(r.url()).origin === API) enVuelo = Math.max(0, enVuelo - 1) })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  const quieto = async (ms = 700) => {
    const tope = Date.now() + 25000
    while (Date.now() < tope) { if (enVuelo === 0 && Date.now() - ultima >= ms) return; await page.waitForTimeout(120) }
  }
  const metricas = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
    const dom = await page.evaluate(() => {
      const main = document.querySelector('main')
      return {
        nodos: document.querySelectorAll('*').length,
        pantallas: main ? main.querySelectorAll(':scope > div').length : 0,
        pantallasVisibles: main ? [...main.querySelectorAll(':scope > div')].filter((d) => getComputedStyle(d).display !== 'none').length : 0,
        intervalos: window.__m.intervalos.size,
      }
    })
    return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), escuchas: m.JSEventListeners, nodosCDP: m.Nodes, ...dom, layout: m.LayoutCount, estilos: m.RecalcStyleCount, tarea: m.TaskDuration, script: m.ScriptDuration }
  }
  const irA = async (ruta) => {
    await page.evaluate((r) => { history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, ruta)
  }

  await page.goto(`${APP}/ventas`)
  await page.waitForSelector('main')
  await quieto(1000)
  const inicial = await metricas()
  const ciclos = []
  for (let c = 1; c <= CICLOS; c += 1) {
    const porRuta = []
    for (const ruta of RUTAS) {
      const t0 = Date.now()
      await irA(ruta)
      await page.waitForTimeout(150)
      await quieto(600)
      const m = await metricas()
      porRuta.push({ ruta, ms: Date.now() - t0, nodos: m.nodos, heapMB: m.heapMB, pantallas: m.pantallas, intervalos: m.intervalos })
    }
    await irA('/ventas')
    await page.waitForTimeout(150)
    await quieto(800)
    const finCiclo = await metricas()
    // reposo en Ventas: trabajo sostenido sin interacción
    const antes = await page.evaluate(() => ({ raf: window.__m.raf, to: window.__m.timeouts, t: performance.now() }))
    const m0 = await cdp.send('Performance.getMetrics')
    await page.waitForTimeout(4000)
    const despues = await page.evaluate(() => ({ raf: window.__m.raf, to: window.__m.timeouts, t: performance.now(), largas: window.__m.tareasLargas.length }))
    const m1 = await cdp.send('Performance.getMetrics')
    const g = (ms, n) => ms.metrics.find((x) => x.name === n).value
    const seg = (despues.t - antes.t) / 1000
    const reposo = {
      rafPorSeg: +((despues.raf - antes.raf) / seg).toFixed(1),
      timeoutsPorSeg: +((despues.to - antes.to) / seg).toFixed(1),
      intervalosActivos: finCiclo.intervalos,
      tareaMsPorSeg: +(((g(m1, 'TaskDuration') - g(m0, 'TaskDuration')) * 1000) / seg).toFixed(1),
      scriptMsPorSeg: +(((g(m1, 'ScriptDuration') - g(m0, 'ScriptDuration')) * 1000) / seg).toFixed(1),
      layoutPorSeg: +((g(m1, 'LayoutCount') - g(m0, 'LayoutCount')) / seg).toFixed(1),
      estilosPorSeg: +((g(m1, 'RecalcStyleCount') - g(m0, 'RecalcStyleCount')) / seg).toFixed(1),
    }
    const maxima = porRuta.reduce((a, x) => (x.nodos > a.nodos ? x : a), porRuta[0])
    ciclos.push({ ciclo: c, finCiclo, reposo, maxNodos: { ruta: maxima.ruta, nodos: maxima.nodos }, maxPantallas: Math.max(...porRuta.map((x) => x.pantallas)), maxHeapMB: Math.max(...porRuta.map((x) => x.heapMB)), msRecorrido: porRuta.reduce((a, x) => a + x.ms, 0), porRuta })
    console.log(`ciclo ${c}: nodos=${finCiclo.nodos} pantallas=${finCiclo.pantallas} heap=${finCiclo.heapMB}MB (máx ${Math.max(...porRuta.map((x) => x.heapMB))}) máxNodos=${maxima.nodos} reposo: raf=${reposo.rafPorSeg}/s timeouts=${reposo.timeoutsPorSeg}/s intervalos=${reposo.intervalosActivos} tarea=${reposo.tareaMsPorSeg}ms/s`)
  }
  const largas = await page.evaluate(() => window.__m.tareasLargas)
  await navegador.close()
  fs.writeFileSync(SALIDA, JSON.stringify({ etiqueta: ETIQUETA, app: APP, fecha: new Date().toISOString(), rutas: RUTAS.length, inicial, ciclos, tareasLargasMs: largas, errores }, null, 1))
  console.log('guardado', SALIDA, 'errores de página:', errores.length)
}
main().catch((e) => { console.error(e); process.exit(1) })
