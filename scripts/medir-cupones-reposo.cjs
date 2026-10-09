// Medición reproducible de la Fase 1 (cupones en reposo) — SOLO Supabase Local.
//
// Uso:  node scripts/medir-cupones-reposo.cjs <etiqueta> <puertoPreview> [salida.json]
//   · Sirve un build (`vite build` + `vite preview`, base /PosJaise/) ya levantado en <puertoPreview>.
//   · Crea una cuenta ADMINISTRADOR ficticia en Supabase Local, mide y la borra en `finally`.
//   · Por pantalla (/promociones, /referidos-web, /fidelizacion-web) × tema (oscuro/claro):
//     3 repeticiones de una ventana de reposo de 2,5 s con CPU 4×, tras estabilizar.
//   · Métricas: TaskDuration (CDP Performance, incluye sobrecosto de instrumentación; NO es % de
//     CPU), tareas largas (PerformanceObserver), ScriptDuration/LayoutDuration/RecalcStyleDuration,
//     tarjetas y chispas montadas, animaciones CSS activas (document.getAnimations()).
//
// Se niega a correr si Supabase no es http://127.0.0.1:54321.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))

const [etiqueta, puerto, salidaArg] = process.argv.slice(2)
if (!etiqueta || !puerto) {
  console.error('Uso: node scripts/medir-cupones-reposo.cjs <etiqueta> <puerto> [salida.json]')
  process.exit(2)
}
const ORIGEN = `http://127.0.0.1:${puerto}`
const BASE = '/PosJaise'
const PANTALLAS = ['/promociones', '/referidos-web', '/fidelizacion-web']
const TEMAS = ['oscuro', 'claro']
const REPETICIONES = 3
const VENTANA_MS = 2500
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const r1 = (n) => Math.round(n * 10) / 10

function probe() {
  window.__qa = { largas: [] }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qa.largas.push({ inicio: e.startTime, duracion: e.duration }) })
      .observe({ type: 'longtask', buffered: true })
  } catch { /* sin soporte */ }
}

async function metricas(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, layout: m.LayoutDuration * 1000, estilo: m.RecalcStyleDuration * 1000, layouts: m.LayoutCount, estilos: m.RecalcStyleCount }
}

async function medir(browser, sesion, ruta, tema) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  await ctx.addInitScript(probe)
  await ctx.addInitScript(({ origen, sesion, tema }) => {
    if (location.origin !== origen) return
    localStorage.setItem('sb-127-auth-token', JSON.stringify(sesion))
    localStorage.setItem('pos-jaise-tema', tema)
  }, { origen: ORIGEN, sesion, tema })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  await page.goto(`${ORIGEN}${BASE}${ruta}`, { waitUntil: 'networkidle' })
  // Estabilizar: esperar a que aparezcan tarjetas y pasar entradas/transiciones iniciales.
  await page.waitForSelector('.cupon-tarjeta', { timeout: 20000 }).catch(() => {})
  await dormir(3500)
  const estado = await page.evaluate(() => ({
    tarjetas: document.querySelectorAll('.cupon-tarjeta').length,
    chispas: document.querySelectorAll('.cupon-chispa').length,
    animaciones: document.getAnimations().filter((a) => a.playState === 'running').length,
  }))
  const muestras = []
  for (let i = 0; i < REPETICIONES; i++) {
    await page.evaluate(() => { window.__qa.largas.length = 0 })
    const a = await metricas(cdp)
    await dormir(VENTANA_MS)
    const b = await metricas(cdp)
    const largas = await page.evaluate(() => window.__qa.largas.map((x) => x.duracion))
    muestras.push({
      task_ms: r1(b.task - a.task), script_ms: r1(b.script - a.script), layout_ms: r1(b.layout - a.layout),
      estilo_ms: r1(b.estilo - a.estilo), layouts: b.layouts - a.layouts, estilos: b.estilos - a.estilos,
      tareas_largas: largas.length, mayor_tarea_ms: r1(Math.max(0, ...largas)),
    })
  }
  await ctx.close()
  return { ruta, tema, ...estado, muestras, mediana_task_ms: r1(mediana(muestras.map((m) => m.task_ms))), errores }
}

async function main() {
  const raw = cp.execFileSync(path.join(ROOT, 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'), ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const local = JSON.parse(raw)
  if (local.API_URL !== 'http://127.0.0.1:54321') throw new Error('Supabase no es el local verificado: no se mide')
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = crypto.randomBytes(24).toString('base64url') + 'aA1!'
  const email = `perf-fase1-${Date.now()}@test.local`
  let uid = null
  const salida = { etiqueta, origen: ORIGEN, fecha: new Date().toISOString(), cpu: '4x', ventana_ms: VENTANA_MS, repeticiones: REPETICIONES, resultados: [], errores: [] }
  const browser = await chromium.launch({ headless: true })
  try {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    uid = data.user.id
    const ins = await admin.from('usuarios').insert({ id: uid, email, activo: true, rol: 'ADMINISTRADOR', nombre_completo: 'TEST QA Fase1' })
    if (ins.error) throw ins.error
    const cli = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await cli.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error
    for (const tema of TEMAS) for (const ruta of PANTALLAS) {
      const r = await medir(browser, login.data.session, ruta, tema)
      salida.resultados.push(r)
      console.log(`${etiqueta} ${tema} ${ruta}: tarjetas=${r.tarjetas} chispas=${r.chispas} anim=${r.animaciones} mediana_task=${r.mediana_task_ms}ms mayor_tarea=${Math.max(...r.muestras.map((m) => m.mayor_tarea_ms))}ms`)
    }
  } catch (e) {
    salida.errores.push(String(e.message))
    console.error(e.message)
  } finally {
    await browser.close()
    if (uid) { const d = await admin.auth.admin.deleteUser(uid); if (d.error) salida.errores.push('limpieza: ' + d.error.message) }
    fs.writeFileSync(path.resolve(salidaArg || `docs/evidencia-rendimiento/fase-1/${etiqueta}.json`), JSON.stringify(salida, null, 2))
  }
}
main()
