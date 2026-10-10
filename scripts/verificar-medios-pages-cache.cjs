// Prueba REAL de la entrega de medios por Pages Functions (Cache API, head() del binding, ETag/304, HEAD, Range, TTL).
//   node scripts/verificar-medios-pages-cache.cjs --build-id=<8 hex> [--sin-expiracion] [--salida=<carpeta>]
//
// ESCRIBE en STAGING (con autorización expresa del usuario): sube UN objeto ficticio (fotos-galeria/<uuid propio>, variantes m y g)
// por el Worker autenticado con la cuenta QA ADMIN, lo lee por <alias>/medios/…, lo borra por el Worker y espera el TTL de 300 s para
// ver la expiración. NO toca filas de la base de datos, el negocio, producción ni GitHub Pages. Solo borra el objeto propio, y solo
// después de comprobar por el inventario del Worker que existe. Aborta ANTES de autenticar o escribir si el alias no sirve el
// build-id pedido con la entrega `pages` efectiva (mismo preflight que el verificador de interfaz: marca + configuración de medios).
//
// Qué observa y qué NO:
//  · La Cache API de Cloudflare es POR CENTRO DE DATOS: un HIT solo se afirma para el centro que atiende estas peticiones; no hay
//    garantía de que dos peticiones consecutivas lleguen al mismo, ni de que la escritura (waitUntil) esté lista a la siguiente
//    petición: por eso el HIT se busca con reintentos y se REGISTRA el número de intentos. Se registran el POP (de CF-Ray) del HIT y del
//    404 posterior al TTL: solo si coinciden el 404 corresponde a la expiración de ESA copia (`expiracionDeLaMismaCopia`).
//  · `head()` del binding no es observable desde fuera; se infiere que HEAD responde 200 con ETag sin cuerpo y sin poblar la caché.
//  · Tras borrar el objeto de R2 puede haber un HIT positivo durante el TTL (contrato). La ausencia se prueba con el INVENTARIO del
//    Worker; el 404 público solo se exige después de expirar el TTL. Los tiempos son de este cliente, no métricas de CPU/cuota.
//  · CP-01: la limpieza y la comprobación final del estado SON parte del resultado: si fallan (lectura del inventario, DELETE,
//    relectura, paginación) la corrida NO es completa y termina con código distinto de cero.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require('playwright')
const G = require('./lib/guardas-interfaz-r2.cjs')

const raiz = path.resolve(__dirname, '..')
const argumento = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const BUILD_ID = argumento('build-id')
const SIN_EXPIRACION = process.argv.includes('--sin-expiracion')
// --salida=<carpeta>: dónde se escribe el informe (por defecto, la evidencia del repo; otros revisores pueden usar una carpeta propia).
const SALIDA = argumento('salida') ? path.resolve(argumento('salida')) : path.join(raiz, 'docs/evidencia-rendimiento/fase-3/medios-pages')
const ALIAS = G.ALIAS_APROBADO
const WORKER = G.WORKER_APROBADO
const BASE = `${ALIAS}/medios`
const TTL_S = 300
const DESTINO = 'fotos-galeria'
const ID = crypto.randomUUID()
const ID_EJECUCION = crypto.randomBytes(3).toString('hex')

function leerEnv(ruta) {
  const salida = {}
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(path.join(raiz, '.env.staging.local'))
const SUPA = env.VITE_SUPABASE_URL
const aprobados = new Set([new URL(ALIAS).origin, `https://${G.REF_STAGING}.supabase.co`, WORKER])
const seguro = G.crearFetchSeguro(aprobados, (...a) => fetch(...a))
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ok: Boolean(ok), detalle })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}
const medidas = []
const medir = async (etiqueta, fn) => {
  const t0 = performance.now()
  const r = await fn()
  medidas.push({ etiqueta, ms: Math.round(performance.now() - t0) })
  return r
}

let tokenAdmin
async function sesion() {
  const r = await seguro(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD }) })
  if (!r.ok) throw new Error('login QA rechazado')
  return (await r.json()).access_token
}
const cab = () => ({ Authorization: `Bearer ${tokenAdmin}`, Origin: ALIAS })
const inventario = () => G.leerInventario([DESTINO], async (d) => {
  const r = await seguro(`${WORKER}/v1/inventario/${d}`, { headers: cab() })
  return { estado: r.status, cuerpo: await r.json().catch(() => null) }
})
const url = (v) => `${BASE}/${DESTINO}/${ID}/${v}.webp`
const pedir = (v, init) => seguro(url(v), { redirect: 'error', ...init })
const cabeceras = (r) => ({
  tipo: r.headers.get('content-type'), cache: r.headers.get('cache-control'), nosniff: r.headers.get('x-content-type-options'),
  robots: r.headers.get('x-robots-tag'), medios: r.headers.get('x-medios-cache'), etag: r.headers.get('etag'), cf: r.headers.get('cf-cache-status'),
  range: r.headers.get('content-range'), allow: r.headers.get('allow'), ray: r.headers.get('cf-ray'),
})
// Centro de datos (POP) = sufijo de CF-Ray (<id>-<IATA>); la Cache API es por POP: se registra para no atribuir una expiración a otra copia.
const pop = (h) => (h?.ray ?? '').split('-')[1] ?? null
const comunes = (h) => h.nosniff === 'nosniff' && h.robots === 'noindex'
const igualesBytes = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0

async function fabricarWebp(lado) {
  const nav = await chromium.launch()
  try {
    const pagina = await nav.newPage()
    const b64 = await pagina.evaluate(async (l) => {
      const c = document.createElement('canvas'); c.width = l; c.height = l
      const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, l, l)
      grad.addColorStop(0, '#d4af37'); grad.addColorStop(1, '#8b2252'); g.fillStyle = grad; g.fillRect(0, 0, l, l)
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8))
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    }, lado)
    return Buffer.from(b64, 'base64')
  } finally { await nav.close() }
}

;(async () => {
  const informe = { fecha: new Date().toISOString(), buildId: BUILD_ID, alias: ALIAS, idEjecucion: ID_EJECUCION, objeto: `${DESTINO}/${ID}`, ttlSegundos: TTL_S, completa: false, estadoFinalConfirmado: false, error: null, casos, medidas, nota: 'HIT por centro de datos; head() inferido; tiempos del cliente, no CPU/cuota.' }
  let subido = false
  let baseClaves = null
  try {
    // ---- preflight: marca + entrega `pages` efectiva, ANTES de autenticar o escribir ----
    const { clasificarClave } = await import('./lib/entornos-supabase.mjs')
    const pf = await G.preflight(
      { alias: ALIAS, buildId: BUILD_ID, entrega: 'pages', supabaseUrl: SUPA, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL, env.QA_CLIENTE_EMAIL], clasificarClave },
      async (u) => (await seguro(u)).text())
    caso(`preflight: el alias sirve ${pf.buildId} con la entrega de medios «pages» efectiva (antes de autenticar)`, pf.entrega === 'pages', pf)
    tokenAdmin = await sesion()
    baseClaves = await inventario()
    caso('inventario inicial de fotos-galeria leído (lectura estricta, sin cursor)', baseClaves instanceof Set, { claves: baseClaves.size })
    const m = await fabricarWebp(64)
    const g = await fabricarWebp(128)
    caso('WebP de prueba fabricados (m 64 px, g 128 px)', m.length > 100 && g.length > 100, { m: m.length, g: g.length })

    // ---- 1. antes de subir: 404 y NO se cachea ----
    const antes = await pedir('m')
    const ha = cabeceras(antes)
    caso('objeto inexistente → 404 no-store con nosniff/noindex (el 404 no se cachea)', antes.status === 404 && ha.cache === 'no-store' && comunes(ha), { estado: antes.status, ...ha })

    // ---- 2. subida por el Worker autenticado ----
    for (const [v, cuerpo] of [['m', m], ['g', g]]) {
      const r = await seguro(`${WORKER}/v1/medios/${DESTINO}/${ID}/${v}`, { method: 'PUT', headers: { ...cab(), 'Content-Type': 'image/webp' }, body: cuerpo })
      subido = subido || r.status === 201 || r.status === 200
      caso(`subida de la variante ${v} por el Worker (201)`, r.status === 201, { estado: r.status })
    }
    const inv1 = await inventario()
    caso('el inventario del Worker muestra exactamente las 2 claves propias nuevas', [...inv1].filter((k) => !baseClaves.has(k)).sort().join() === `${DESTINO}/${ID}/g.webp,${DESTINO}/${ID}/m.webp`, { nuevas: [...inv1].filter((k) => !baseClaves.has(k)) })

    // ---- 3. HEAD: metadatos sin cuerpo y sin poblar la caché ----
    const h1 = await medir('HEAD-1', () => pedir('m', { method: 'HEAD' }))
    const hh1 = cabeceras(h1)
    caso('HEAD: 200 sin cuerpo, image/webp, ETag, max-age=300, nosniff/noindex', h1.status === 200 && (await h1.text()) === '' && hh1.tipo === 'image/webp' && !!hh1.etag && hh1.cache === `public, max-age=${TTL_S}` && comunes(hh1), hh1)
    const h2 = cabeceras(await pedir('m', { method: 'HEAD' }))
    caso('HEAD no puebla la caché: un segundo HEAD sigue siendo MISS', hh1.medios === 'MISS' && h2.medios === 'MISS', { primero: hh1.medios, segundo: h2.medios })

    // ---- 4. GET: bytes exactos, MISS, y luego HIT ----
    const g1 = await medir('GET-MISS', () => pedir('m'))
    const gh1 = cabeceras(g1)
    const bytes1 = Buffer.from(await g1.arrayBuffer())
    caso('GET: 200 image/webp con los bytes EXACTOS subidos, max-age=300, nosniff/noindex, ETag igual al de HEAD', g1.status === 200 && igualesBytes(bytes1, m) && gh1.tipo === 'image/webp' && gh1.cache === `public, max-age=${TTL_S}` && comunes(gh1) && gh1.etag === hh1.etag, { ...gh1, bytes: bytes1.length })
    caso('primer GET tras subir (sin entrada previa en este centro de datos) → X-Medios-Cache MISS', gh1.medios === 'MISS', gh1)
    let hit = null
    let intentos = 0
    for (; intentos < 8 && !hit; intentos += 1) {
      await espera(500 * (intentos + 1))
      const r = await medir(`GET-intento-${intentos + 1}`, () => pedir('m'))
      const h = cabeceras(r)
      if (r.status === 200 && h.medios === 'HIT') hit = { h, bytes: Buffer.from(await r.arrayBuffer()) }
      else await r.arrayBuffer()
    }
    informe.popHit = hit ? pop(hit.h) : null
    caso(`GET posterior → HIT (la escritura por waitUntil es asíncrona y por centro de datos: ${intentos} intento(s))`, !!hit, { intentos, pop: informe.popHit })
    if (hit) caso('el HIT conserva bytes, ETag y max-age=300 y recalcula X-Medios-Cache', igualesBytes(hit.bytes, m) && hit.h.etag === hh1.etag && hit.h.cache === `public, max-age=${TTL_S}` && comunes(hit.h), hit.h)

    // ---- 5. condicionales y Range ----
    const c304 = await pedir('m', { headers: { 'If-None-Match': hh1.etag } })
    const c304h = cabeceras(c304)
    caso('If-None-Match coincidente → 304 sin cuerpo, con ETag, max-age=300 y nosniff/noindex', c304.status === 304 && (await c304.text()) === '' && c304h.etag === hh1.etag && c304h.cache === `public, max-age=${TTL_S}` && comunes(c304h), c304h)
    const cOtro = await pedir('m', { headers: { 'If-None-Match': '"otro"' } })
    caso('If-None-Match distinto → 200 completo', cOtro.status === 200 && Buffer.from(await cOtro.arrayBuffer()).length === m.length)
    const cStar = await pedir('m', { headers: { 'If-None-Match': '*' } })
    caso('If-None-Match: * → 304', cStar.status === 304)
    const rg = await pedir('m', { headers: { Range: 'bytes=0-3' } })
    const rgh = cabeceras(rg)
    caso('Range se ignora: 200 completo, sin Content-Range', rg.status === 200 && !rgh.range && Buffer.from(await rg.arrayBuffer()).length === m.length, rgh)
    const gg = await pedir('g')
    caso('la variante g se sirve con sus bytes exactos', gg.status === 200 && igualesBytes(Buffer.from(await gg.arrayBuffer()), g))

    // ---- 6. métodos y rutas inválidas ----
    const post = await pedir('m', { method: 'POST', body: 'x' })
    caso('POST → 405 con Allow: GET, HEAD, no-store', post.status === 405 && post.headers.get('allow') === 'GET, HEAD' && post.headers.get('cache-control') === 'no-store' && comunes(cabeceras(post)))
    const invalidas = [`${BASE}/${DESTINO}/${ID}/x.webp`, `${BASE}/${DESTINO}/${ID}/M.webp`, `${BASE}/otro/${ID}/m.webp`, `${BASE}/${DESTINO}/no-uuid/m.webp`, `${BASE}/${DESTINO}/${ID}/m.webp.png`, `${BASE}/`, `${ALIAS}/medios`]
    const malas = []
    for (const u of invalidas) {
      const r = await seguro(u)
      const t = await r.text()
      const h = cabeceras(r)
      if (r.status !== 404 || h.cache !== 'no-store' || !comunes(h) || t.includes('<html')) malas.push([u, r.status])
    }
    caso('rutas inválidas → 404 no-store con nosniff/noindex (no la SPA)', malas.length === 0, malas)
    const spa = await seguro(`${ALIAS}/medios-extra`)
    caso('/medios-extra sigue siendo la SPA (200 HTML)', spa.status === 200 && (await spa.text()).includes('build-id'))

    // ---- 7. borrado: ausencia en R2 (inventario) vs retención por TTL ----
    const del = await seguro(`${WORKER}/v1/medios/${DESTINO}/${ID}`, { method: 'DELETE', headers: cab() })
    caso('borrado por el Worker (200)', del.status === 200, { estado: del.status })
    const t0 = Date.now()
    const inv2 = await inventario()
    caso('R2: el inventario del Worker ya NO contiene las claves propias (ausencia en R2 confirmada)', ![...inv2].some((k) => k.startsWith(`${DESTINO}/${ID}/`)) && inv2.size === baseClaves.size, { claves: inv2.size })
    const tras = await pedir('m')
    const th = cabeceras(tras)
    const retenido = tras.status === 200 && th.medios === 'HIT'
    caso('tras borrar en R2: o HIT 200 retenido por el TTL (contrato) o 404; NUNCA un 200 MISS (que significaría que R2 aún lo sirve)', retenido || tras.status === 404, { estado: tras.status, ...th })
    informe.retencionObservada = retenido ? 'HIT 200 durante el TTL (esperado por contrato)' : 'respuesta 404 inmediata (esta petición no tenía entrada en caché en su centro de datos)'
    await tras.arrayBuffer()

    // ---- 8. expiración ----
    if (SIN_EXPIRACION) {
      console.log('(omitida la espera del TTL por --sin-expiracion; NO se prueba la expiración)')
      informe.expiracionProbada = false
    } else {
      const restante = TTL_S * 1000 - (Date.now() - t0) + 15000
      console.log(`esperando ${Math.ceil(restante / 1000)} s para que expire el TTL de ${TTL_S} s…`)
      await espera(Math.max(restante, 0))
      const exp = await pedir('m')
      const eh = cabeceras(exp)
      informe.popExpiracion = pop(eh)
      informe.expiracionDeLaMismaCopia = !!informe.popHit && informe.popHit === informe.popExpiracion
      caso('pasado el TTL: se OBSERVA un 404 no-store (R2 ya no lo tiene)', exp.status === 404 && eh.cache === 'no-store' && comunes(eh), { estado: exp.status, popHit: informe.popHit, popExpiracion: informe.popExpiracion, ...eh })
      console.log(informe.expiracionDeLaMismaCopia
        ? `(mismo centro de datos ${informe.popHit}: el 404 corresponde a la expiración de la copia que dio HIT)`
        : `(AVISO: centro de datos del HIT ${informe.popHit ?? '?'} ≠ el del 404 ${informe.popExpiracion ?? '?'}: el 404 no demuestra por sí solo que expiró LA MISMA copia)`)
      const exp2 = await pedir('g')
      caso('pasado el TTL: también 404 en la variante g', exp2.status === 404)
      informe.expiracionProbada = true
    }
    informe.completa = true
  } catch (e) {
    informe.error = String(e.message ?? e)
    console.log(`ERROR: ${informe.error}`)
    caso('la corrida terminó sin error', false, { error: informe.error })
  } finally {
    // CP-01: limpieza SOLO del objeto propio; cualquier excepción de la limpieza o de la comprobación final es un FALLO (nunca éxito).
    if (tokenAdmin) {
      const lim = await G.limpiarObjetoPropio({
        prefijo: `${DESTINO}/${ID}/`,
        base: baseClaves,
        leerInventario: inventario,
        borrarObjeto: async () => (await seguro(`${WORKER}/v1/medios/${DESTINO}/${ID}`, { method: 'DELETE', headers: cab() })).status,
      })
      informe.limpieza = lim
      if (lim.necesaria) console.log(`AVISO: limpieza del objeto propio (DELETE ${lim.estadoBorrado}); pendientes: ${lim.pendientes.length}`)
      informe.estadoFinalConfirmado = lim.confirmada
      caso('ESTADO FINAL confirmado: inventario de fotos-galeria idéntico al inicial, sin claves propias pendientes y sin errores de limpieza', lim.confirmada, lim)
    } else {
      informe.estadoFinalConfirmado = !subido // sin sesión no hubo escrituras posibles
      if (subido) caso('ESTADO FINAL confirmado', false, { motivo: 'se subió un objeto sin poder verificar el estado final' })
    }
    informe.completa = informe.completa && informe.estadoFinalConfirmado === true
    informe.resumen = { casos: casos.length, fallos: casos.filter((c) => !c.ok).length }
    fs.mkdirSync(SALIDA, { recursive: true })
    const destino = path.join(SALIDA, `cache-${ID_EJECUCION}.json`)
    fs.writeFileSync(destino, JSON.stringify(informe, null, 2))
    console.log(`\n${informe.resumen.casos} casos, ${informe.resumen.fallos} fallos; completa=${informe.completa}; estado final confirmado=${informe.estadoFinalConfirmado} → ${destino}`)
    process.exitCode = informe.resumen.fallos || !informe.completa ? 1 : 0
  }
})()
