// Entrega pública de medios por Pages Functions (Fase 3, alternativa sin dominio propio). SOLO LECTURA.
// Diseño: docs/evidencia-rendimiento/fase-3/DISENO-MEDIOS-PAGES-FUNCTIONS.md (v2, aprobado por Codex).
//
// La lógica vive aquí (sin imports de Cloudflare) para probarla en Node con R2 y Cache simulados;
// functions/medios/[[ruta]].js y functions/medios.js son envoltorios finos. Las subidas/borrados NO pasan por
// aquí: siguen en el Worker autenticado. El binding `MEDIOS` solo se usa con `get`/`head`.
//
// Contrato (todas las respuestas, también 304, HEAD y errores, llevan nosniff y noindex: `_headers` NO se
// aplica a respuestas de una Function):
//  · Solo GET y HEAD (otro método → 405 con Allow).
//  · Ruta EXACTA /medios/<destino>/<uuid>/<m|g>.webp con destino en la lista cerrada; todo lo demás → 404 no-store.
//  · Clave de caché = GET canónico sin query. Range se ignora (200 completo). HEAD nunca guarda una respuesta vacía.
//  · ETag = httpEtag de R2; If-None-Match (coincidente, lista, `*`, débil) → 304 tanto en MISS como en HIT.
//  · Dos políticas (diseño de retirada: DISENO-CONTRATO-RETIRADA-MEDIOS.md, opción A):
//      - copia ALMACENADA en el borde: `public, max-age=TTL_POSITIVO` (sustituye al `immutable` de un año de R2);
//      - respuesta al NAVEGADOR: `public, max-age=0, must-revalidate` + ETag → una copia caducada obliga a revalidar: con If-None-Match coincidente → 304 sin cuerpo; con ETag distinto o sin condicional → 200.
//    Errores: no-store (sin caché negativa).
//  · Opción B (REVOCAR_CON_R2, ACTIVA por defecto): en HIT y antes de un 304 se comprueba el objeto en R2; ausente → 404 y
//    la Function deja de ENTREGARLO (no borra copias de otros centros de datos ni del navegador).
//  · Fallo de binding ausente → 404; fallo de lectura de R2 → 503 sin detalles; fallo de la caché → se entrega igual.
//  · X-Medios-Cache: HIT|MISS es DIAGNÓSTICO propio (cf-cache-status no refleja la Cache API).

export const DESTINOS = ['fotos-productos', 'fotos-servicios', 'fotos-galeria']
export const TTL_POSITIVO = 300 // segundos; SOLO la copia del borde (Cache API respeta max-age). El navegador usa CACHE_NAVEGADOR. Valor de STAGING.
const RE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_RUTA = new RegExp(`^/medios/(${DESTINOS.join('|')})/(${RE_ID})/(m|g)\\.webp$`)

// Opción B (REQUISITO del proyecto, decisión del usuario 10-oct-2026: bloquear el enlace antiguo tras borrar). Activa por defecto;
// `revocar:false` por llamada solo existe para probar la opción A. CPU, latencia y cuota con B siguen SIN medirse.
export const REVOCAR_CON_R2 = true
const CACHE_NAVEGADOR = 'public, max-age=0, must-revalidate'

const COMUN = { 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' }
const CACHE_POSITIVO = `public, max-age=${TTL_POSITIVO}`

// HEAD recibe los mismos estados y cabeceras, pero nunca cuerpo (tampoco en errores).
const error = (estado, extra = {}, metodo = 'GET') =>
  new Response(metodo === 'HEAD' ? null : estado === 405 ? 'Método no permitido' : estado === 503 ? 'No disponible' : 'No encontrado', {
    status: estado,
    headers: { ...COMUN, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...extra },
  })

// ¿If-None-Match acepta este ETag? Comparación débil (RFC 9110): se ignora el prefijo W/.
function coincide(cabecera, etag) {
  if (!cabecera || !etag) return false
  if (cabecera.trim() === '*') return true
  const limpio = (v) => v.trim().replace(/^W\//, '')
  return cabecera.split(',').some((v) => limpio(v) === limpio(etag))
}

// `almacenada` = copia que se guarda en la Cache API (TTL del borde); si no, la respuesta que ve el navegador.
function cabecerasDe(etag, diagnostico, almacenada = false) {
  return {
    ...COMUN,
    'Content-Type': 'image/webp',
    'Cache-Control': almacenada ? CACHE_POSITIVO : CACHE_NAVEGADOR,
    ...(etag ? { ETag: etag } : {}),
    'X-Medios-Cache': diagnostico,
  }
}

function responder(request, cuerpo, etag, diagnostico) {
  const cabeceras = cabecerasDe(etag, diagnostico)
  if (coincide(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers: cabeceras })
  return new Response(request.method === 'HEAD' ? null : cuerpo, { status: 200, headers: cabeceras })
}

export async function manejarMedios(request, env, ctx, { cache, revocar = REVOCAR_CON_R2 } = {}) {
  const metodo = request.method
  if (metodo !== 'GET' && metodo !== 'HEAD') return error(405, { Allow: 'GET, HEAD' })
  const url = new URL(request.url)
  const m = RE_RUTA.exec(url.pathname)
  if (!m) return error(404, {}, metodo) // incluye /medios, /medios/, traversal, %xx, mayúsculas, doble extensión, etc.
  const clave = `${m[1]}/${m[2]}/${m[3]}.webp`
  if (!env?.MEDIOS || typeof env.MEDIOS.get !== 'function') return error(404, {}, metodo)

  // Clave canónica: GET, sin query, sin Range ni condicionales (para que `match` nunca devuelva 206/304).
  const llave = new Request(`${url.origin}${url.pathname}`, { method: 'GET' })

  try {
    const guardada = cache ? await cache.match(llave) : undefined
    if (guardada && guardada.status === 200) {
      if (!revocar) return responder(request, guardada.body, guardada.headers.get('ETag'), 'HIT')
      // Opción B: la copia solo se entrega si el objeto sigue en R2 con el mismo ETag.
      let actual
      try {
        actual = typeof env.MEDIOS.head === 'function' ? await env.MEDIOS.head(clave) : await env.MEDIOS.get(clave)
      } catch {
        return error(503, {}, metodo) // sin validar la retirada no se sirve la copia vieja
      }
      if (!actual) {
        try { await cache.delete(llave) } catch { /* auxiliar: solo este centro de datos */ }
        return error(404, {}, metodo)
      }
      if ((actual.httpEtag ?? null) === guardada.headers.get('ETag')) return responder(request, guardada.body, guardada.headers.get('ETag'), 'HIT')
      // ETag distinto: la copia está desfasada → se lee de nuevo y se reemplaza (camino MISS)
    }
  } catch {
    // un fallo de la caché no impide entregar la imagen desde R2
  }

  // HEAD solo necesita metadatos: `head` (si el binding lo ofrece) evita leer el cuerpo; sin `head` se usa `get`
  // pero NO se consume el cuerpo. Un fallo de lectura (metadatos o bytes) es un 503 controlado y nunca se cachea.
  let objeto
  try {
    objeto = metodo === 'HEAD' && typeof env.MEDIOS.head === 'function' ? await env.MEDIOS.head(clave) : await env.MEDIOS.get(clave)
  } catch {
    return error(503, {}, metodo)
  }
  if (!objeto) return error(404, {}, metodo)

  const etag = objeto.httpEtag ?? null
  if (metodo === 'HEAD') return responder(request, null, etag, 'MISS')

  let cuerpo
  try {
    cuerpo = await objeto.arrayBuffer()
  } catch {
    return error(503)
  }
  if (cache) {
    const copia = new Response(cuerpo, { status: 200, headers: cabecerasDe(etag, 'HIT', true) })
    const guardar = Promise.resolve()
      .then(() => cache.put(llave, copia))
      .catch(() => {})
    ctx?.waitUntil?.(guardar)
  }
  return responder(request, cuerpo, etag, 'MISS')
}
