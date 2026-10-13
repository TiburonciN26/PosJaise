// Medidor de LABORATORIO de los catálogos públicos (Productos y Servicios) para la Fase 4. Mismo script antes y después.
//   node scripts/medir-catalogos-fase4.cjs --etiqueta=antes-3245 --salida=<carpeta> [--muestras=3] [--rutas=productos,servicios] [--viewports=390,412,1440]
//
// Contra la app local (Vite) y el Supabase LOCAL; cualquier otro origen se ABORTA. Por muestra: contexto nuevo (sin caché), CPU 4×
// (CDP Emulation.setCPUThrottlingRate), viewport 390/412/1440. Mide carga (hasta la primera tarjeta, DOM, peticiones al catálogo y
// bytes), imágenes pedidas (se responden con un PNG de 1×1: aquí solo importa QUÉ se pide) y una BÚSQUEDA escrita tecla a tecla
// (duración de eventos con Event Timing, tareas largas ≥50 ms y tiempo hasta que el resultado se asienta). Son números de laboratorio:
// NO son INP ni LCP reales de usuarios. Sin tokens ni datos personales en la salida; la sesión es anónima (catálogo público).
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const ETIQUETA = arg('etiqueta')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const MUESTRAS = Number(arg('muestras', '3'))
const RUTAS = arg('rutas', 'productos,servicios').split(',')
const ANCHOS = arg('viewports', '390,412,1440').split(',').map(Number)
const APP = arg('app', 'http://localhost:5173')
const API_LOCAL = 'http://127.0.0.1:54321'
if (!ETIQUETA || !SALIDA) { console.error('uso: --etiqueta=<texto> --salida=<carpeta>'); process.exit(2) }

const VIEWPORTS = { 390: { width: 390, height: 844, isMobile: true }, 412: { width: 412, height: 915, isMobile: true }, 1440: { width: 1440, height: 900, isMobile: false } }
const CONFIG = {
  productos: { ruta: '/productos', campo: 'Buscar producto', termino: 'ULTIMA UNIDAD', objetivo: /ULTIMA UNIDAD/, tabla: 'productos' },
  servicios: { ruta: '/servicios', campo: 'Buscar servicio', termino: 'PORC muy8', objetivo: /PORC muy8/, tabla: 'servicios' },
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null }

const INIT = `
  window.__m = { lt: [], ev: [] };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__m.lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }) } catch {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__m.ev.push([e.name, e.startTime, e.duration]))).observe({ type: 'event', durationThreshold: 16, buffered: true }) } catch {}
`

async function esperarEstable(page, ms, tope) {
  const firma = () => page.evaluate(() => `${document.querySelectorAll('article').length}|${(document.body.innerText.match(/Sin resultados[^\n]*/) || [''])[0]}|${document.querySelectorAll('[aria-busy="true"]').length}`)
  const t0 = Date.now()
  let ultima = await firma()
  let desde = Date.now()
  while (Date.now() - t0 < tope) {
    await page.waitForTimeout(50)
    const f = await firma()
    if (f !== ultima) { ultima = f; desde = Date.now() }
    else if (Date.now() - desde >= ms && !/\|[1-9]\d*$/.test(f)) return { firma: f, ms: desde - t0 }
  }
  return { firma: ultima, ms: null, agotado: true }
}

// Espera a que el hilo principal lleve `ms` sin tareas largas (montaje y animaciones de entrada ya terminaron) para que la
// búsqueda se mida aislada. Se agregó tras comprobar que las tareas de montaje podían solaparse con las primeras teclas.
async function esperarSilencio(page, ms, tope) {
  const t0 = Date.now()
  while (Date.now() - t0 < tope) {
    const quieto = await page.evaluate((silencio) => {
      const lt = window.__m.lt
      const ultimo = lt.length ? lt[lt.length - 1][0] + lt[lt.length - 1][1] : 0
      return performance.now() - ultimo >= silencio
    }, ms)
    if (quieto) return true
    await page.waitForTimeout(100)
  }
  return false
}

async function muestra(navegador, nombreRuta, ancho, indice) {
  const cfg = CONFIG[nombreRuta]
  const ctx = await navegador.newContext({ viewport: { width: VIEWPORTS[ancho].width, height: VIEWPORTS[ancho].height }, isMobile: VIEWPORTS[ancho].isMobile, hasTouch: VIEWPORTS[ancho].isMobile, serviceWorkers: 'block' })
  await ctx.addInitScript(INIT)
  const bloqueadas = []
  const imagenes = []
  const catalogo = []
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const origen = u.origin
    if (origen === new URL(APP).origin) return route.continue()
    if (origen === API_LOCAL) {
      if (route.request().resourceType() === 'image' || u.pathname.includes('/storage/v1/object/')) { imagenes.push(u.pathname); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) }
      return route.continue()
    }
    if (route.request().resourceType() === 'image') { imagenes.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) }
    bloqueadas.push(origen)
    return route.abort()
  })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.origin === API_LOCAL && /\/rest\/v1\//.test(u.pathname) && !/\/(contacto|horario|politicas|datos_|equipo|resenas)/.test(u.pathname)) catalogo.push({ r, ruta: u.pathname.replace('/rest/v1/', ''), consulta: u.search.slice(0, 160) })
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  const resultado = { ruta: nombreRuta, ancho, indice }
  await page.goto(`${APP}${cfg.ruta}`, { waitUntil: 'commit' })
  const hastaTarjeta = await page.waitForFunction(() => (document.querySelectorAll('article').length > 0 ? performance.now() : false), null, { timeout: 180000, polling: 50 }).then((h) => h.jsonValue()).catch(() => null)
  resultado.cargaHastaPrimeraTarjetaMs = hastaTarjeta && Math.round(hastaTarjeta)
  const quieto = await esperarEstable(page, 800, 60000)
  resultado.cargaAsentadaMs = quieto.ms
  resultado.dom = await page.evaluate(() => ({ nodos: document.getElementsByTagName('*').length, tarjetas: document.querySelectorAll('article').length, imgs: document.querySelectorAll('img').length }))
  resultado.pedidosCatalogoCarga = []
  for (const c of catalogo) {
    let bytes = null
    try { bytes = (await c.r.body()).length } catch {}
    resultado.pedidosCatalogoCarga.push({ ruta: c.ruta.split('?')[0], consulta: c.consulta, estado: c.r.status(), bytes })
  }
  resultado.bytesCatalogoCarga = resultado.pedidosCatalogoCarga.reduce((s, c) => s + (c.bytes ?? 0), 0)
  resultado.imagenesCarga = imagenes.length
  const mCarga = await page.evaluate(() => ({ lt: window.__m.lt.slice(), ev: window.__m.ev.slice() }))
  resultado.cargaTareasLargas = { n: mCarga.lt.length, maxMs: Math.round(Math.max(0, ...mCarga.lt.map((t) => t[1]))), totalMs: Math.round(mCarga.lt.reduce((s, t) => s + t[1], 0)) }

  // ---- búsqueda ----
  resultado.silencioAntesDeBuscar = await esperarSilencio(page, 1500, 30000)
  await page.evaluate(() => { window.__m.lt.length = 0; window.__m.ev.length = 0 })
  const antesCatalogo = catalogo.length
  const antesImagenes = imagenes.length
  const campo = page.getByLabel(cfg.campo, { exact: true })
  await campo.click()
  const t0 = Date.now()
  await page.keyboard.type(cfg.termino, { delay: 40 })
  const tEscritura = Date.now() - t0
  const t1 = Date.now()
  const quietoB = await esperarEstable(page, 800, 60000)
  const mBusq = await page.evaluate(() => ({ lt: window.__m.lt.slice(), ev: window.__m.ev.slice() }))
  const textos = await page.$$eval('article', (as) => as.map((a) => a.innerText))
  resultado.busqueda = {
    termino: cfg.termino,
    escrituraMs: tEscritura,
    hastaAsentarMs: quietoB.ms == null ? null : Date.now() - t1 - 800,
    encontroObjetivo: textos.some((t) => cfg.objetivo.test(t)),
    tarjetas: textos.length,
    dom: await page.evaluate(() => document.getElementsByTagName('*').length),
    pedidosCatalogo: catalogo.length - antesCatalogo,
    imagenesPedidas: imagenes.length - antesImagenes,
    tareasLargas: { n: mBusq.lt.length, maxMs: Math.round(Math.max(0, ...mBusq.lt.map((t) => t[1]))), totalMs: Math.round(mBusq.lt.reduce((s, t) => s + t[1], 0)) },
    eventoMaxMs: Math.round(Math.max(0, ...mBusq.ev.map((e) => e[2]))),
    eventos: mBusq.ev.length,
  }
  resultado.errores = errores
  resultado.origenesBloqueados = [...new Set(bloqueadas)]
  await ctx.close()
  return resultado
}

;(async () => {
  fs.mkdirSync(SALIDA, { recursive: true })
  const navegador = await chromium.launch()
  const crudas = []
  for (const r of RUTAS) for (const a of ANCHOS) for (let i = 1; i <= MUESTRAS; i++) {
    process.stdout.write(`${ETIQUETA} · ${r} · ${a}px · muestra ${i}/${MUESTRAS} … `)
    try {
      const m = await muestra(navegador, r, a, i)
      crudas.push(m)
      console.log(`primera tarjeta ${m.cargaHastaPrimeraTarjetaMs} ms · ${m.dom.tarjetas} tarjetas · búsqueda: ${m.busqueda.tarjetas} tarjetas, evento máx ${m.busqueda.eventoMaxMs} ms, tarea larga máx ${m.busqueda.tareasLargas.maxMs} ms, objetivo ${m.busqueda.encontroObjetivo}`)
    } catch (e) {
      crudas.push({ ruta: r, ancho: a, indice: i, error: String(e.message).slice(0, 300) })
      console.log('ERROR ' + String(e.message).slice(0, 160))
    }
  }
  await navegador.close()
  const resumen = []
  for (const r of RUTAS) for (const a of ANCHOS) {
    const g = crudas.filter((c) => c.ruta === r && c.ancho === a && !c.error)
    if (!g.length) continue
    resumen.push({
      ruta: r, ancho: a, muestras: g.length,
      primeraTarjetaMs: mediana(g.map((c) => c.cargaHastaPrimeraTarjetaMs).filter(Number.isFinite)),
      tarjetasMontadas: mediana(g.map((c) => c.dom.tarjetas)),
      nodosDom: mediana(g.map((c) => c.dom.nodos)),
      bytesCatalogoCarga: mediana(g.map((c) => c.bytesCatalogoCarga)),
      pedidosCatalogoCarga: mediana(g.map((c) => c.pedidosCatalogoCarga.length)),
      imagenesCarga: mediana(g.map((c) => c.imagenesCarga)),
      cargaTareaLargaMaxMs: Math.max(...g.map((c) => c.cargaTareasLargas.maxMs)),
      busquedaHastaAsentarMs: mediana(g.map((c) => c.busqueda.hastaAsentarMs).filter(Number.isFinite)),
      busquedaEventoMaxMs: Math.max(...g.map((c) => c.busqueda.eventoMaxMs)),
      busquedaTareaLargaMaxMs: Math.max(...g.map((c) => c.busqueda.tareasLargas.maxMs)),
      busquedaTarjetas: mediana(g.map((c) => c.busqueda.tarjetas)),
      busquedaEncontroObjetivo: g.every((c) => c.busqueda.encontroObjetivo),
      busquedaPedidosCatalogo: mediana(g.map((c) => c.busqueda.pedidosCatalogo)),
    })
  }
  const informe = { etiqueta: ETIQUETA, fecha: new Date().toISOString(), app: APP, api: API_LOCAL, cpu: '4× (CDP)', muestrasPorCelda: MUESTRAS, nota: 'Laboratorio, sesión anónima, red local, imágenes respondidas con PNG 1×1. No son INP/LCP reales.', resumen, crudas }
  fs.writeFileSync(path.join(SALIDA, `${ETIQUETA}.json`), JSON.stringify(informe, null, 1))
  console.log('\nresumen:'); console.table(resumen.map(({ ruta, ancho, primeraTarjetaMs, tarjetasMontadas, bytesCatalogoCarga, busquedaEventoMaxMs, busquedaTareaLargaMaxMs, busquedaTarjetas, busquedaEncontroObjetivo }) => ({ ruta, ancho, primeraTarjetaMs, tarjetasMontadas, bytesCatalogoCarga, busquedaEventoMaxMs, busquedaTareaLargaMaxMs, busquedaTarjetas, busquedaEncontroObjetivo })))
  process.exitCode = crudas.some((c) => c.error) ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
