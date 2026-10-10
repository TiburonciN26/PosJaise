// Pruebas del Worker de medios contra R2 SIMULADO (wrangler dev --local) y el
// Supabase de STAGING con las cuentas QA ficticias. No toca R2 real ni el
// Supabase del negocio. Salida: docs/evidencia-rendimiento/fase-3/pruebas-worker.json
//
//   node cloudflare/medios-worker/test/probar-worker.mjs
import { spawn, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(aqui, '../../..')
const carpetaWorker = resolve(aqui, '..')
const estado = resolve(carpetaWorker, '.estado-local')
const PUERTO = 8788
const BASE = `http://127.0.0.1:${PUERTO}`
const ORIGEN_OK = 'http://localhost:5173'

function leerEnv(ruta) {
  const salida = {}
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}

const env = leerEnv(resolve(raiz, '.env.staging.local'))
const REF_STAGING = 'tqkdtojnhgykmcbvwdmz'
if (!env.VITE_SUPABASE_URL?.includes(REF_STAGING)) throw new Error('El entorno de pruebas debe ser el de staging')
if (!/@staging\.test$/.test(env.QA_ADMIN_EMAIL ?? '')) throw new Error('Cuenta QA admin inesperada')

const resultados = []
function caso(nombre, ok, detalle = {}) {
  resultados.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}

async function sesion(email, password) {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`)
  return (await r.json()).access_token
}

// WebP reales generados por Chromium (canvas) para no depender de librerías.
async function fabricarImagenes() {
  const requerir = createRequire(resolve(raiz, 'package.json'))
  const { chromium } = requerir('playwright')
  const navegador = await chromium.launch()
  const pagina = await navegador.newPage()
  const crear = (ancho, alto, tipo, invertir = false) =>
    pagina.evaluate(
      async ([a, h, t, inv]) => {
        const c = document.createElement('canvas')
        c.width = a
        c.height = h
        const x = c.getContext('2d')
        const g = x.createLinearGradient(0, 0, a, h)
        g.addColorStop(inv ? 1 : 0, '#c9a24b')
        g.addColorStop(inv ? 0 : 1, '#2b2b2b')
        x.fillStyle = g
        x.fillRect(0, 0, a, h)
        const blob = await new Promise((ok) => c.toBlob(ok, t, 0.8))
        return Array.from(new Uint8Array(await blob.arrayBuffer()))
      },
      [ancho, alto, tipo, invertir],
    )
  const imgs = {
    miniatura: Uint8Array.from(await crear(320, 320, 'image/webp')),
    miniatura2: Uint8Array.from(await crear(320, 320, 'image/webp', true)),
    grande: Uint8Array.from(await crear(600, 600, 'image/webp')),
    excesiva: Uint8Array.from(await crear(2100, 120, 'image/webp')),
    png: Uint8Array.from(await crear(320, 320, 'image/png')),
  }
  await navegador.close()
  return imgs
}

function iniciarWorker() {
  try { rmSync(estado, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch {}
  mkdirSync(estado, { recursive: true })
  writeFileSync(resolve(carpetaWorker, '.dev.vars'), `SUPABASE_ANON_KEY=${env.VITE_SUPABASE_ANON_KEY}\n`)
  const proceso = spawn(
    'npx',
    [
      'wrangler', 'dev', '--local', '--port', String(PUERTO), '--persist-to', estado,
      '--var', 'SERVIR_LECTURA:1', '--var', `ORIGENES_PERMITIDOS:${ORIGEN_OK}`,
    ],
    { cwd: carpetaWorker, shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let registro = ''
  proceso.stdout.on('data', (d) => (registro += d))
  proceso.stderr.on('data', (d) => (registro += d))
  return { proceso, registro: () => registro }
}

async function esperarWorker(w) {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE}/ping`)
      if (r.status === 404) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('El Worker no arrancó\n' + w.registro())
}

const uuid = () => crypto.randomUUID()
const put = (destino, id, variante, cuerpo, token, extra = {}) =>
  fetch(`${BASE}/v1/medios/${destino}/${id}/${variante}`, {
    method: 'PUT',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'image/webp', Origin: ORIGEN_OK, ...extra },
    body: cuerpo,
  })
const del = (destino, id, token) =>
  fetch(`${BASE}/v1/medios/${destino}/${id}`, {
    method: 'DELETE',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: ORIGEN_OK },
  })

async function principal() {
  // El validador (VP8L/VP8X/estructura) se prueba a fondo en test/probar-unitario.mjs.

  const imgs = await fabricarImagenes()
  caso(
    'fixtures reales: miniatura 320 / grande 600 dentro de los objetivos de peso',
    imgs.miniatura.length <= 80 * 1024 && imgs.grande.length <= 250 * 1024,
    { miniaturaBytes: imgs.miniatura.length, grandeBytes: imgs.grande.length },
  )

  const tokens = {
    admin: await sesion(env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD),
    cajera: await sesion(env.QA_CAJERA_EMAIL, env.QA_CAJERA_PASSWORD),
    cliente: await sesion(env.QA_CLIENTE_EMAIL, env.QA_CLIENTE_PASSWORD),
  }

  const w = iniciarWorker()
  try {
    await esperarWorker(w)

    // ---- autenticación y autorización ----
    let id = uuid()
    let r = await put('fotos-productos', id, 'm', imgs.miniatura, null)
    caso('sin sesión → 401', r.status === 401, { estado: r.status })
    r = await put('fotos-productos', id, 'm', imgs.miniatura, 'token.invalido.firma')
    caso('token inválido/alterado → 401', r.status === 401, { estado: r.status })
    r = await put('fotos-productos', id, 'm', imgs.miniatura, tokens.cajera)
    caso('cajera (rol no autorizado) → 403', r.status === 403, { estado: r.status })
    r = await put('fotos-productos', id, 'm', imgs.miniatura, tokens.cliente)
    caso('cliente (rol no autorizado) → 403', r.status === 403, { estado: r.status })
    r = await del('fotos-productos', id, tokens.cajera)
    caso('cajera no puede eliminar → 403', r.status === 403, { estado: r.status })
    r = await del('fotos-productos', id, null)
    caso('eliminar sin sesión → 401', r.status === 401, { estado: r.status })

    // ---- subida correcta y entrega ----
    r = await put('fotos-productos', id, 'm', imgs.miniatura, tokens.admin)
    const cuerpoM = await r.json()
    caso('admin sube variante m → 201 con ref r2:', r.status === 201 && cuerpoM.ref === `r2:fotos-productos/${id}`, { estado: r.status, cuerpoM })
    r = await put('fotos-productos', id, 'g', imgs.grande, tokens.admin)
    caso('admin sube variante g → 201', r.status === 201, { estado: r.status })

    r = await fetch(`${BASE}/fotos-productos/${id}/m.webp`)
    const bytesLeidos = new Uint8Array(await r.arrayBuffer())
    const etag = r.headers.get('etag')
    caso(
      'entrega: 200, image/webp, immutable 1 año, nosniff, ETag, bytes idénticos',
      r.status === 200 &&
        r.headers.get('content-type') === 'image/webp' &&
        /max-age=31536000/.test(r.headers.get('cache-control')) &&
        /immutable/.test(r.headers.get('cache-control')) &&
        r.headers.get('x-content-type-options') === 'nosniff' &&
        Boolean(etag) &&
        bytesLeidos.length === imgs.miniatura.length &&
        bytesLeidos.every((v, i) => v === imgs.miniatura[i]),
      { cabeceras: Object.fromEntries(r.headers), bytes: bytesLeidos.length },
    )
    r = await fetch(`${BASE}/fotos-productos/${id}/m.webp`, { headers: { 'If-None-Match': etag } })
    caso('entrega: revalidación con ETag → 304', r.status === 304, { estado: r.status })

    // ---- no sobrescribir ----
    r = await put('fotos-productos', id, 'm', imgs.grande.slice(0, 10), tokens.admin)
    const sobre = r.status
    r = await fetch(`${BASE}/fotos-productos/${id}/m.webp`)
    const despues = new Uint8Array(await r.arrayBuffer())
    caso('repetir la misma clave no sobrescribe (el objeto sigue intacto)', despues.length === imgs.miniatura.length, { estadoRepeticion: sobre })
    r = await put('fotos-productos', id, 'm', imgs.miniatura, tokens.admin)
    const reintento = await r.json()
    caso('repetir EXACTAMENTE lo mismo (respuesta perdida) → 200 reanudado, sin duplicar', r.status === 200 && reintento.reanudado === true, { estado: r.status })
    r = await put('fotos-productos', id, 'm', imgs.miniatura2, tokens.admin)
    caso('misma clave con contenido DISTINTO → 409 ya-existe', r.status === 409, { estado: r.status })
    r = await fetch(`${BASE}/fotos-productos/${id}/m.webp`)
    caso('tras el 409 el objeto original sigue intacto', new Uint8Array(await r.arrayBuffer()).every((v, i) => v === imgs.miniatura[i]))

    // ---- límites y formato ----
    const nuevo = () => uuid()
    r = await put('fotos-productos', nuevo(), 'g', new Uint8Array(600 * 1024), tokens.admin)
    caso('exceso de bytes (600 KiB en g) → 413', r.status === 413, { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'm', imgs.grande, tokens.admin)
    caso('imagen 600 px en variante m (tope 400 px / 96 KiB) → rechazada', [413, 422].includes(r.status), { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', imgs.png, tokens.admin)
    caso('MIME falso: PNG declarado como image/webp → 415', r.status === 415, { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', new TextEncoder().encode('<script>alert(1)</script>'.repeat(40)), tokens.admin)
    caso('contenido activo (HTML/JS) → 415', r.status === 415, { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', imgs.excesiva, tokens.admin)
    caso('dimensiones excesivas (2100x120) → 415/422', [415, 422].includes(r.status), { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', imgs.grande.slice(0, Math.floor(imgs.grande.length / 2)), tokens.admin)
    caso('subida incompleta (archivo truncado) → 415, nada publicado', r.status === 415, { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', new Uint8Array(0), tokens.admin)
    caso('cuerpo vacío → 400', r.status === 400, { estado: r.status })

    // ---- rutas y CORS ----
    r = await put('comprobantes-pedidos-web', nuevo(), 'g', imgs.grande, tokens.admin)
    caso('destino no público (comprobantes) → 400', r.status === 400, { estado: r.status })
    r = await put('fotos-productos', '../../etc/passwd', 'g', imgs.grande, tokens.admin)
    caso('id con path traversal → 400/404', [400, 404].includes(r.status), { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'x', imgs.grande, tokens.admin)
    caso('variante inexistente → 400', r.status === 400, { estado: r.status })
    r = await put('fotos-productos', nuevo(), 'g', imgs.grande, tokens.admin, { Origin: 'https://sitio-malicioso.example' })
    caso('origen no permitido → 403', r.status === 403, { estado: r.status })
    r = await fetch(`${BASE}/v1/medios/fotos-productos/${nuevo()}/g`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGEN_OK, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
    })
    caso(
      'preflight CORS: origen exacto, sin comodín',
      r.status === 204 && r.headers.get('access-control-allow-origin') === ORIGEN_OK && /PUT/.test(r.headers.get('access-control-allow-methods')),
      { estado: r.status, acao: r.headers.get('access-control-allow-origin') },
    )
    r = await fetch(`${BASE}/v1/medios/fotos-productos/${nuevo()}/g`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://sitio-malicioso.example', 'Access-Control-Request-Method': 'PUT' },
    })
    caso('preflight de origen ajeno → 403, sin Allow-Origin', r.status === 403 && !r.headers.get('access-control-allow-origin'), { estado: r.status })

    // ---- eliminación idempotente ----
    r = await del('fotos-productos', id, tokens.admin)
    caso('admin elimina → 200', r.status === 200, { estado: r.status })
    r = await fetch(`${BASE}/fotos-productos/${id}/m.webp`)
    caso('tras eliminar la entrega responde 404', r.status === 404, { estado: r.status })
    r = await del('fotos-productos', id, tokens.admin)
    caso('eliminar de nuevo es idempotente → 200', r.status === 200, { estado: r.status })

    // ---- los destinos privados no se sirven ni siquiera con lectura habilitada ----
    r = await fetch(`${BASE}/comprobantes-pedidos-web/${id}/g.webp`)
    caso('lectura de un destino no público → 404', r.status === 404, { estado: r.status })

    // ---- sin secretos en respuestas/registro ----
    const sensible = [env.VITE_SUPABASE_ANON_KEY, env.QA_ADMIN_PASSWORD, tokens.admin].filter(Boolean)
    const registro = w.registro()
    caso('el registro del Worker no contiene tokens, claves ni contraseñas', sensible.every((s) => !registro.includes(s)))
  } finally {
    try { execSync(`taskkill /pid ${w.proceso.pid} /T /F`, { stdio: 'ignore' }) } catch {}
    rmSync(resolve(carpetaWorker, '.dev.vars'), { force: true })
    await new Promise((r) => setTimeout(r, 1500)) // workerd suelta los archivos tras terminar
    try {
      if (existsSync(estado)) rmSync(estado, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    } catch {
      // el estado simulado está git-ignored; si Windows lo retiene se limpia en la siguiente ejecución
    }
  }

  const fallos = resultados.filter((c) => !c.ok)
  const carpeta = resolve(raiz, 'docs/evidencia-rendimiento/fase-3')
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(
    resolve(carpeta, 'pruebas-worker.json'),
    JSON.stringify({ fecha: new Date().toISOString(), entorno: 'R2 simulado (wrangler dev --local) + Supabase de staging', total: resultados.length, fallos: fallos.length, casos: resultados }, null, 2),
  )
  console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
  process.exit(fallos.length ? 1 : 0)
}

principal().catch((e) => {
  console.error(e)
  rmSync(resolve(carpetaWorker, '.dev.vars'), { force: true })
  process.exit(2)
})
