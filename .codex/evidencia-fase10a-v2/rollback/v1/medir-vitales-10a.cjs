// Fase 10A · vitales de LABORATORIO (LCP, CLS, FCP, TBT aproximado e interacción) en los escenarios principales, frío y caliente,
// más un escenario de movimiento reducido. Build servido + Supabase LOCAL (127.0.0.1:54321). SOLO LECTURA.
//   node scripts/fase10a/medir-vitales-10a.cjs --app=http://127.0.0.1:5401 --cuentas=<json con admin> --salida=<archivo.json> [--muestras=3]
//
// Método (para comparar entre corridas; NO son LCP/INP/CLS de usuarios reales, que exigen datos de campo en 10B):
//   · Chromium, CPU 4× (Emulation.setCPUThrottlingRate) y red 4G lenta simulada (150 ms RTT, 1,6 Mbps de bajada, 750 kbps de subida)
//     en TODAS las peticiones, también las de Supabase Local. Portal a 390×844 (móvil), POS a 1366×900.
//   · Frío: contexto nuevo (caché HTTP vacía; la sesión, si hace falta, se inyecta como estado guardado). Caliente: recarga en el
//     mismo contexto (caché HTTP llena). Service worker bloqueado en ambos (la segunda visita con PWA ya se midió en la Fase 8).
//   · LCP: último `largest-contentful-paint` antes de interactuar. CLS: mayor ventana de sesión (1 s de hueco, 5 s máx.) sin
//     entradas con interacción reciente. TBT aproximado: suma de (tarea larga − 50 ms) desde FCP hasta 5 s después de cargar.
//     Interacción: mayor `duration` de Event Timing con interactionId de una interacción guionada (escribir en un buscador),
//     como referencia de INP; no es el INP de campo.
//   · Movimiento reducido (prefers-reduced-motion: reduce): en reposo 3 s, llamadas a requestAnimationFrame por segundo y
//     animaciones CSS/WAAPI en curso (document.getAnimations()).
// Sin tokens ni datos personales en la salida.
const fs = require('node:fs')
const cp = require('node:child_process')
const { chromium } = require('playwright')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const APP = arg('app').replace(/\/+$/, ''), SALIDA = arg('salida'), MUESTRAS = Number(arg('muestras', '3'))
const CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(arg('cuentas'), 'utf8'))
if (!APP || !CUENTAS || !SALIDA) { console.error('uso: --app=<url> --cuentas=<json> --salida=<archivo> [--muestras=3]'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
if (!/:54321->8000/.test(cp.execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' }))) throw new Error('Supabase Local no verificado en 54321')
const idProducto = cp.execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: 'begin read only; select id from productos where activo order by nombre limit 1; rollback;', encoding: 'utf8' }).split('\n').find((l) => /^[0-9a-f-]{36}$/.test(l))

const RED = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }
const MOVIL = { width: 390, height: 844 }, ESCRITORIO = { width: 1366, height: 900 }
const ESCENARIOS = [
  { id: 'portal-inicio', ruta: '/inicio', vista: MOVIL },
  { id: 'portal-productos', ruta: '/productos', vista: MOVIL, interaccion: { selector: 'input[placeholder="Buscar producto…"]', texto: 'crema' } },
  { id: 'portal-detalle-producto', ruta: `/productos/${idProducto}`, vista: MOVIL },
  // Con sesión de clienta: comparables con builds en los que el portal exige iniciar sesión (p. ej. `main`, donde un visitante
  // solo ve el login).
  { id: 'clienta-inicio', ruta: '/inicio', vista: MOVIL, sesion: 'clienta' },
  { id: 'clienta-productos', ruta: '/productos', vista: MOVIL, sesion: 'clienta', interaccion: { selector: 'input[placeholder="Buscar producto…"]', texto: 'crema' } },
  { id: 'clienta-detalle-producto', ruta: `/productos/${idProducto}`, vista: MOVIL, sesion: 'clienta' },
  { id: 'pos-ventas', ruta: '/ventas', vista: ESCRITORIO, sesion: true, interaccion: { selector: 'main input:not([type=hidden])', texto: 'crema' } },
  { id: 'pos-pedidos-web', ruta: '/pedidos-web', vista: ESCRITORIO, sesion: true, interaccion: { selector: 'input[placeholder="Buscar por clienta..."]', texto: 'mar' } },
]
const REDUCIDO = [
  { id: 'reducido-inicio', ruta: '/inicio', vista: MOVIL },
  { id: 'reducido-promociones', ruta: '/promociones', vista: ESCRITORIO, sesion: true },
  { id: 'reducido-referidos-web', ruta: '/referidos-web', vista: ESCRITORIO, sesion: true },
]

const OBSERVADORES = () => {
  const m = { lcp: null, lcpEl: null, candidatos: [], fcp: null, cls: 0, ventanas: [], largas: [], eventos: [], raf: 0, cargado: null }
  window.__v = m
  let ventana = { valor: 0, inicio: 0, ultimo: 0 }
  const po = (tipo, fn, extra = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type: tipo, buffered: true, ...extra }) } catch {} }
  po('largest-contentful-paint', (e) => { if (!m.congelado) { m.lcp = e.startTime; m.lcpEl = e.element?.tagName ?? null; m.candidatos.push({ t: Math.round(e.startTime), tam: e.size, el: `${e.element?.tagName ?? '?'}${e.url ? ' ' + e.url.split('/').pop().slice(0, 40) : ' ' + (e.element?.textContent ?? '').trim().slice(0, 30)}` }) } })
  po('paint', (e) => { if (e.name === 'first-contentful-paint') m.fcp = e.startTime })
  po('layout-shift', (e) => {
    if (e.hadRecentInput) return
    if (e.startTime - ventana.ultimo > 1000 || e.startTime - ventana.inicio > 5000) ventana = { valor: 0, inicio: e.startTime, ultimo: e.startTime }
    ventana.valor += e.value; ventana.ultimo = e.startTime
    m.cls = Math.max(m.cls, ventana.valor)
  })
  po('longtask', (e) => m.largas.push({ inicio: e.startTime, ms: e.duration }))
  po('event', (e) => { if (e.interactionId) m.eventos.push({ inicio: e.startTime, ms: e.duration, nombre: e.name }) }, { durationThreshold: 16 })
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => { m.raf += 1; return raf(cb) }
  addEventListener('load', () => { m.cargado = performance.now() })
}

const mediana = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null }
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10)

async function prepararPagina(ctx) {
  await ctx.route('**/*', (r) => { const o = new URL(r.request().url()).origin; return o === new URL(APP).origin || o === API ? r.continue() : r.fulfill({ status: 204, body: '' }) })
  await ctx.addInitScript(OBSERVADORES)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', RED)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  return page
}
async function leer(page, interaccion) {
  await page.waitForFunction(() => window.__v?.cargado !== null, null, { timeout: 60000 })
  await page.waitForTimeout(5000) // asentamiento tras load: datos de Supabase, imágenes y fuentes
  const base = await page.evaluate(() => {
    const m = window.__v; m.congelado = true
    const tbt = m.largas.filter((t) => m.fcp !== null && t.inicio >= m.fcp && t.inicio <= m.cargado + 5000).reduce((s, t) => s + Math.max(0, t.ms - 50), 0)
    // lcpPrimero: primer candidato LCP (primer pintado grande). En el portal, el carrusel del héroe trae títulos nuevos que
    // vuelven a actualizar el LCP mientras no haya interacción; se informan aparte para no confundir carrusel con carga.
    return { lcp: m.lcp, lcpPrimero: m.candidatos[0]?.t ?? null, candidatos: m.candidatos.slice(0, 8), lcpEl: m.lcpEl, fcp: m.fcp, cls: m.cls, tbt, tareasLargas: m.largas.length, mayorTareaMs: Math.max(0, ...m.largas.map((t) => t.ms)), nodos: document.getElementsByTagName('*').length }
  })
  let interaccionMs = null
  if (interaccion) {
    const campo = page.locator(interaccion.selector).first()
    if (await campo.count()) {
      const t0 = await page.evaluate(() => performance.now())
      await campo.click()
      await page.keyboard.type(interaccion.texto, { delay: 120 })
      await page.waitForTimeout(2500)
      interaccionMs = await page.evaluate((t) => Math.max(0, ...window.__v.eventos.filter((e) => e.inicio >= t).map((e) => e.ms)), t0)
    } else interaccionMs = 'sin-campo'
  }
  return { ...base, interaccionMs }
}

async function main() {
  const navegador = await chromium.launch({ headless: true })
  const salida = { fecha: new Date().toISOString(), app: APP, metodo: 'CPU 4×, red 150 ms / 1,6 Mbps, SW bloqueado; mediana de muestras', muestras: MUESTRAS, escenarios: {}, reducido: {}, errores: [] }
  try {
    // Sesiones guardadas (sin throttling): administración para el POS y clienta para el portal con sesión.
    const sesionDe = async (cuenta) => {
      const c0 = await navegador.newContext({ serviceWorkers: 'block' })
      const p0 = await c0.newPage()
      await p0.goto(`${APP}/login`)
      await p0.fill('#email', cuenta.email); await p0.fill('#password', cuenta.password); await p0.click('button[type=submit]')
      await p0.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 }); await p0.waitForTimeout(2000)
      const e = await c0.storageState(); await c0.close(); return e
    }
    const estados = { admin: await sesionDe(CUENTAS.admin), clienta: await sesionDe(CUENTAS.clienteA) }
    const estadoDe = (e) => (e.sesion === 'clienta' ? estados.clienta : e.sesion ? estados.admin : undefined)

    for (const e of ESCENARIOS) {
      const frio = [], caliente = []
      for (let i = 0; i < MUESTRAS; i += 1) {
        const ctx = await navegador.newContext({ viewport: e.vista, serviceWorkers: 'block', storageState: estadoDe(e) })
        const page = await prepararPagina(ctx)
        const errs = []; page.on('pageerror', (x) => errs.push(String(x.message).slice(0, 160)))
        await page.goto(`${APP}${e.ruta}`, { waitUntil: 'commit', timeout: 120000 })
        frio.push({ ...(await leer(page, e.interaccion)), errores: errs.length })
        await page.reload({ waitUntil: 'commit', timeout: 120000 })
        caliente.push({ ...(await leer(page, e.interaccion)), errores: errs.length })
        await ctx.close()
      }
      const resumen = (xs) => Object.fromEntries(['lcp', 'lcpPrimero', 'fcp', 'cls', 'tbt', 'tareasLargas', 'mayorTareaMs', 'nodos', 'interaccionMs'].map((k) => [k, typeof xs[0][k] === 'string' ? xs[0][k] : r1(mediana(xs.map((x) => x[k])))]))
      salida.escenarios[e.id] = { ruta: e.ruta.replace(/[0-9a-f-]{36}/, ':id'), vista: `${e.vista.width}×${e.vista.height}`, frio: resumen(frio), caliente: resumen(caliente), lcpElemento: frio[0].lcpEl, muestrasFrio: frio, muestrasCaliente: caliente }
      console.log(`${e.id.padEnd(24)} frío LCP ${salida.escenarios[e.id].frio.lcp} ms (primero ${salida.escenarios[e.id].frio.lcpPrimero}) CLS ${salida.escenarios[e.id].frio.cls} int ${salida.escenarios[e.id].frio.interaccionMs} | caliente LCP ${salida.escenarios[e.id].caliente.lcp} ms`)
    }
    for (const e of REDUCIDO) {
      const ctx = await navegador.newContext({ viewport: e.vista, serviceWorkers: 'block', reducedMotion: 'reduce', storageState: estadoDe(e) })
      await ctx.addInitScript(OBSERVADORES)
      const page = await ctx.newPage()
      await page.goto(`${APP}${e.ruta}`)
      await page.waitForTimeout(4000)
      const a = await page.evaluate(() => window.__v.raf)
      await page.waitForTimeout(3000)
      const r = await page.evaluate((a0) => ({ rafPorSeg: (window.__v.raf - a0) / 3, animacionesEnCurso: document.getAnimations().filter((x) => x.playState === 'running').length }), a)
      salida.reducido[e.id] = { ruta: e.ruta, ...r }
      console.log(`${e.id.padEnd(24)} rAF/s ${r.rafPorSeg} animaciones ${r.animacionesEnCurso}`)
      await ctx.close()
    }
  } finally {
    await navegador.close()
    fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1))
  }
}
main().catch((e) => { console.error(e); process.exit(2) })
