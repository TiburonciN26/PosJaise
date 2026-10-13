// Fase 10B · matriz de roles × rutas en el PREVIEW de staging (modo staging propio; no relaja la guarda de Local de 10A).
//   node scripts/fase10b/verificar-roles-staging.cjs --app=https://<id>.pos-jaise.pages.dev --build-id=<8 hex> [--salida=<archivo.json>]
// Misma matriz aprobada que scripts/fase10a/verificar-roles-rutas.cjs (se comprueba contra src/config/navegacion.js): visitante,
// clienta, cajera y administración abren por URL DIRECTA las 27 rutas del POS, las del portal y una ficha de producto y de
// servicio, y deben aterrizar en su destino esperado sin errores; menú del POS sin rutas ajenas; cerrar sesión vuelve al login.
// La ASISTENTE no tiene cuenta en staging (crearla exige la clave de servicio): queda cubierta por la matriz de Local (19/19).
//
// Salvaguardas ANTES de cualquier credencial:
//   · --app es exactamente un despliegue de pos-jaise.pages.dev (https, sin ruta, query ni credenciales) y su <meta build-id>
//     es el esperado;
//   · el backend EFECTIVO del bundle (recorriendo todos los módulos) es exactamente el Supabase de staging, sin otro Supabase;
//   · las cuentas son las QA de .env.staging.local (@staging.test).
// En el navegador: un proxy de guarda propio que SOLO abre túneles hacia el Preview y el Supabase de staging (cada salto,
// incluidas redirecciones, pasa por él antes de conectar); service workers bloqueados; peticiones a la app solo GET/HEAD; GET de
// terceros (fuentes) respondidos vacíos dentro del navegador; lo demás se aborta y es una violación que hace fallar la corrida.
// Solo lecturas en el negocio de staging (navegar no escribe).
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright')
const G = require('../fase10a/lib/guardas-local-10a.cjs')

const RAIZ = path.resolve(__dirname, '..', '..')
const SUPABASE_STAGING = 'https://tqkdtojnhgykmcbvwdmz.supabase.co'
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const SALIDA = arg('salida')

// ---------------- matriz esperada (idéntica a la de 10A) ----------------
const A = 'ADMINISTRADOR', C = 'CAJERA', S = 'ASISTENTE'
const POS = {
  '/ventas': [A, C], '/inventario': [A, C], '/historial': [A, C], '/servicios': [A, C], '/dashboard': [A], '/mi-panel': [A, S],
  '/citas': [A, C, S], '/estadisticas': [A], '/auditoria': [A], '/clientes': [A], '/deudas': [A], '/porcentajes': [A], '/gastos': [A, C],
  '/asistentes': [A], '/mobiliario': [A], '/web': [A], '/promociones': [A], '/pedidos-web': [A], '/resenas-web': [A], '/contacto-web': [A],
  '/puntos-web': [A], '/referidos-web': [A], '/fidelizacion-web': [A], '/recompensas-web': [A], '/catalogo-web': [A],
  '/libro-reclamaciones-web': [A], '/galeria-web': [A],
}
const INICIAL = { [A]: '/ventas', [C]: '/ventas', [S]: '/mi-panel' }
const PUBLICAS = ['/inicio', '/servicios', '/productos', '/recompensas', '/nosotros', '/libro-de-reclamaciones', '/terminos-y-condiciones', '/politica-de-cambios-y-devoluciones', '/politica-de-privacidad']
const PRIVADAS = ['/mi-perfil', '/citas', '/citas/carrito', '/historial', '/carrito', '/mis-resenas', '/mi-perfil/direcciones', '/mi-perfil/pedidos', '/mi-perfil/notificaciones', '/mi-perfil/seguridad', '/mi-perfil/referidos']
function esperado(perfil, ruta) {
  const base = ruta.replace(/\/[0-9a-f-]{36}$/, '/:id')
  const publica = PUBLICAS.includes(ruta) || base === '/productos/:id' || base === '/servicios/:id'
  if (perfil === 'visitante') return publica ? ruta : '/login'
  if (perfil === 'clienta') return publica || PRIVADAS.includes(ruta) ? ruta : '/inicio'
  const rol = { cajera: C, admin: A }[perfil]
  if (POS[ruta]) return POS[ruta].includes(rol) ? ruta : INICIAL[rol]
  return INICIAL[rol]
}

const casos = []
async function caso(nombre, fn) {
  const t0 = Date.now()
  try { const detalle = await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 8).join(' | ').slice(0, 1500)
    casos.push({ nombre, ok: false, ms: Date.now() - t0, error: d }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}
async function asentar(page) {
  let previo = null, estable = 0
  const fin = Date.now() + 30000
  while (Date.now() < fin) {
    const e = await page.evaluate(() => ({
      ruta: location.pathname, listo: document.readyState === 'complete', login: Boolean(document.querySelector('#email')),
      texto: (document.querySelector('main')?.innerText ?? '').trim().length,
      cargando: /Cargando|Abriendo/i.test(document.body.innerText.slice(0, 400)) && (document.querySelector('main')?.innerText ?? '').trim().length < 40,
    })).catch(() => null)
    if (e && e.ruta === previo && e.listo && !e.cargando && (e.login || e.texto > 20)) { estable += 1; if (estable >= 4) return e } else estable = 0
    previo = e?.ruta
    await page.waitForTimeout(250)
  }
  return { ruta: previo, timeout: true }
}

// ---------------- salvaguardas ----------------
function validarApp(app) {
  const u = new URL(app)
  if (u.protocol !== 'https:' || !/^([a-z0-9-]+\.)?pos-jaise\.pages\.dev$/.test(u.hostname) || u.pathname !== '/' || u.search || u.hash || u.username || u.password || u.port) throw new Error('--app debe ser exactamente un despliegue https de pos-jaise.pages.dev')
  return u.origin
}
function cuentasStaging() {
  const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env.staging.local'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  if (env.VITE_SUPABASE_URL !== SUPABASE_STAGING) throw new Error('.env.staging.local no apunta al Supabase de staging aprobado')
  const c = { admin: [env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD], cajera: [env.QA_CAJERA_EMAIL, env.QA_CAJERA_PASSWORD], clienta: [env.QA_CLIENTE_EMAIL, env.QA_CLIENTE_PASSWORD] }
  for (const [k, [e, p]] of Object.entries(c)) if (!/@staging\.test$/.test(e ?? '') || !p) throw new Error(`la cuenta ${k} no es QA de staging`)
  return Object.fromEntries(Object.entries(c).map(([k, [email, password]]) => [k, { email, password }]))
}
async function preflight(origen, buildId) {
  const pedir = async (u, { opcional } = {}) => {
    if (new URL(u).origin !== origen) throw new Error(`petición fuera del Preview: ${new URL(u).origin}`)
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (r.status !== 200) { if (opcional) return null; throw new Error(`el Preview respondió ${r.status} a ${new URL(u).pathname}`) }
    return r.text()
  }
  const html = await pedir(`${origen}/`)
  const marca = (html.match(/<meta name="build-id" content="([^"]+)"/) ?? [])[1]
  if (!/^[0-9a-f]{8}$/.test(buildId) || marca !== buildId) throw new Error(`build-id servido ${marca} ≠ esperado ${buildId}: no se autentica nada`)
  const { modulos } = await G.modulosDelBundle(origen, pedir)
  const b = G.backendDeModulos(modulos)
  const urls = [...new Set(b.configs.map((x) => x.url))]
  if (urls.length !== 1 || urls[0] !== SUPABASE_STAGING) throw new Error('el backend efectivo del bundle no es exactamente el Supabase de staging: no se autentica nada')
  if (b.remotos.some((r) => r !== SUPABASE_STAGING)) throw new Error('el bundle referencia otro Supabase: no se autentica nada')
  return { origen, buildId: marca, modulos: modulos.length, backend: 'staging (tqkd…)' }
}

// Proxy de guarda: solo túneles CONNECT hacia el Preview y el Supabase de staging (puerto 443). Nada más sale del navegador.
function proxyStaging(hosts, guarda) {
  const sockets = new Set()
  const srv = http.createServer((req, res) => { req.resume(); guarda.violaciones.push(`salto ${req.method} ${String(req.url).split('?')[0]}`); res.writeHead(403); res.end() })
  srv.on('connect', (req, cliente, cabeza) => {
    const [host, puerto] = String(req.url).split(':')
    if (!hosts.includes(host) || puerto !== '443') {
      // Las preconexiones de index.html (<link rel=preconnect> a Google Fonts) abren un túnel SIN petición: se rechazan sin
      // conectar y se cuentan aparte. Un túnel hacia un destino sensible (otro Supabase, pasarela, loopback) es violación.
      if (/supabase\.(co|in)$|culqi|^127\.|^localhost$/.test(host)) guarda.violaciones.push(`tunel CONNECT ${req.url}`)
      else guarda.preconexionesRechazadas = (guarda.preconexionesRechazadas ?? 0) + 1
      cliente.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return
    }
    const destino = net.connect(443, host, () => { cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (cabeza?.length) destino.write(cabeza); destino.pipe(cliente); cliente.pipe(destino) })
    for (const s of [destino, cliente]) { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => { destino.destroy(); cliente.destroy() }) }
  })
  srv.on('upgrade', (req, s) => { guarda.violaciones.push('upgrade'); s.destroy() })
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { srv.unref(); ok({ url: `http://127.0.0.1:${srv.address().port}`, cerrar: () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()) }) }) }))
}
async function contexto(navegador, origen, guarda) {
  const proxy = await proxyStaging([new URL(origen).hostname, new URL(SUPABASE_STAGING).hostname], guarda)
  const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', proxy: { server: proxy.url } })
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
async function iniciarSesion(page, origen, cuenta, guarda) {
  await page.goto(`${origen}/login`)
  if (new URL(page.url()).origin !== origen || !page.url().endsWith('/login')) throw new Error('la página de login no es la del Preview aprobado')
  if (guarda.violaciones.length) throw new Error(`guarda antes de escribir credenciales: ${guarda.violaciones.slice(0, 3).join(' | ')}`)
  await page.fill('#email', cuenta.email); await page.fill('#password', cuenta.password); await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
  if (guarda.violaciones.length) throw new Error(`guarda tras iniciar sesión: ${guarda.violaciones.slice(0, 3).join(' | ')}`)
}
async function psqlLectura(sql) {
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${sql}`], { encoding: 'utf8', cwd: RAIZ })
  return r.stdout
}

async function main() {
  const origen = validarApp(arg('app'))
  const cuentas = cuentasStaging()
  const pre = await preflight(origen, arg('build-id'))
  casos.push({ nombre: 'Preflight: Preview aprobado, build-id esperado y backend efectivo = Supabase de staging', ok: true, ms: 0, detalle: pre })
  console.log('OK    Preflight: Preview aprobado, build-id esperado y backend efectivo = Supabase de staging')
  const { secciones, rutaInicialPara } = await import(pathToFileURL(path.join(RAIZ, 'src/config/navegacion.js')).href)
  await caso('La matriz esperada coincide con src/config/navegacion.js', async () => {
    const real = Object.fromEntries(secciones.map((s) => [s.path, [...s.roles].sort()]))
    const esp = Object.fromEntries(Object.entries(POS).map(([k, v]) => [k, [...v].sort()]))
    if (JSON.stringify(real) !== JSON.stringify(esp)) throw new Error('la matriz difiere de navegacion.js')
    for (const r of [A, C, S]) if (rutaInicialPara(r) !== INICIAL[r]) throw new Error(`pantalla inicial de ${r}`)
  })
  const ids = (await psqlLectura("select (select id from productos where activo order by nombre limit 1) || '|' || (select id from servicios where activo order by nombre limit 1);")).split('\n').find((l) => /^[0-9a-f-]{36}\|[0-9a-f-]{36}$/.test(l.trim()))
  if (!ids) throw new Error('staging no tiene un producto y un servicio activos')
  const [idProducto, idServicio] = ids.trim().split('|')
  const RUTAS = [...new Set([...Object.keys(POS), ...PUBLICAS, ...PRIVADAS, `/productos/${idProducto}`, `/servicios/${idServicio}`])]
  const navegador = await chromium.launch({ headless: true })
  const matriz = {}
  try {
    for (const [perfil, cuenta] of [['visitante', null], ['clienta', cuentas.clienta], ['cajera', cuentas.cajera], ['admin', cuentas.admin]]) {
      const guarda = { violaciones: [], neutralizadas: 0 }
      const ctx = await contexto(navegador, origen, guarda)
      const page = await ctx.newPage()
      const errores = []
      page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
      if (cuenta) { await iniciarSesion(page, origen, cuenta, guarda); await asentar(page) }
      matriz[perfil] = []
      await caso(`${perfil}: ${RUTAS.length} rutas por URL directa llegan a su destino esperado y se montan sin error`, async () => {
        const malas = []
        for (const ruta of RUTAS) {
          const antesErr = errores.length
          await page.goto(`${origen}${ruta}`)
          const e = await asentar(page)
          const quiere = esperado(perfil, ruta)
          const textoError = await page.evaluate(() => /No se pudo abrir|Ocurrió un error en|Algo salió mal/.test(document.body.innerText))
          const fila = { ruta, destino: e.ruta, esperado: quiere, ok: e.ruta === quiere && !textoError && !e.timeout && errores.length === antesErr }
          if (!fila.ok) malas.push({ ...fila, textoError, timeout: Boolean(e.timeout), pageerror: errores.slice(antesErr) })
          matriz[perfil].push(fila)
        }
        if (malas.length) throw new Error(JSON.stringify(malas.slice(0, 6)))
        return { rutas: RUTAS.length, permitidas: matriz[perfil].filter((f) => f.destino === f.ruta).length }
      })
      if (perfil === 'cajera' || perfil === 'admin') {
        const rol = { cajera: C, admin: A }[perfil]
        await caso(`${perfil}: el menú del POS no ofrece rutas ajenas al rol y sí su pantalla inicial`, async () => {
          await page.goto(`${origen}${INICIAL[rol]}`); await asentar(page)
          const enlaces = await page.evaluate((rutas) => [...new Set([...document.querySelectorAll('header a[href], nav a[href], aside a[href]')].map((a) => new URL(a.href).pathname).filter((p) => rutas.includes(p)))], Object.keys(POS))
          const ajenas = enlaces.filter((p) => !POS[p].includes(rol))
          if (ajenas.length) throw new Error(`enlaces a rutas sin permiso: ${ajenas.join(', ')}`)
          if (!enlaces.includes(INICIAL[rol])) throw new Error(`falta ${INICIAL[rol]} en el menú`)
          return { enlaces }
        })
        await caso(`${perfil}: «Cerrar sesión» y después una ruta del POS vuelve a pedir el login`, async () => {
          await page.getByRole('button', { name: 'Menú de usuario' }).first().click()
          await page.getByRole('button', { name: 'Cerrar sesión' }).first().click()
          await page.getByRole('button', { name: 'Sí, cerrar sesión' }).click()
          await page.waitForTimeout(1500)
          await page.goto(`${origen}${INICIAL[rol]}`)
          const e = await asentar(page)
          if (e.ruta !== '/login') throw new Error(`tras salir, ${INICIAL[rol]} terminó en ${e.ruta}`)
        })
      }
      await ctx.close()
      await caso(`${perfil}: la guarda de red no registró ninguna violación`, async () => {
        if (guarda.violaciones.length) throw new Error([...new Set(guarda.violaciones)].slice(0, 5).join(' | '))
        return { neutralizadas: guarda.neutralizadas, preconexionesRechazadas: guarda.preconexionesRechazadas ?? 0 }
      })
    }
  } finally { await navegador.close() }
  return matriz
}

main().then((matriz) => {
  const fallos = casos.filter((c) => !c.ok)
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify({ fecha: new Date().toISOString(), app: arg('app'), total: casos.length, fallos: fallos.length, casos, matriz }, null, 1))
  console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
  process.exitCode = fallos.length ? 1 : 0
}).catch((e) => { console.error(String(e.message ?? e).slice(0, 500)); process.exitCode = 2 })
