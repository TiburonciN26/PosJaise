// Fase 10A · vitales de LABORATORIO (LCP, CLS, FCP, TBT aproximado e interacción) en los escenarios principales, frío y caliente,
// más un escenario de movimiento reducido. Build servido + Supabase LOCAL (127.0.0.1:54321). SOLO LECTURA.
//   node scripts/fase10a/medir-vitales-10a.cjs --app=http://127.0.0.1:5401 --cuentas=<json con admin y clienteA> --salida=<archivo.json> [--muestras=3]
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
// V2 (revisión F10A-01/04 de Codex):
//   · Antes de abrir el navegador: preflight de scripts/fase10a/lib/guardas-local-10a.cjs (app loopback, cuentas QA de Local y
//     backend EFECTIVO del bundle = Supabase Local). Todos los contextos, también el de login, llevan las guardas de red; una
//     violación hace fallar la medición.
//   · Los resúmenes guardan la mediana EXACTA (sin redondeo): el redondeo es solo de presentación. La mediana de un número par de
//     muestras es la media de las dos centrales.
//   · La salida declara los escenarios esperados y `completo`; si algo falla se guarda lo medido con `completo: false` y el proceso
//     termina con código distinto de 0.
// Sin tokens ni datos personales en la salida.
const fs = require('node:fs')
const cp = require('node:child_process')
const { chromium } = require('playwright')
const G = require('./lib/guardas-local-10a.cjs')
const { mediana, validarMuestras } = require('./lib/estadistica.cjs')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const SALIDA = arg('salida')
if (!arg('app') || !arg('cuentas') || !SALIDA) { console.error('uso: --app=<url> --cuentas=<json> --salida=<archivo> [--muestras=3]'); process.exit(2) }

const RED = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }
const MOVIL = { width: 390, height: 844 }, ESCRITORIO = { width: 1366, height: 900 }
const escenarios = (idProducto) => [
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

const r1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x) // SOLO para la consola
const METRICAS = ['lcp', 'lcpPrimero', 'fcp', 'cls', 'tbt', 'tareasLargas', 'mayorTareaMs', 'nodos', 'interaccionMs']
// Mediana exacta por métrica. Una métrica de texto ('sin-campo') se conserva como texto para que el evaluador la rechace.
const resumen = (xs) => Object.fromEntries(METRICAS.map((k) => [k, xs.some((x) => typeof x[k] === 'string') ? xs.find((x) => typeof x[k] === 'string')[k] : mediana(xs.map((x) => x[k]))]))

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

async function main(salida) {
  const cuentas = JSON.parse(fs.readFileSync(arg('cuentas'), 'utf8'))
  const muestras = validarMuestras(arg('muestras', '3'))
  // Preflight ANTES de abrir el navegador: si algo no es Local exacto, no se envía ninguna credencial.
  const pre = await G.preflightLocal({ app: arg('app'), cuentas, claves: ['admin', 'clienteA'] })
  const APP = pre.app
  Object.assign(salida, { app: APP, muestras, preflight: pre })
  const idProducto = cp.execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: 'begin read only; select id from productos where activo order by nombre limit 1; rollback;', encoding: 'utf8' }).split('\n').find((l) => /^[0-9a-f-]{36}$/.test(l))
  if (!idProducto) throw new Error('no hay un producto activo en Local para la ficha de detalle')
  const ESCENARIOS = escenarios(idProducto)
  salida.escenariosEsperados = ESCENARIOS.map((e) => e.id)
  salida.reducidoEsperados = REDUCIDO.map((e) => e.id)

  const guarda = G.crearGuarda(APP)
  salida.guarda = guarda
  const navegador = await chromium.launch({ headless: true })
  const nuevaPagina = async (opciones, conThrottling) => {
    const ctx = await G.contextoSeguro(navegador, opciones, guarda)
    await ctx.addInitScript(OBSERVADORES)
    const page = await ctx.newPage()
    if (conThrottling) {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', RED)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    }
    return { ctx, page }
  }
  try {
    // Sesiones guardadas (sin throttling): administración para el POS y clienta para el portal con sesión.
    const sesionDe = async (cuenta) => {
      const ctx = await G.contextoSeguro(navegador, {}, guarda)
      const page = await ctx.newPage()
      await G.iniciarSesion(page, APP, cuenta, guarda)
      await page.waitForTimeout(2000)
      const e = await ctx.storageState(); await ctx.close(); return e
    }
    const estados = { admin: await sesionDe(cuentas.admin), clienta: await sesionDe(cuentas.clienteA) }
    const estadoDe = (e) => (e.sesion === 'clienta' ? estados.clienta : e.sesion ? estados.admin : undefined)

    for (const e of ESCENARIOS) {
      const frio = [], caliente = []
      for (let i = 0; i < muestras; i += 1) {
        const { ctx, page } = await nuevaPagina({ viewport: e.vista, storageState: estadoDe(e) }, true)
        const errs = []; page.on('pageerror', (x) => errs.push(String(x.message).slice(0, 160)))
        await page.goto(`${APP}${e.ruta}`, { waitUntil: 'commit', timeout: 120000 })
        frio.push({ ...(await leer(page, e.interaccion)), errores: errs.length })
        await page.reload({ waitUntil: 'commit', timeout: 120000 })
        caliente.push({ ...(await leer(page, e.interaccion)), errores: errs.length })
        await ctx.close()
        G.exigirSinViolaciones(guarda, e.id)
      }
      const s = { ruta: e.ruta.replace(/[0-9a-f-]{36}/, ':id'), vista: `${e.vista.width}×${e.vista.height}`, frio: resumen(frio), caliente: resumen(caliente), lcpElemento: frio[0].lcpEl, muestrasFrio: frio, muestrasCaliente: caliente }
      salida.escenarios[e.id] = s
      console.log(`${e.id.padEnd(24)} frío LCP ${r1(s.frio.lcp)} ms (primero ${r1(s.frio.lcpPrimero)}) CLS ${s.frio.cls?.toFixed?.(4) ?? s.frio.cls} int ${r1(s.frio.interaccionMs)} | caliente LCP ${r1(s.caliente.lcp)} ms`)
    }
    for (const e of REDUCIDO) {
      const { ctx, page } = await nuevaPagina({ viewport: e.vista, reducedMotion: 'reduce', storageState: estadoDe(e) }, false)
      await page.goto(`${APP}${e.ruta}`)
      await page.waitForTimeout(4000)
      const a = await page.evaluate(() => window.__v.raf)
      await page.waitForTimeout(3000)
      const r = await page.evaluate((a0) => ({ rafPorSeg: (window.__v.raf - a0) / 3, animacionesEnCurso: document.getAnimations().filter((x) => x.playState === 'running').length }), a)
      salida.reducido[e.id] = { ruta: e.ruta, ...r }
      console.log(`${e.id.padEnd(24)} rAF/s ${r.rafPorSeg} animaciones ${r.animacionesEnCurso}`)
      await ctx.close()
      G.exigirSinViolaciones(guarda, e.id)
    }
    salida.completo = true
  } finally {
    await navegador.close()
  }
}

const salida = { fecha: new Date().toISOString(), metodo: 'CPU 4×, red 150 ms / 1,6 Mbps, SW bloqueado; mediana exacta de muestras', completo: false, escenarios: {}, reducido: {}, errores: [] }
main(salida)
  .catch((e) => { salida.errores.push(String(e.message ?? e).split('\n')[0].slice(0, 300)); console.error(e.message ?? e); process.exitCode = 2 })
  .finally(() => { fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1)) })
