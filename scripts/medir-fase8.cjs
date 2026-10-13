// Fase 8 · mediciones de Inicio (recursos, mapa, hero, fuentes) y de la PWA (precaché, segunda visita, sin conexión, frescura de datos).
// Sirve un build estático (VITE_BASE_PATH=/) en 127.0.0.1 con Playwright/Chromium. El backend es el Supabase LOCAL (el build lo incrusta);
// los únicos orígenes externos que se alcanzan son los que la página pide por sí misma (Google Fonts y, en el «antes», Google Maps).
//
// Uso: node scripts/medir-fase8.cjs --dist=<carpeta> --etiqueta=antes|despues --salida=ruta.json [--reps=3] [--puerto=5301] [--solo=inicio|pwa]
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const DIST = path.resolve(arg('dist'))
const ETIQUETA = arg('etiqueta', 'medicion')
const SALIDA = arg('salida')
const REPS = Number(arg('reps', '3'))
const PUERTO = Number(arg('puerto', '5301'))
const SOLO = arg('solo', '')
const APP = `http://127.0.0.1:${PUERTO}`
const { chromium } = require('playwright')

const clasificar = (url) => {
  const u = new URL(url)
  if (u.origin === APP) return 'propio'
  if (u.host === '127.0.0.1:54321') return 'supabase-local'
  if (/(^|\.)maps\.googleapis\.com$|(^|\.)maps\.gstatic\.com$|^www\.google\.com$/.test(u.host)) return 'google-maps'
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(u.host)) return 'google-fonts'
  return 'otros'
}
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

async function esperarQuieto(page, ms = 1500, tope = 15000) {
  const t0 = Date.now()
  let ultimo = Date.now()
  const marca = () => { ultimo = Date.now() }
  page.on('request', marca); page.on('requestfinished', marca); page.on('requestfailed', marca)
  while (Date.now() - ultimo < ms && Date.now() - t0 < tope) await page.waitForTimeout(150)
  page.off('request', marca); page.off('requestfinished', marca); page.off('requestfailed', marca)
}

// Instrumenta una página con CDP: bytes transferidos por petición.
async function observar(context, page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  const reg = new Map()
  cdp.on('Network.requestWillBeSent', (e) => { if (!reg.has(e.requestId)) reg.set(e.requestId, { url: e.request.url, tipo: e.type, bytes: 0, estado: null, desdeSW: false, fallo: null, t: Date.now() }) })
  cdp.on('Network.responseReceived', (e) => { const r = reg.get(e.requestId); if (r) { r.estado = e.response.status; r.desdeSW = !!e.response.fromServiceWorker; r.desdeCache = !!e.response.fromDiskCache } })
  cdp.on('Network.loadingFinished', (e) => { const r = reg.get(e.requestId); if (r) r.bytes = e.encodedDataLength })
  cdp.on('Network.loadingFailed', (e) => { const r = reg.get(e.requestId); if (r) r.fallo = e.errorText })
  return { cdp, reg }
}
const resumir = (reg, desde = 0) => {
  const filas = [...reg.values()].filter((r) => !r.url.startsWith('data:') && !r.url.startsWith('blob:'))
  const porOrigen = {}, porTipo = {}
  let total = 0
  for (const r of filas.slice(desde)) {
    const o = clasificar(r.url)
    porOrigen[o] ??= { peticiones: 0, bytes: 0 }; porOrigen[o].peticiones++; porOrigen[o].bytes += r.bytes
    porTipo[r.tipo] ??= { peticiones: 0, bytes: 0 }; porTipo[r.tipo].peticiones++; porTipo[r.tipo].bytes += r.bytes
    total += r.bytes
  }
  return { peticiones: filas.length - desde, bytes: total, porOrigen, porTipo }
}

async function inicioFrio(browser, nombre, viewport, dpr, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })
  await ctx.addInitScript(() => {
    window.__lcp = null; window.__fcp = null
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = { t: Math.round(e.startTime), url: e.url || '', tag: e.element?.tagName || '', size: e.size } }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch { /* sin soporte */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = Math.round(e.startTime) }).observe({ type: 'paint', buffered: true }) } catch { /* sin soporte */ }
  })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 160)))
  const { reg } = await observar(ctx, page)
  await page.goto(`${APP}/inicio`, { waitUntil: 'load' })
  await page.waitForSelector('h1', { timeout: 20000 })
  await esperarQuieto(page, 2000, 15000)
  const sinScroll = resumir(reg)
  const mapaSinScroll = [...reg.values()].filter((r) => clasificar(r.url) === 'google-maps').length
  const lcp = await page.evaluate(() => ({ lcp: window.__lcp, fcp: window.__fcp }))
  const posicionMapa = await page.evaluate(() => { const f = document.querySelector('iframe[title="Ubicación en el mapa"]'); const m = document.querySelector('[data-mapa-diferido]'); const el = f || m; return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null })
  const hero = [...reg.values()].filter((r) => r.url.includes('/inicio-web/')).map((r) => ({ url: r.url.replace(APP, ''), bytes: r.bytes, estado: r.estado }))
  const fuentes = [...reg.values()].filter((r) => r.tipo === 'Font' || /fonts\.googleapis\.com/.test(r.url)).map((r) => ({ url: r.url.length > 110 ? r.url.slice(0, 110) + '…' : r.url, bytes: r.bytes }))
  const antesScroll = reg.size
  // recorrido hasta el final, en pasos, para despertar lo diferido
  // El contenedor que desplaza no es el documento: se busca el elemento con overflow vertical y mayor altura de contenido.
  const marcarScroll = () => page.evaluate(() => {
    let mejor = null, alto = 0
    for (const el of document.querySelectorAll('*')) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > alto) { mejor = el; alto = el.scrollHeight }
    }
    const e = mejor ?? document.scrollingElement
    e.setAttribute('data-medir-scroll', '1')
    return e.scrollHeight
  })
  const alto = await marcarScroll()
  const paso = viewport.height * 0.6
  for (let y = 0; y < alto + paso; y += paso) {
    await page.evaluate((yy) => document.querySelector('[data-medir-scroll]').scrollTo(0, yy), y)
    await page.waitForTimeout(350)
  }
  await esperarQuieto(page, 2000, 20000)
  const tras = resumir(reg)
  const mapaTras = [...reg.values()].filter((r) => clasificar(r.url) === 'google-maps')
  const res = {
    nombre, viewport, dpr,
    sin_scroll: sinScroll, tras_scroll: tras,
    peticiones_mapa_sin_scroll: mapaSinScroll, peticiones_mapa_tras_scroll: mapaTras.length, bytes_mapa_tras_scroll: mapaTras.reduce((a, r) => a + r.bytes, 0),
    lcp: lcp.lcp, fcp: lcp.fcp, posicion_mapa_px: posicionMapa, hero, fuentes, errores_pagina: errores,
    fallos_red: [...reg.values()].filter((r) => r.fallo).map((r) => `${clasificar(r.url)}:${r.fallo}`).slice(0, 8),
    creadas_tras_scroll: reg.size - antesScroll,
  }
  await ctx.close()
  return res
}

const agregarInicio = (lista) => {
  const nums = (f) => lista.map(f)
  return {
    reps: lista.length,
    bytes_sin_scroll: mediana(nums((x) => x.sin_scroll.bytes)), bytes_tras_scroll: mediana(nums((x) => x.tras_scroll.bytes)),
    peticiones_sin_scroll: mediana(nums((x) => x.sin_scroll.peticiones)), peticiones_tras_scroll: mediana(nums((x) => x.tras_scroll.peticiones)),
    mapa_sin_scroll: mediana(nums((x) => x.peticiones_mapa_sin_scroll)), mapa_tras_scroll: mediana(nums((x) => x.peticiones_mapa_tras_scroll)), bytes_mapa_tras_scroll: mediana(nums((x) => x.bytes_mapa_tras_scroll)),
    lcp_ms: mediana(nums((x) => x.lcp?.t ?? 0)), fcp_ms: mediana(nums((x) => x.fcp ?? 0)),
    por_origen_sin_scroll: lista[0].sin_scroll.porOrigen, por_origen_tras_scroll: lista[lista.length - 1].tras_scroll.porOrigen,
    lcp_elemento: lista[0].lcp, hero: lista[0].hero, fuentes: lista[0].fuentes, errores_pagina: lista.flatMap((x) => x.errores_pagina), fallos_red: lista[0].fallos_red,
  }
}

async function pwa(browser) {
  const salida = {}
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 160)))
  const { reg } = await observar(ctx, page)
  await page.goto(`${APP}/inicio`, { waitUntil: 'load' })
  await page.waitForSelector('h1', { timeout: 20000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller || true)
  await page.waitForTimeout(4000) // instalación y precaché
  const caches = await page.evaluate(async () => {
    const out = []
    for (const nombre of await caches.keys()) {
      const c = await caches.open(nombre)
      const ks = await c.keys()
      let bytes = 0
      const urls = []
      for (const k of ks) { const r = await c.match(k); const b = await r.clone().arrayBuffer(); bytes += b.byteLength; urls.push({ url: new URL(k.url).pathname + new URL(k.url).search.replace(/__WB_REVISION__=\w+/, ''), bytes: b.byteLength }) }
      out.push({ nombre, entradas: ks.length, bytes, urls })
    }
    return out
  })
  const precache = caches.find((c) => /precache/i.test(c.nombre))
  const clasifPrecache = (u) => /ModalEscaner|zxing/i.test(u) ? 'escaner' : /dise.os|\.html$/i.test(u) && !/index\.html$/.test(u) ? 'maquetas-html' : 'otros'
  salida.instalacion = {
    caches: caches.map((c) => ({ nombre: c.nombre, entradas: c.entradas, bytes: c.bytes })),
    precache_entradas: precache?.entradas ?? 0, precache_bytes: precache?.bytes ?? 0,
    precache_modal_escaner: (precache?.urls ?? []).filter((x) => clasifPrecache(x.url) === 'escaner').map((x) => `${x.url} ${x.bytes}`),
    precache_maquetas_html: (precache?.urls ?? []).filter((x) => clasifPrecache(x.url) === 'maquetas-html').map((x) => `${x.url} ${x.bytes}`),
    precache_urls: (precache?.urls ?? []).map((x) => `${x.url} ${x.bytes}`).sort(),
    bytes_red_primera_visita_con_sw: resumir(reg).bytes, peticiones_red_primera_visita_con_sw: resumir(reg).peticiones,
  }
  // segunda visita: la página ya está controlada por el SW
  const reg2antes = reg.size
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('h1', { timeout: 20000 })
  await esperarQuieto(page, 2000, 15000)
  const nuevas = [...reg.values()].slice(reg2antes)
  const propias = nuevas.filter((r) => clasificar(r.url) === 'propio')
  salida.segunda_visita = {
    peticiones_propias: propias.length, desde_service_worker: propias.filter((r) => r.desdeSW).length,
    a_red: propias.filter((r) => !r.desdeSW && !r.desdeCache && r.bytes > 0).length, bytes_red_propios: propias.reduce((a, r) => a + (r.desdeSW ? 0 : r.bytes), 0),
    controlada: await page.evaluate(() => !!navigator.serviceWorker.controller),
  }
  // tercera visita: el caché por uso ya guarda lo pedido con el service worker activo
  const reg3antes = reg.size
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('h1', { timeout: 20000 })
  await esperarQuieto(page, 2000, 15000)
  const propias3 = [...reg.values()].slice(reg3antes).filter((r) => clasificar(r.url) === 'propio')
  salida.tercera_visita = { peticiones_propias: propias3.length, desde_service_worker: propias3.filter((r) => r.desdeSW).length, bytes_red_propios: propias3.reduce((a, r) => a + (r.desdeSW ? 0 : r.bytes), 0) }
  salida.caches_tras_tres_visitas = await page.evaluate(async () => { const o = []; for (const n of await caches.keys()) o.push([n, (await (await caches.open(n)).keys()).length]); return o })
  const nuevas3 = [...reg.values()].slice(reg2antes)
  // frescura: ninguna respuesta de Supabase pasa por el SW ni queda en caché
  const supa = nuevas3.filter((r) => clasificar(r.url) === 'supabase-local')
  const enCaches = caches.flatMap((c) => c.urls).filter((x) => /:54321|\/rest\/v1|\/auth\/v1/.test(x.url))
  salida.frescura_datos = { peticiones_supabase: supa.length, desde_service_worker: supa.filter((r) => r.desdeSW).length, entradas_supabase_en_caches: enCaches.length }
  // sin conexión: shell de una ruta ya visitada, y rutas NO visitadas
  await ctx.setOffline(true)
  const off = {}
  try {
    await page.reload({ waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(3000)
    off.inicio_recargada = await page.evaluate(() => ({ raiz_texto: document.getElementById('root')?.innerText.trim().slice(0, 120) ?? '', tiene_h1: !!document.querySelector('h1'), titulo: document.title }))
  } catch (e) { off.inicio_recargada = { error: String(e).slice(0, 120) } }
  try {
    await page.goto(`${APP}/login`, { waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(3500)
    off.login_no_visitada = await page.evaluate(() => ({ raiz_texto: document.getElementById('root')?.innerText.trim().slice(0, 120) ?? '', tiene_formulario: !!document.querySelector('form') }))
  } catch (e) { off.login_no_visitada = { error: String(e).slice(0, 120) } }
  salida.sin_conexion = off
  await ctx.setOffline(false)
  salida.errores_pagina = errores
  await ctx.close()
  return salida
}

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, 'servir-dist-base.cjs'), DIST, String(PUERTO), '/'], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1200))
  const browser = await chromium.launch()
  const informe = { etiqueta: ETIQUETA, dist: DIST, fecha: new Date().toISOString(), reps: REPS, nota: 'Mediciones de laboratorio en Chromium contra un servidor estático local; los orígenes externos (Google) dependen de Internet; no es Lighthouse ni un dispositivo real.' }
  try {
    if (SOLO !== 'pwa') {
      informe.inicio = {}
      for (const [nombre, vp, dpr, mobile] of [['movil-390', { width: 390, height: 844 }, 2, true], ['movil-412', { width: 412, height: 915 }, 2, true], ['escritorio-1440', { width: 1440, height: 900 }, 1, false]]) {
        const lista = []
        for (let i = 0; i < REPS; i++) lista.push(await inicioFrio(browser, nombre, vp, dpr, mobile))
        informe.inicio[nombre] = { resumen: agregarInicio(lista), muestras: lista }
        console.log(`${nombre}: sin scroll ${informe.inicio[nombre].resumen.bytes_sin_scroll} B / tras scroll ${informe.inicio[nombre].resumen.bytes_tras_scroll} B, mapa ${informe.inicio[nombre].resumen.mapa_sin_scroll}→${informe.inicio[nombre].resumen.mapa_tras_scroll}, LCP ${informe.inicio[nombre].resumen.lcp_ms} ms`)
      }
    }
    if (SOLO !== 'inicio') {
      informe.pwa = await pwa(browser)
      const p = informe.pwa
      console.log(`PWA precaché: ${p.instalacion.precache_entradas} entradas, ${p.instalacion.precache_bytes} B; 2ª visita SW ${p.segunda_visita.desde_service_worker}/${p.segunda_visita.peticiones_propias}; Supabase en caché: ${p.frescura_datos.entradas_supabase_en_caches}; offline: ${JSON.stringify(p.sin_conexion)}`)
    }
  } finally {
    await browser.close()
    srv.kill()
  }
  if (SALIDA) { fs.mkdirSync(path.dirname(path.resolve(SALIDA)), { recursive: true }); fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 1)) }
}
main().catch((e) => { console.error(e); process.exit(1) })
