// robots.txt y sitemap.xml del portal (auditoría global 2026-11-20, hallazgo 19.1). Se GENERAN al compilar
// (scripts/build-cloudflare.mjs): antes no existían y Cloudflare respondía /robots.txt con el index.html de la SPA.
//
//  · Producción: robots permite el portal público y bloquea las pantallas del POS y las privadas de la clienta; el sitemap
//    lista las rutas públicas y, si se puede consultar el catálogo, cada /servicios/:id y /productos/:id activos (son las
//    páginas que más traen búsquedas). Si la consulta falla, el sitemap sale con las rutas fijas y el build NO falla.
//  · Preview de Cloudflare: robots «Disallow: /» y sin sitemap (además Pages ya marca *.pages.dev de preview noindex).
//
// El dominio público sale de VITE_SITIO_URL; sin ella, el de producción actual. Si algún día hay dominio propio, basta
// definir VITE_SITIO_URL en Pages (también lo usan las etiquetas Open Graph de index.html, ver vite.config.js).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SITIO_POR_DEFECTO = 'https://pos-jaise.pages.dev'

/** Rutas del portal que ve un visitante sin sesión (las que se indexan). Ver App.jsx. */
export const RUTAS_PUBLICAS = [
  '/inicio',
  '/servicios',
  '/productos',
  '/nosotros',
  '/citas',
  '/recompensas',
  '/libro-de-reclamaciones',
  '/terminos-y-condiciones',
  '/politica-de-cambios-y-devoluciones',
  '/politica-de-privacidad',
]

/**
 * Token de verificación de Google Search Console (VITE_GOOGLE_SITE_VERIFICATION). Acepta el valor de content="…" o la
 * etiqueta <meta> entera pegada tal cual. Devuelve solo el token (letras, dígitos, _ y -) o null si no hay uno válido:
 * nunca se inyecta texto arbitrario en index.html.
 */
export function metaVerificacionGoogle(valor) {
  const texto = String(valor ?? '').trim()
  const token = texto.match(/content=["']([^"']+)["']/)?.[1] ?? texto
  return /^[A-Za-z0-9_-]{10,100}$/.test(token) ? token : null
}

/** Rutas privadas del portal (RutaPrivada en App.jsx) y el login: nada que indexar. */
export const RUTAS_PRIVADAS_PORTAL = ['/login', '/mi-perfil', '/carrito', '/citas/carrito', '/historial', '/mis-resenas']

export function sitioDe(env = {}) {
  const valor = String(env.VITE_SITIO_URL ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+$/i.test(valor) ? valor : SITIO_POR_DEFECTO
}

/**
 * Rutas que se bloquean: las del POS (src/config/navegacion.js) que NO son también del portal público, más las privadas.
 * POS y portal comparten /servicios y /citas (árboles distintos de App.jsx): esas no se bloquean.
 */
export function rutasBloqueadas(rutasPos) {
  const publicas = new Set(RUTAS_PUBLICAS)
  return [...new Set([...rutasPos.filter((r) => !publicas.has(r)), ...RUTAS_PRIVADAS_PORTAL])].sort()
}

export function textoRobots({ sitio, indexar, bloqueadas }) {
  if (!indexar) return 'User-agent: *\nDisallow: /\n'
  return ['User-agent: *', 'Allow: /', ...bloqueadas.map((r) => `Disallow: ${r}`), '', `Sitemap: ${sitio}/sitemap.xml`, ''].join('\n')
}

const escaparXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function xmlSitemap(sitio, rutas) {
  const urls = rutas.map((r) => `  <url><loc>${escaparXml(`${sitio}${r}`)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ids de servicios y productos activos, leídos con la clave PÚBLICA (lo mismo que ve un visitante). null si falla. */
export async function rutasDelCatalogo(env, { fetch: pedir = globalThis.fetch, msMax = 8000 } = {}) {
  const url = String(env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const clave = env.VITE_SUPABASE_ANON_KEY
  if (!/^https?:\/\//.test(url) || !clave) return null
  const leer = async (tabla) => {
    const r = await pedir(`${url}/rest/v1/${tabla}?select=id&activo=eq.true&order=id`, {
      headers: { apikey: clave, Authorization: `Bearer ${clave}` },
      signal: AbortSignal.timeout(msMax),
    })
    if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`)
    const filas = await r.json()
    return filas.map((f) => f.id).filter((id) => UUID.test(String(id)))
  }
  try {
    const [servicios, productos] = await Promise.all([leer('servicios'), leer('productos')])
    return [...servicios.map((id) => `/servicios/${id}`), ...productos.map((id) => `/productos/${id}`)]
  } catch (error) {
    return { error: error.message }
  }
}

/** Escribe robots.txt (y sitemap.xml si se indexa) en la salida. Devuelve un resumen para el log del build. */
export async function escribirSeo(salida, { env, indexar, rutasPos, consultarCatalogo }) {
  const sitio = sitioDe(env)
  writeFileSync(join(salida, 'robots.txt'), textoRobots({ sitio, indexar, bloqueadas: rutasBloqueadas(rutasPos) }))
  if (!indexar) return 'robots.txt sin indexar (preview), sin sitemap'
  let dinamicas = []
  let nota = 'sin consultar el catálogo'
  if (consultarCatalogo) {
    const r = await rutasDelCatalogo(env)
    if (Array.isArray(r)) {
      dinamicas = r
      nota = `${r.length} páginas de servicios/productos`
    } else {
      nota = `catálogo no disponible (${r?.error ?? 'sin credenciales'}): solo rutas fijas`
    }
  }
  writeFileSync(join(salida, 'sitemap.xml'), xmlSitemap(sitio, [...RUTAS_PUBLICAS, ...dinamicas]))
  return `robots.txt + sitemap.xml (${RUTAS_PUBLICAS.length} rutas fijas, ${nota}) para ${sitio}`
}
