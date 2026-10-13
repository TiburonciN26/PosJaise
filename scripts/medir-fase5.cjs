// Medición de la Fase 5 (listas administrativas, Recompensas, Inicio y restauración de sesión) sobre un build servido
// (vite preview) y el Supabase LOCAL (127.0.0.1:54321) con la réplica de pruebas. SOLO LECTURA: no escribe en la base.
//   node scripts/medir-fase5.cjs --app=http://localhost:5191 --cuentas=<json admin/clienteA/clienteB> --etiqueta=antes --salida=<archivo.json> [--repeticiones=3]
//
// Cada escenario abre una página NUEVA (sesión ya guardada por un login previo), así que incluye la restauración de sesión;
// el escenario «sesion-*» la mide aislada y el resto se compara con él. Para cada escenario registra:
//   · peticiones al API (método, ruta, consulta abreviada, estado, bytes decodificados) y duplicados exactos;
//   · nodos del DOM y filas/tarjetas visibles (elementos expandibles, <li> del panel);
//   · tareas largas (> 50 ms) y la mayor, medidas con PerformanceObserver;
//   · canales Realtime abiertos (mensajes phx_join por tema).
// Con tres repeticiones se publica la mediana de cada cifra y se conservan las muestras individuales.
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app')
const ETIQUETA = arg('etiqueta', 'medicion')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const REPS = Number(arg('repeticiones', '3'))
const CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(path.resolve(arg('cuentas')), 'utf8'))
if (!APP || !CUENTAS || !SALIDA) { console.error('uso: --app=<url> --cuentas=<json> --salida=<archivo.json> [--etiqueta=antes|despues] [--repeticiones=3]'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
if (env.VITE_SUPABASE_URL !== API) { console.error(`.env.local no apunta a ${API}: no se ejecuta.`); process.exit(2) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0 }

const ESCENARIOS = [
  // Personal (administrador)
  { id: 'sesion-staff', rol: 'admin', ruta: '/ventas', espera: 'main' },
  { id: 'pedidos-web', rol: 'admin', ruta: '/pedidos-web', espera: 'input[placeholder^="Buscar por clienta"]', navegar: true },
  { id: 'promociones', rol: 'admin', ruta: '/promociones', espera: 'input[placeholder^="Buscar promoci"]', navegar: true },
  { id: 'resenas-web', rol: 'admin', ruta: '/resenas-web', espera: 'input[placeholder^="Buscar por clienta, producto"]', navegar: true },
  { id: 'referidos-web', rol: 'admin', ruta: '/referidos-web', espera: 'input[placeholder="Código o cliente"]', navegar: true },
  { id: 'fidelizacion-web', rol: 'admin', ruta: '/fidelizacion-web', espera: 'input[placeholder="Código o cliente"]', navegar: true },
  { id: 'recompensas-web-monedas', rol: 'admin', ruta: '/recompensas-web?tab=monedas', espera: '[role=tabpanel]', navegar: true },
  { id: 'recompensas-web-sellos', rol: 'admin', ruta: '/recompensas-web?tab=sellos', espera: '[role=tabpanel]', navegar: true },
  { id: 'recompensas-web-proteccion', rol: 'admin', ruta: '/recompensas-web?tab=proteccion', espera: '[role=tabpanel]', navegar: true },
  { id: 'recompensas-web-proteccion-productos', rol: 'admin', ruta: '/recompensas-web?tab=proteccion-productos', espera: '[role=tabpanel]', navegar: true },
  { id: 'recompensas-web-programa', rol: 'admin', ruta: '/recompensas-web?tab=programa', espera: '[role=tabpanel]', navegar: true },
  // Portal de la clienta
  { id: 'sesion-cliente', rol: 'clienteA', ruta: '/terminos-y-condiciones', espera: 'main' },
  { id: 'inicio-cliente', rol: 'clienteA', ruta: '/inicio', espera: 'h1' },
  { id: 'inicio-visitante', rol: null, ruta: '/inicio', espera: 'h1' },
  { id: 'recompensas-como', rol: 'clienteA', ruta: '/recompensas?seccion=como', espera: '[role=tabpanel]' },
  { id: 'recompensas-tarjeta', rol: 'clienteA', ruta: '/recompensas?seccion=tarjeta', espera: '[role=tabpanel]' },
  { id: 'recompensas-sellos', rol: 'clienteA', ruta: '/recompensas?seccion=sellos', espera: '[role=tabpanel]' },
  { id: 'recompensas-cupones', rol: 'clienteA', ruta: '/recompensas?seccion=cupones', espera: '[role=tabpanel]' },
  { id: 'recompensas-canje', rol: 'clienteA', ruta: '/recompensas?seccion=canje', espera: '[role=tabpanel]' },
  { id: 'recompensas-movimientos', rol: 'clienteA', ruta: '/recompensas?seccion=movimientos', espera: '[role=tabpanel]' },
]
const SOLO = arg('solo') ? new Set(arg('solo').split(',')) : null

async function iniciarSesion(navegador, cuenta) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto(`${APP}/login`)
  await page.fill('#email', cuenta.email)
  await page.fill('#password', cuenta.password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
  await page.waitForTimeout(1200)
  const estado = await ctx.storageState()
  await ctx.close()
  return estado
}

async function medir(navegador, estado, esc) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estado ?? undefined })
  await ctx.addInitScript(() => {
    window.__lt = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true }) } catch { /* sin soporte */ }
  })
  // Imágenes y medios: respuesta mínima (no son el objeto de la medición y evitan ruido de transferencia).
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== new URL(APP).origin && route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (u.origin === API && u.pathname.includes('/storage/v1/object/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    return route.continue()
  })
  const page = await ctx.newPage()
  const peticiones = []
  const canales = []
  const errores = []
  let ultima = Date.now()
  let enVuelo = 0
  page.on('request', (r) => { if (new URL(r.url()).origin === API) { enVuelo += 1; ultima = Date.now() } })
  page.on('requestfinished', (r) => { if (new URL(r.url()).origin === API) enVuelo = Math.max(0, enVuelo - 1) })
  page.on('requestfailed', (r) => { if (new URL(r.url()).origin === API) enVuelo = Math.max(0, enVuelo - 1) })
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  page.on('response', async (r) => {
    const u = new URL(r.url())
    ultima = Date.now()
    if (u.origin !== API) return
    let bytes = 0
    try { bytes = (await r.body()).length } catch { /* abortada */ }
    const sel = u.searchParams.get('select')
    peticiones.push({ m: r.request().method(), ruta: u.pathname.replace(/^\/(rest|auth)\/v1\//, ''), q: u.search.replace(/^\?/, '').slice(0, 260), sel: sel ? sel.slice(0, 160) : null, estado: r.status(), bytes })
  })
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const t = typeof f.payload === 'string' ? f.payload : ''
      if (t.includes('phx_join')) { try { canales.push(JSON.parse(t)[3] ?? t.slice(0, 80)) } catch { canales.push(t.slice(0, 80)) } }
    })
  })

  const inicio = esc.navegar ? '/ventas' : esc.ruta
  await page.goto(`${APP}${inicio}`)
  await page.waitForSelector('main', { timeout: 30000 })
  if (esc.navegar) {
    await quieto(page, () => ultima, () => enVuelo, 900)
    peticiones.length = 0
    canales.length = 0
    await page.evaluate(() => { performance.mark('inicio-escenario') })
    await page.evaluate((ruta) => { history.pushState({}, '', ruta); window.dispatchEvent(new PopStateEvent('popstate')) }, esc.ruta)
  }
  const t0 = Date.now()
  try { await page.waitForSelector(esc.espera, { timeout: 30000 }) } catch { errores.push(`no apareció ${esc.espera}`) }
  await quieto(page, () => ultima, () => enVuelo, 1000)
  const msListo = Date.now() - t0

  const dom = await page.evaluate((marca) => {
    const m = performance.getEntriesByName('inicio-escenario')[0]
    const desde = m ? m.startTime : 0
    const lts = (window.__lt || []).filter((x) => x.t >= desde)
    return {
      nodos: document.querySelectorAll('*').length,
      expandibles: document.querySelectorAll('main [aria-expanded]').length,
      cupones: document.querySelectorAll('.cupon-envoltura').length,
      itemsPanel: document.querySelectorAll('[role=tabpanel] li').length,
      selectOpciones: document.querySelectorAll('select option').length,
      tareasLargas: lts.length,
      tareaMaxMs: Math.round(Math.max(0, ...lts.map((x) => x.d))),
      tareasLargasTotalMs: Math.round(lts.reduce((a, x) => a + x.d, 0)),
    }
  }, null)
  await ctx.close()

  const claves = {}
  for (const p of peticiones) { const k = `${p.m} ${p.ruta}?${p.q}`; claves[k] = (claves[k] ?? 0) + 1 }
  const duplicadas = Object.values(claves).filter((n) => n > 1).reduce((a, n) => a + (n - 1), 0)
  const porRuta = {}
  for (const p of peticiones) { const k = `${p.m} ${p.ruta}`; porRuta[k] = (porRuta[k] ?? 0) + 1 }
  const temas = {}
  for (const c of canales) temas[c] = (temas[c] ?? 0) + 1
  return {
    peticiones: peticiones.length,
    bytes: peticiones.reduce((a, p) => a + p.bytes, 0),
    mayorRespuestaBytes: Math.max(0, ...peticiones.map((p) => p.bytes)),
    duplicadas,
    errores: peticiones.filter((p) => p.estado >= 400).length,
    erroresPagina: errores,
    msListo,
    ...dom,
    canalesRealtime: canales.length,
    canalesPorTema: temas,
    porRuta,
    detalle: peticiones.map((p) => ({ m: p.m, ruta: p.ruta, sel: p.sel, q: p.q.replace(/select=[^&]*&?/, ''), estado: p.estado, bytes: p.bytes })),
  }
}

async function quieto(page, ultimaPeticion, enVuelo, ms) {
  const tope = Date.now() + 30000
  while (Date.now() < tope) {
    if (enVuelo() === 0 && Date.now() - ultimaPeticion() >= ms) return
    await page.waitForTimeout(150)
  }
}

;(async () => {
  const navegador = await chromium.launch()
  const estados = {}
  for (const rol of ['admin', 'clienteA']) estados[rol] = await iniciarSesion(navegador, CUENTAS[rol])
  const resultados = {}
  for (const esc of ESCENARIOS) {
    if (SOLO && !SOLO.has(esc.id)) continue
    const muestras = []
    for (let i = 0; i < REPS; i += 1) {
      const m = await medir(navegador, esc.rol ? estados[esc.rol] : null, esc)
      muestras.push(m)
    }
    const num = ['peticiones', 'bytes', 'mayorRespuestaBytes', 'duplicadas', 'errores', 'msListo', 'nodos', 'expandibles', 'cupones', 'itemsPanel', 'selectOpciones', 'tareasLargas', 'tareaMaxMs', 'tareasLargasTotalMs', 'canalesRealtime']
    const med = Object.fromEntries(num.map((k) => [k, mediana(muestras.map((m) => m[k]))]))
    resultados[esc.id] = { mediana: med, muestras: muestras.map((m) => ({ ...m, detalle: undefined })), detalle: muestras[0].detalle, porRuta: muestras[0].porRuta, canalesPorTema: muestras[0].canalesPorTema }
    console.log(`${esc.id.padEnd(38)} req=${med.peticiones} bytes=${med.bytes} dup=${med.duplicadas} nodos=${med.nodos} exp=${med.expandibles} cup=${med.cupones} li=${med.itemsPanel} opc=${med.selectOpciones} tareaMax=${med.tareaMaxMs}ms ws=${med.canalesRealtime}${muestras.some((m) => m.erroresPagina.length) ? ' ERR:' + muestras.flatMap((m) => m.erroresPagina).join('|') : ''}`)
  }
  await navegador.close()
  fs.writeFileSync(SALIDA, JSON.stringify({ etiqueta: ETIQUETA, app: APP, fecha: new Date().toISOString(), repeticiones: REPS, resultados }, null, 1))
  console.log('guardado', SALIDA)
})().catch((e) => { console.error(e); process.exit(1) })
