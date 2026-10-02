// Mediciones del Grupo 7 (solo Local, cuenta CLIENTE ficticia, dev server).
// uso: node medir-g7.mjs <etiqueta> [catalogos|imagenes|todo]
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const require = createRequire('C:/WedJaiseReact/package.json')
const { chromium } = require('playwright')
const { password } = await import(pathToFileURL('C:/WedJaiseReact/tests/e2e/fixtures/accounts.mjs').href)
const data = JSON.parse(readFileSync('C:/WedJaiseReact/tests/e2e/fixtures/runtime.json', 'utf8'))
const etiqueta = process.argv[2] ?? 'antes'
const que = process.argv[3] ?? 'todo'
const filtro = process.argv[4] ?? ''
const N = 5
const SP = 'C:/WedJaiseReact/tests/e2e/results/performance-grupo7'

const txt = await (await fetch('http://localhost:5173/src/lib/supabase.js')).text()
if (!txt.includes('127.0.0.1:54321')) { console.error('ABORTO: no es Local'); process.exit(1) }

const INIT = () => {
  const sel = 'main a.aspect-square[href^="/productos/"], main a.aspect-square[href^="/servicios/"]'
  const op = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return 0; o *= Number(c.opacity) } return o }
  window.__startPoll = (origen, ruta) => {
    const m = { dom: null, vis: null, settled: null }
    window.__m = m
    const tick = () => {
      const t = performance.now() - origen
      const els = ruta && !location.pathname.endsWith(ruta) ? [] : [...document.querySelectorAll(sel)]
      if (els.length && m.dom === null) m.dom = t
      const hayVisible = els.some((e) => op(e) >= 0.05 && e.getBoundingClientRect().width > 0)
      m.racha = hayVisible ? (m.racha ?? 0) + 1 : 0
      if (m.vis === null && hayVisible && m.visPrimero == null) m.visPrimero = t
      if (m.racha === 0) m.visPrimero = null
      if (m.vis === null && m.racha >= 4) m.vis = m.visPrimero
      const visibles = els.filter((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.width > 0 })
      if (visibles.length && m.settled === null && visibles.every((e) => op(e) >= 0.99)) m.settled = t
      if (m.settled === null && t < 8000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  window.__startPoll(0)
}

const browser = await chromium.launch()
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const resumen = (a) => ({ mediana: Math.round(med(a)), min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)), muestras: a.map((x) => Math.round(x)) })

async function contexto(viewport, bloquearContacto = 0) {
  const ctx = await browser.newContext({ viewport, baseURL: 'http://localhost:5173', serviceWorkers: 'block', timezoneId: 'America/Lima' })
  await ctx.route(/^https?:\/\/(?!localhost:5173|127\.0\.0\.1:54321)/, (r) => r.abort())
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Correo', { exact: true }).fill(data.clientEmail)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor()
  await page.waitForLoadState('networkidle')
  if (bloquearContacto) {
    await ctx.route('**/rest/v1/rpc/datos_contacto*', async (route) => { await new Promise((r) => setTimeout(r, bloquearContacto)); await route.continue() })
  }
  return { ctx, page }
}

const salida = { etiqueta, fecha: new Date().toISOString(), N, entorno: 'dev server local, Supabase Local, orígenes externos bloqueados, serviceWorkers bloqueados' }

if (que === 'todo' || que === 'catalogos') {
  salida.catalogos = {}
  const escenarios = [
    { nombre: 'directa 1440x900', vp: { width: 1440, height: 900 }, bloqueo: 0, modo: 'directa' },
    { nombre: 'directa 390x844', vp: { width: 390, height: 844 }, bloqueo: 0, modo: 'directa' },
    { nombre: 'navegando desde Inicio 1440x900', vp: { width: 1440, height: 900 }, bloqueo: 0, modo: 'nav' },
    { nombre: 'directa 1440x900 con datos_contacto retenido 1000 ms', vp: { width: 1440, height: 900 }, bloqueo: 1000, modo: 'directa' },
  ]
  for (const esc of escenarios) {
    if (filtro && !esc.nombre.includes(filtro)) continue
    for (const ruta of ['/productos', '/servicios']) {
      const { ctx, page } = await contexto(esc.vp, esc.bloqueo)
      await page.addInitScript(INIT)
      const dom = [], vis = [], settled = []
      for (let i = 0; i < N; i++) {
        if (esc.modo === 'directa') {
          await page.goto(ruta)
        } else {
          await page.goto('/inicio'); await page.waitForLoadState('networkidle')
          await page.evaluate((r) => window.__startPoll(performance.now(), r), ruta)
          await page.locator(`a[href="${ruta}"]:not([tabindex="-1"])`).filter({ visible: true }).first().click()
        }
        await page.waitForFunction(() => window.__m?.settled !== null || performance.now() > 9000, null, { timeout: 15000 }).catch(() => {})
        const m = await page.evaluate(() => window.__m)
        if (m.dom != null) dom.push(m.dom); if (m.vis != null) vis.push(m.vis); if (m.settled != null) settled.push(m.settled)
      }
      salida.catalogos[`${ruta} · ${esc.nombre}`] = { primeraTarjetaEnDOM: dom.length ? resumen(dom) : null, primeraTarjetaVisible: vis.length ? resumen(vis) : null, tarjetasEnPantallaAsentadas: settled.length ? resumen(settled) : null }
      console.log(`${ruta} · ${esc.nombre}`, JSON.stringify({ dom: dom.length ? resumen(dom).mediana : null, vis: vis.length ? resumen(vis).mediana : null, asentadas: settled.length ? resumen(settled).mediana : null }))
      await ctx.close()
    }
  }
}

if (que === 'todo' || que === 'imagenes') {
  salida.imagenes = {}
  for (const [nombre, vp] of [['1440x900', { width: 1440, height: 900 }], ['390x844', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, baseURL: 'http://localhost:5173', serviceWorkers: 'block', timezoneId: 'America/Lima' })
    await ctx.route(/^https?:\/\/(?!localhost:5173|127\.0\.0\.1:54321)/, (r) => r.abort())
    const page = await ctx.newPage()
    await page.goto('/login'); await page.getByLabel('Correo', { exact: true }).fill(data.clientEmail); await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor(); await page.waitForLoadState('networkidle')
    const vistas = new Map(); let fase = 'antes_scroll'
    page.on('response', async (r) => { const ct = r.headers()['content-type'] ?? ''; if (!ct.startsWith('image/')) return; const u = new URL(r.url()); if (vistas.has(r.url())) return; let bytes = 0; try { bytes = (await r.body()).length } catch {} vistas.set(r.url(), { path: u.pathname, bytes, fase }) })
    await page.goto('/inicio'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
    const galeriaAntes = [...vistas.values()].filter((v) => /galeria/i.test(v.path))
    const todasAntes = [...vistas.values()]
    fase = 'tras_scroll'
    await page.evaluate(async () => { const sc = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 50 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).sort((x, y) => y.scrollHeight - x.scrollHeight)[0]; for (let y = 0; y <= sc.scrollHeight; y += 300) { sc.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) } }); await page.waitForTimeout(1500); await page.waitForLoadState('networkidle')
    const galeriaTotal = [...vistas.values()].filter((v) => /galeria/i.test(v.path))
    const imgsGaleria = await page.evaluate(() => [...document.querySelectorAll('main img')].filter((i) => /— (antes|después)$/.test(i.alt)).map((i) => ({ loading: i.getAttribute('loading'), decoding: i.getAttribute('decoding'), cargada: i.complete && i.naturalWidth > 0 })))
    salida.imagenes[nombre] = {
      imagenesGaleriaEnElDOM: imgsGaleria.length,
      atributosLoading: [...new Set(imgsGaleria.map((i) => i.loading))],
      imagenesGaleriaCargadasTrasScroll: imgsGaleria.filter((i) => i.cargada).length,
      galeriaDescargadaSinScroll: { cantidad: galeriaAntes.length, bytes: galeriaAntes.reduce((s, x) => s + x.bytes, 0) },
      galeriaDescargadaTrasScroll: { cantidad: galeriaTotal.length, bytes: galeriaTotal.reduce((s, x) => s + x.bytes, 0) },
      todasLasImagenesSinScroll: { cantidad: todasAntes.length, bytes: todasAntes.reduce((s, x) => s + x.bytes, 0) },
    }
    console.log(nombre, JSON.stringify(salida.imagenes[nombre]))
    await ctx.close()
  }
}

await browser.close()
writeFileSync(`${SP}/g7-${etiqueta}-${que}${filtro ? '-' + filtro.replace(/\W+/g, '_') : ''}.json`, JSON.stringify(salida, null, 2))
console.log('guardado', `${SP}/g7-${etiqueta}-${que}.json`)
