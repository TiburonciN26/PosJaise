// Fase 10A · V2 (F10A-01 de Codex): guardas de las herramientas de 10A que inician sesión o provisionan cuentas.
// Que exista el Supabase Local en Docker NO acota a quién recibe las credenciales: lo decide el bundle que sirve --app. Por eso,
// ANTES de autenticar o de crear la asistente ficticia, y en este orden fijo:
//   1. el origen de --app es loopback http, exacto (sin credenciales, query ni fragmento) y distinto del propio Supabase;
//   2. las cuentas son QA ficticias (`qa-…@test.local` con id uuid);
//   3. el contenedor de Supabase Local publica 127.0.0.1:54321;
//   4. el backend EFECTIVO del bundle servido (la URL de `src/lib/supabase.js`, leída por su ROL en el código compilado, no por la
//      mera presencia de la cadena) es exactamente http://127.0.0.1:54321: sin URL relativa (proxy del mismo origen), sin otro
//      Supabase y sin una segunda configuración;
//   5. cada cuenta existe en el Auth de Local con ese mismo id y correo.
// Y en el navegador, en TODOS los contextos (también el de login): service workers bloqueados; peticiones solo a la app (GET/HEAD,
// nunca a rutas de API servidas por la app) y al Supabase Local; WebSockets solo al Realtime Local; lo demás se resuelve dentro del
// navegador (204 para GET de terceros como fuentes) o se aborta y se registra como VIOLACIÓN. Además se escucha cada petición
// (redirecciones incluidas) por si alguna escapara al enrutado. Antes de escribir credenciales se comprueba que la página de login
// es la de la app aprobada; una violación en cualquier momento hace fallar la herramienta.
// Solo Local: no hay modo staging aquí. Un futuro modo staging tendrá su propio host aprobado y su propia autorización.
//
// V3 (F10A-01b de Codex): el enrutado de Playwright solo ve la PRIMERA URL de una redirección, y el listener de peticiones solo
// registra después de enviar. Por eso cada contexto sale a la red por un PROXY DE GUARDA propio (Node, loopback): el navegador
// pide cada salto (también los de una redirección, y también a loopback: Playwright fuerza `<-loopback>`) a través de él, y el
// proxy aplica la misma clasificación ANTES de abrir ninguna conexión al destino. Lo prohibido recibe 403 del propio proxy y
// queda como violación «salto»; los túneles (CONNECT, usados para WebSocket y https) solo se abren hacia el Supabase Local. El
// throttling del medidor no cambia: la emulación de red de CDP se aplica en el navegador, antes del proxy.
const cp = require('node:child_process')
const http = require('node:http')
const net = require('node:net')

const API_LOCAL = 'http://127.0.0.1:54321'
const WS_LOCAL = 'ws://127.0.0.1:54321'
const CONTENEDOR_KONG = 'supabase_kong_WedJaiseReact'
const CONTENEDOR_DB = 'supabase_db_WedJaiseReact'
const RE_CUENTA_QA = /^qa-[a-z0-9-]+@test\.local$/
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Rutas de API que nunca sirve un build estático: si la app las recibe, es un proxy del mismo origen hacia un destino no verificado.
const RE_RUTA_API = /^\/(?:__supabase|auth\/v1|rest\/v1|realtime\/v1|storage\/v1|functions\/v1|graphql\/v1)(?:\/|$)/
// `src/lib/supabase.js`: `const urlConfigurada = …; const supabaseUrl = urlConfigurada?.startsWith('/') ? … : …` compila a
// `X=`<url>`,Y=X.startsWith(`/`)?…`. Se acepta cualquier comilla para no depender del minificador.
const RE_CONFIG_SUPABASE = /=(["'`])([^"'`]*)\1,[\w$]+=[\w$]+\??\.startsWith\((["'`])\/\3\)\?/g
const RE_SUPABASE_REMOTO = /https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)\b/g

/** 1. Origen de la app: loopback http exacto. Devuelve la app normalizada (sin barra final) y su origen. */
function validarApp(app) {
  let u
  try { u = new URL(app) } catch { throw new Error('--app no es una URL válida; no se autentica ni se provisiona nada') }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error(`--app debe ser una app local (http://127.0.0.1:<puerto>); se recibió el origen ${u.origin}`)
  if (!u.port || u.port === '54321') throw new Error('--app debe indicar el puerto de la app servida (no el de Supabase)')
  if (u.username || u.password || u.search || u.hash) throw new Error('--app no admite credenciales, query ni fragmento')
  if (!/^(\/[\w-]+)*\/?$/.test(u.pathname)) throw new Error('--app solo admite una base simple (p. ej. /PosJaise)')
  return { app: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, origen: u.origin }
}

/** 2. Cuentas QA ficticias, por forma (sin red). `claves` = las entradas del JSON que la herramienta va a usar. */
function validarCuentas(cuentas, claves) {
  const lista = []
  for (const k of claves) {
    const c = cuentas?.[k]
    if (!c || typeof c.email !== 'string' || !RE_CUENTA_QA.test(c.email)) throw new Error(`la cuenta «${k}» no es una cuenta QA ficticia (qa-…@test.local); no se autentica nada`)
    if (!RE_UUID.test(c.id ?? '')) throw new Error(`la cuenta «${k}» no trae su id (uuid) para comprobarla en Local`)
    if (typeof c.password !== 'string' || !c.password) throw new Error(`la cuenta «${k}» no trae contraseña`)
    lista.push({ clave: k, email: c.email, id: c.id })
  }
  return lista
}

/** 3. Contenedor de Supabase Local publicando 54321. */
function verificarDockerLocal(ejecutar = cp.execFileSync) {
  const puertos = ejecutar('docker', ['ps', '--filter', `name=^${CONTENEDOR_KONG}$`, '--format', '{{.Ports}}'], { encoding: 'utf8' })
  if (!/:54321->8000/.test(puertos)) throw new Error('Supabase Local no verificado en 127.0.0.1:54321; no se autentica nada')
}

/** Petición de texto SOLO al origen de la app, sin seguir redirecciones. */
function crearPedirTexto(origen, fetchReal = fetch) {
  return async (url, { opcional = false } = {}) => {
    if (new URL(url).origin !== origen) throw new Error(`petición fuera de la app aprobada: ${new URL(url).origin}`)
    const r = await fetchReal(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    if (r.status >= 300 && r.status < 400) throw new Error(`la app redirige ${new URL(url).pathname} (${r.status}); no se sigue una redirección antes de autenticar`)
    if (r.status !== 200) { if (opcional) return null; throw new Error(`la app respondió ${r.status} a ${new URL(url).pathname}`) }
    return r.text()
  }
}

/** Recorre los módulos JS del bundle servido (index.html, precache del SW y los imports de cada módulo), sin salir de la app. */
async function modulosDelBundle(app, pedirTexto, limite = 800) {
  const base = `${app}/`
  const html = await pedirTexto(base)
  const pendientes = []
  const vistos = new Set()
  const encolar = (ref, desde) => {
    let u
    try { u = new URL(ref, desde) } catch { return }
    if (u.origin !== new URL(app).origin || !u.pathname.startsWith(new URL(base).pathname) || !/\.m?js$/.test(u.pathname)) return
    u.search = ''; u.hash = ''
    if (!vistos.has(u.href)) { vistos.add(u.href); pendientes.push(u.href) }
  }
  for (const m of String(html).matchAll(/(?:src|href)="([^"]+\.m?js)"/g)) encolar(m[1], base)
  const sw = await pedirTexto(`${base}sw.js`, { opcional: true })
  if (sw) for (const m of String(sw).matchAll(/url:"([^"]+\.js)"/g)) encolar(m[1], base)
  const modulos = []
  while (pendientes.length) {
    if (modulos.length >= limite) throw new Error(`el bundle tiene más de ${limite} módulos: no se puede recorrer completo; no se autentica nada`)
    const url = pendientes.shift()
    const texto = await pedirTexto(url)
    modulos.push({ url, texto })
    // imports relativos (`./x.js`) y la lista de dependencias de Vite (`assets/x.js`, relativa a la base)
    for (const m of texto.matchAll(/["'`](\.{1,2}\/[\w.~-]+\.m?js)["'`]/g)) encolar(m[1], url)
    for (const m of texto.matchAll(/["'`](assets\/[\w.~-]+\.m?js)["'`]/g)) encolar(m[1], base)
  }
  return { modulos, indexHtml: String(html) }
}

/** 4. Backend efectivo del bundle: exactamente el Supabase Local, una sola configuración, sin Supabase remoto. */
function backendDeModulos(modulos) {
  const configs = []
  const remotos = new Set()
  for (const { url, texto } of modulos) {
    for (const m of texto.matchAll(RE_CONFIG_SUPABASE)) configs.push({ modulo: url.split('/').pop(), url: m[2] })
    for (const m of texto.matchAll(RE_SUPABASE_REMOTO)) remotos.add(m[0])
  }
  return { configs, remotos: [...remotos] }
}
function exigirBackendLocal({ configs, remotos }) {
  if (!configs.length) throw new Error('no se encontró la configuración de Supabase en el bundle servido (¿no es un build de esta app?); no se autentica nada')
  const distintas = [...new Set(configs.map((c) => c.url))]
  if (distintas.length !== 1 || distintas[0] !== API_LOCAL) throw new Error(`el backend efectivo del bundle no es exactamente ${API_LOCAL} (observado: ${distintas.map((u) => (u.startsWith('/') ? `relativo ${u}` : new URL(u, 'http://x').origin)).join(', ')}); no se autentica nada`)
  if (remotos.length) throw new Error(`el bundle referencia un Supabase remoto (${remotos.length}); no se autentica nada`)
}

/** 5. Las cuentas existen en el Auth de Local con ese id y correo (lectura). Los valores ya pasaron por validarCuentas. */
function verificarCuentasEnLocal(lista, ejecutar = cp.execFileSync) {
  const pares = lista.map((c) => `('${c.id}'::uuid, '${c.email}')`).join(', ')
  const sql = `begin read only; select count(*) from auth.users where (id, email) in (${pares}); rollback;`
  const salida = ejecutar('docker', ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: sql, encoding: 'utf8' })
  const n = Number(salida.split('\n').find((l) => /^\d+$/.test(l.trim())))
  if (n !== lista.length) throw new Error(`${lista.length - n} de ${lista.length} cuentas no existen en el Auth de Local con ese id y correo; no se autentica nada`)
}

/**
 * Preflight completo, en orden fijo. Ninguna petición sale hacia Supabase: solo GET a la app aprobada (sin redirecciones) y
 * lecturas a Docker. Devuelve un resumen sin secretos para la evidencia.
 */
async function preflightLocal({ app, cuentas, claves, pedirTexto, ejecutar = cp.execFileSync }) {
  const v = validarApp(app)
  const lista = validarCuentas(cuentas, claves)
  verificarDockerLocal(ejecutar)
  const { modulos, indexHtml } = await modulosDelBundle(v.app, pedirTexto ?? crearPedirTexto(v.origen))
  const backend = backendDeModulos(modulos)
  exigirBackendLocal(backend)
  verificarCuentasEnLocal(lista, ejecutar)
  const indexSha256 = require('node:crypto').createHash('sha256').update(indexHtml).digest('hex')
  return { app: v.app, api: API_LOCAL, indexSha256, modulosRevisados: modulos.length, configuraciones: backend.configs.length, cuentas: lista.map((c) => c.clave) }
}

// ---------------- navegador ----------------

/** 'permitida' | 'neutralizada' (se responde 204 dentro del navegador: nunca sale) | 'prohibida' (se aborta y es violación). */
function clasificarPeticion(url, metodo, origenApp) {
  let u
  try { u = new URL(url) } catch { return 'permitida' }
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return 'permitida'
  const lectura = metodo === 'GET' || metodo === 'HEAD'
  if (u.origin === API_LOCAL) return 'permitida'
  if (u.origin === origenApp) return lectura && !RE_RUTA_API.test(u.pathname) ? 'permitida' : 'prohibida'
  const h = u.hostname
  const sensible = h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h.endsWith('.local') || /supabase\.(co|in)$/.test(h) || /culqi/i.test(h)
  return lectura && !sensible ? 'neutralizada' : 'prohibida'
}

function crearGuarda(app) {
  const { origen } = validarApp(app)
  return { origen, violaciones: [], neutralizadas: 0 }
}
function registrar(guarda, tipo, metodo, url) {
  let destino = url
  try { const u = new URL(url); destino = `${u.origin}${u.pathname}` } catch {}
  guarda.violaciones.push(`${tipo} ${metodo} ${destino}`)
}

const SALTO_FUERA = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'upgrade'])
const sinSalto = (cab) => Object.fromEntries(Object.entries(cab).filter(([k]) => !SALTO_FUERA.has(k.toLowerCase())))

/**
 * Proxy de guarda de un contexto. Decide cada petición que el navegador va a transmitir (redirecciones incluidas) antes de
 * conectar con el destino: 'permitida' se reenvía SIN seguir redirecciones (el siguiente salto vuelve a pasar por aquí);
 * cualquier otra → 403 sin salir, y queda registrada.
 */
function crearProxyGuarda(guarda) {
  const agente = new http.Agent({ keepAlive: true })
  const sockets = new Set()
  const srv = http.createServer((req, res) => {
    let u = null
    try { u = new URL(req.url) } catch {}
    const c = u && u.protocol === 'http:' ? clasificarPeticion(u.href, req.method, guarda.origen) : 'prohibida'
    if (c !== 'permitida') {
      // Aquí solo llega lo que el enrutado dejó pasar: un GET de terceros normal ya se respondió con 204 dentro del navegador.
      // Que llegue uno (por ejemplo, el salto de una redirección) también es una violación, aunque no se transmita.
      req.resume()
      registrar(guarda, 'salto', req.method, u?.href ?? String(req.url))
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('bloqueado por la guarda de red de 10A')
    }
    const q = http.request({ host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: req.method, headers: sinSalto(req.headers), agent: agente }, (r) => {
      res.writeHead(r.statusCode, sinSalto(r.headers))
      r.pipe(res)
    })
    q.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(q)
  })
  // CONNECT: WebSocket (Chromium los tuneliza siempre) y https. Solo hacia el Supabase Local; el resto se niega sin conectar.
  srv.on('connect', (req, cliente, cabeza) => {
    if (`http://${req.url}` !== API_LOCAL) {
      registrar(guarda, 'tunel', 'CONNECT', `http://${req.url}`)
      cliente.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    const destino = net.connect(54321, '127.0.0.1', () => {
      cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (cabeza?.length) destino.write(cabeza)
      destino.pipe(cliente); cliente.pipe(destino)
    })
    for (const s of [destino, cliente]) { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => { destino.destroy(); cliente.destroy() }) }
  })
  // Una petición de Upgrade sin túnel no es lo que hace Chromium: se niega y se registra.
  srv.on('upgrade', (req, socket) => { registrar(guarda, 'upgrade', 'GET', String(req.url)); socket.destroy() })
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => {
    srv.unref()
    ok({
      url: `http://127.0.0.1:${srv.address().port}`,
      cerrar: () => new Promise((r) => { for (const s of sockets) s.destroy(); agente.destroy(); srv.close(() => r()) }),
    })
  }))
}

/** Contexto de Playwright con todas las guardas. TODO contexto de las herramientas de 10A se crea aquí, también el de login. */
async function contextoSeguro(navegador, opciones, guarda) {
  const proxy = await crearProxyGuarda(guarda)
  let ctx
  try {
    ctx = await navegador.newContext({ ...opciones, serviceWorkers: 'block', proxy: { server: proxy.url } })
  } catch (e) { await proxy.cerrar(); throw e }
  ctx.on('close', () => { proxy.cerrar() })
  await ctx.routeWebSocket(/.*/, (ws) => {
    let u = null
    try { u = new URL(ws.url()) } catch {}
    if (u && u.origin === WS_LOCAL && u.pathname.startsWith('/realtime/v1/')) return ws.connectToServer()
    registrar(guarda, 'websocket', 'WS', ws.url())
    return ws.close()
  })
  await ctx.route('**/*', (route) => {
    const req = route.request()
    const c = clasificarPeticion(req.url(), req.method(), guarda.origen)
    if (c === 'permitida') return route.continue()
    if (c === 'neutralizada') { guarda.neutralizadas += 1; return route.fulfill({ status: 204, body: '' }) }
    registrar(guarda, 'peticion', req.method(), req.url())
    return route.abort('blockedbyclient')
  })
  // Segunda línea: cualquier petición que el navegador llegue a crear (redirecciones incluidas) hacia un destino prohibido.
  ctx.on('request', (req) => {
    if (clasificarPeticion(req.url(), req.method(), guarda.origen) === 'prohibida') registrar(guarda, req.redirectedFrom() ? 'redireccion' : 'evento', req.method(), req.url())
  })
  return ctx
}

function exigirSinViolaciones(guarda, momento) {
  if (guarda.violaciones.length) throw new Error(`guarda de red (${momento}): ${[...new Set(guarda.violaciones)].slice(0, 5).join(' | ')}`)
}

/**
 * Login en la página de la app aprobada. Playwright no enruta los saltos de una redirección HTTP (3xx) de una navegación: por eso,
 * antes de navegar, se comprueba desde Node (sin seguir redirecciones) que la app responde el login ella misma; y antes de escribir
 * credenciales, que la página cargada es la de la app aprobada.
 */
async function iniciarSesion(page, app, cuenta, guarda) {
  const { origen } = validarApp(app)
  await crearPedirTexto(origen)(`${app}/login`)
  await page.goto(`${app}/login`)
  const u = new URL(page.url())
  if (u.origin !== origen || !u.pathname.endsWith('/login')) throw new Error(`la página de login no es la de la app aprobada (${u.origin}${u.pathname}); no se escriben credenciales`)
  exigirSinViolaciones(guarda, 'antes de escribir credenciales')
  await page.fill('#email', cuenta.email)
  await page.fill('#password', cuenta.password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
  exigirSinViolaciones(guarda, 'tras iniciar sesión')
}

module.exports = {
  API_LOCAL, WS_LOCAL, RE_CUENTA_QA,
  validarApp, validarCuentas, verificarDockerLocal, crearPedirTexto, modulosDelBundle, backendDeModulos, exigirBackendLocal,
  verificarCuentasEnLocal, preflightLocal, clasificarPeticion, crearGuarda, crearProxyGuarda, contextoSeguro, exigirSinViolaciones, iniciarSesion,
}
