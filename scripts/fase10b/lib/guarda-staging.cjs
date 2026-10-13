// Fase 10B · guardas de las herramientas que inician sesión en STAGING (modo staging propio; la guarda de Local de 10A no cambia).
// Apps admitidas: un despliegue https de pos-jaise.pages.dev (el Preview) o un build servido en loopback http (p. ej. `main`
// compilado contra staging para probar la convivencia). Backend admitido: SOLO el Supabase de staging.
// Antes de cualquier credencial: app aprobada, build-id esperado (Preview) y backend EFECTIVO del bundle = staging exacto.
// En el navegador, cada contexto sale por un proxy de guarda que decide cada salto (redirecciones incluidas) ANTES de conectar:
// túneles solo al Preview y al Supabase de staging; peticiones http solo a la app loopback aprobada. Service workers bloqueados,
// la app solo GET/HEAD, GET de terceros respondidos vacíos dentro del navegador; lo demás se aborta y es una violación.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const G = require('../../fase10a/lib/guardas-local-10a.cjs')

const RAIZ = path.resolve(__dirname, '..', '..', '..')
const SUPABASE_STAGING = 'https://tqkdtojnhgykmcbvwdmz.supabase.co'

function validarApp(app) {
  const u = new URL(app)
  if (u.username || u.password || u.search || u.hash) throw new Error('la app no admite credenciales, query ni fragmento')
  if (u.protocol === 'https:' && /^([a-z0-9-]+\.)?pos-jaise\.pages\.dev$/.test(u.hostname) && !u.port && u.pathname === '/') return { origen: u.origin, base: '', tipo: 'preview' }
  if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port && u.port !== '54321' && /^(\/[\w-]+)?\/?$/.test(u.pathname)) return { origen: u.origin, base: u.pathname.replace(/\/$/, ''), tipo: 'loopback' }
  throw new Error('la app debe ser un despliegue https de pos-jaise.pages.dev o un build en http://127.0.0.1:<puerto>[/base]')
}

function cuentasStaging() {
  const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env.staging.local'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  if (env.VITE_SUPABASE_URL !== SUPABASE_STAGING) throw new Error('.env.staging.local no apunta al Supabase de staging aprobado')
  const c = { admin: [env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD], cajera: [env.QA_CAJERA_EMAIL, env.QA_CAJERA_PASSWORD], clienta: [env.QA_CLIENTE_EMAIL, env.QA_CLIENTE_PASSWORD] }
  for (const [k, [e, p]] of Object.entries(c)) if (!/@staging\.test$/.test(e ?? '') || !p) throw new Error(`la cuenta ${k} no es QA de staging`)
  return Object.fromEntries(Object.entries(c).map(([k, [email, password]]) => [k, { email, password }]))
}

/** Preflight: build-id (si se pide) y backend efectivo del bundle = staging exacto. Sin credenciales ni Supabase. */
async function preflight(app, buildId) {
  const { origen, base } = validarApp(app)
  const raizApp = `${origen}${base}`
  const pedir = async (u, { opcional } = {}) => {
    if (new URL(u).origin !== origen) throw new Error(`petición fuera de la app aprobada: ${new URL(u).origin}`)
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (r.status !== 200) { if (opcional) return null; throw new Error(`la app respondió ${r.status} a ${new URL(u).pathname}`) }
    return r.text()
  }
  const html = await pedir(`${raizApp}/`)
  const marca = (html.match(/<meta name="build-id" content="([^"]+)"/) ?? [])[1] ?? null
  if (buildId && marca !== buildId) throw new Error(`build-id servido ${marca} ≠ esperado ${buildId}: no se autentica nada`)
  const { modulos } = await G.modulosDelBundle(raizApp, pedir)
  const b = G.backendDeModulos(modulos)
  const urls = [...new Set(b.configs.map((x) => x.url))]
  // El bundle de `main` no tiene la forma de configuración de la rama nueva: se exige entonces que la ÚNICA URL de Supabase
  // presente sea la de staging y que no aparezca Local.
  const textos = modulos.map((m) => m.texto).join('\n')
  if (urls.length) { if (urls.length !== 1 || urls[0] !== SUPABASE_STAGING) throw new Error('el backend efectivo del bundle no es exactamente el Supabase de staging') }
  else if (!textos.includes(SUPABASE_STAGING)) throw new Error('el bundle no contiene el Supabase de staging')
  if (b.remotos.some((r) => r !== SUPABASE_STAGING) || /127\.0\.0\.1:54321/.test(textos)) throw new Error('el bundle referencia otro Supabase o el Local')
  return { app: raizApp, buildId: marca, modulos: modulos.length, backend: 'staging (tqkd…)' }
}

function crearGuarda() { return { violaciones: [], neutralizadas: 0, preconexionesRechazadas: 0 } }

function proxyStaging(origenApp, guarda) {
  const app = new URL(origenApp)
  const tuneles = [new URL(SUPABASE_STAGING).hostname, ...(app.protocol === 'https:' ? [app.hostname] : [])]
  const sockets = new Set()
  const srv = http.createServer((req, res) => {
    let u = null
    try { u = new URL(req.url) } catch {}
    if (!u || u.origin !== app.origin || !['GET', 'HEAD'].includes(req.method)) {
      req.resume(); guarda.violaciones.push(`salto ${req.method} ${u ? `${u.origin}${u.pathname}` : 'url inválida'}`); res.writeHead(403); return res.end()
    }
    const q = http.request({ host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    q.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(q)
  })
  srv.on('connect', (req, cliente, cabeza) => {
    const [host, puerto] = String(req.url).split(':')
    if (!tuneles.includes(host) || puerto !== '443') {
      // Las preconexiones de index.html (Google Fonts) abren un túnel SIN petición: se rechazan sin conectar y se cuentan aparte.
      if (/supabase\.(co|in)$|culqi|^127\.|^localhost$/.test(host)) guarda.violaciones.push(`tunel CONNECT ${req.url}`)
      else guarda.preconexionesRechazadas += 1
      cliente.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return
    }
    const destino = net.connect(443, host, () => { cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (cabeza?.length) destino.write(cabeza); destino.pipe(cliente); cliente.pipe(destino) })
    for (const s of [destino, cliente]) { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => { destino.destroy(); cliente.destroy() }) }
  })
  srv.on('upgrade', (req, s) => { guarda.violaciones.push('upgrade'); s.destroy() })
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { srv.unref(); ok({ url: `http://127.0.0.1:${srv.address().port}`, cerrar: () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()) }) }) }))
}

async function contexto(navegador, app, guarda, opciones = {}) {
  const { origen } = validarApp(app)
  const proxy = await proxyStaging(origen, guarda)
  const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 }, ...opciones, serviceWorkers: 'block', proxy: { server: proxy.url } })
  ctx.on('close', () => { proxy.cerrar() })
  await ctx.routeWebSocket(/.*/, (ws) => {
    const u = new URL(ws.url())
    if (u.origin === SUPABASE_STAGING.replace('https:', 'wss:') && u.pathname.startsWith('/realtime/v1/')) return ws.connectToServer()
    guarda.violaciones.push(`websocket ${u.origin}${u.pathname}`); return ws.close()
  })
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method()
    if (['data:', 'blob:'].includes(u.protocol) || u.origin === SUPABASE_STAGING) return route.continue()
    if (u.origin === origen) return m === 'GET' || m === 'HEAD' ? route.continue() : (guarda.violaciones.push(`peticion ${m} ${u.pathname}`), route.abort())
    const sensible = /supabase\.(co|in)$|culqi|127\.0\.0\.1|localhost/.test(u.hostname)
    if ((m === 'GET' || m === 'HEAD') && !sensible) { guarda.neutralizadas += 1; return route.fulfill({ status: 204, body: '' }) }
    guarda.violaciones.push(`peticion ${m} ${u.origin}${u.pathname}`); return route.abort('blockedbyclient')
  })
  return ctx
}

function exigirSinViolaciones(guarda, momento) {
  if (guarda.violaciones.length) throw new Error(`guarda de red (${momento}): ${[...new Set(guarda.violaciones)].slice(0, 5).join(' | ')}`)
}

async function iniciarSesion(page, app, cuenta, guarda) {
  const { origen, base } = validarApp(app)
  await page.goto(`${origen}${base}/login`)
  const u = new URL(page.url())
  if (u.origin !== origen || !u.pathname.endsWith('/login')) throw new Error('la página de login no es la de la app aprobada')
  exigirSinViolaciones(guarda, 'antes de escribir credenciales')
  await page.fill('#email', cuenta.email); await page.fill('#password', cuenta.password); await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
  exigirSinViolaciones(guarda, 'tras iniciar sesión')
}

module.exports = { SUPABASE_STAGING, validarApp, cuentasStaging, preflight, crearGuarda, contexto, exigirSinViolaciones, iniciarSesion }
