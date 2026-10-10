// Worker autenticado de medios públicos (Fase 3).
//
// Decisión: Worker con binding R2 (no URL prefirmada). Los bytes pasan por
// aquí, así que se valida identidad, permiso, tamaño real y contenido ANTES
// de escribir nada en el bucket; no hace falta área de staging. Las
// imágenes ya llegan procesadas por el navegador (WebP ≤ 1400 px), por lo
// que el tope por petición es pequeño y el Worker no se bloquea.
//
// - La clave del objeto la decide el servidor a partir de destino/id/variante
//   validados; el cliente no envía rutas.
// - Escritura "solo crear": un objeto existente no se puede sobrescribir
//   (reemplazar = id nuevo), así que nadie pisa una foto ajena y la caché
//   larga/immutable es segura.
// - Autorización: sesión Supabase vigente (GET /auth/v1/user) + RPC
//   `es_admin()` ejecutada CON el token del usuario, la misma función que
//   usan las políticas RLS de los buckets actuales. El rol que diga el
//   navegador no se lee.
// - No hay credenciales R2 ni service_role: solo el binding y la anon key
//   pública de Supabase.

import { inspeccionarWebp } from './validar-imagen.js'

const DESTINOS = new Set(['fotos-productos', 'fotos-servicios', 'fotos-galeria'])
const VARIANTES = {
  // lado máximo permitido y tope duro de bytes (los objetivos de la guía son
  // 80 KiB / 250 KiB; el tope duro deja margen para no rechazar fotos válidas)
  m: { ladoMax: 400, bytesMax: 96 * 1024 },
  g: { ladoMax: 1600, bytesMax: 512 * 1024 },
}
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CACHE_INMUTABLE = 'public, max-age=31536000, immutable'

function origenesPermitidos(env) {
  return (env.ORIGENES_PERMITIDOS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
}

function cabecerasCors(request, env) {
  const origen = request.headers.get('Origin')
  const cabeceras = { Vary: 'Origin' }
  if (origen && origenesPermitidos(env).includes(origen)) {
    cabeceras['Access-Control-Allow-Origin'] = origen
    cabeceras['Access-Control-Allow-Methods'] = 'PUT, DELETE, GET, OPTIONS'
    cabeceras['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
    cabeceras['Access-Control-Max-Age'] = '600'
  }
  return cabeceras
}

function responder(request, env, estado, cuerpo, extra = {}) {
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cabecerasCors(request, env),
      ...extra,
    },
  })
}

// Devuelve { uid } si la sesión es válida y es admin; si no, { estado, error }.
async function autorizarAdmin(request, env) {
  const cabecera = request.headers.get('Authorization') ?? ''
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : ''
  if (!token) return { estado: 401, error: 'sin-sesion' }

  const base = env.SUPABASE_URL
  const cabecerasSupabase = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }

  let respuestaUsuario
  try {
    respuestaUsuario = await fetch(`${base}/auth/v1/user`, { headers: cabecerasSupabase })
  } catch {
    return { estado: 503, error: 'auth-no-disponible' }
  }
  if (respuestaUsuario.status === 401 || respuestaUsuario.status === 403) return { estado: 401, error: 'sesion-invalida' }
  if (!respuestaUsuario.ok) return { estado: 503, error: 'auth-no-disponible' }
  const usuario = await respuestaUsuario.json()
  if (!usuario?.id) return { estado: 401, error: 'sesion-invalida' }

  let respuestaRol
  try {
    respuestaRol = await fetch(`${base}/rest/v1/rpc/es_admin`, {
      method: 'POST',
      headers: { ...cabecerasSupabase, 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    return { estado: 503, error: 'auth-no-disponible' }
  }
  if (!respuestaRol.ok) return { estado: 503, error: 'auth-no-disponible' }
  if ((await respuestaRol.json()) !== true) return { estado: 403, error: 'sin-permiso' }

  return { uid: usuario.id }
}

// Lee el cuerpo con tope duro: corta en cuanto se supera, sin acumular de más.
async function leerConTope(request, maximo) {
  const declarado = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declarado) && declarado > maximo) return { error: 'demasiado-grande' }
  if (!request.body) return { error: 'cuerpo-vacio' }

  const lector = request.body.getReader()
  const trozos = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.length
    if (total > maximo) {
      await lector.cancel()
      return { error: 'demasiado-grande' }
    }
    trozos.push(value)
  }
  if (total === 0) return { error: 'cuerpo-vacio' }

  const bytes = new Uint8Array(total)
  let posicion = 0
  for (const trozo of trozos) {
    bytes.set(trozo, posicion)
    posicion += trozo.length
  }
  return { bytes }
}

async function subir(request, env, destino, id, variante) {
  const reglas = VARIANTES[variante]
  const maxBytes = Math.min(reglas.bytesMax, Number(env.MAX_BYTES_POR_OBJETO) || reglas.bytesMax)

  const autorizacion = await autorizarAdmin(request, env)
  if (!autorizacion.uid) return responder(request, env, autorizacion.estado, { error: autorizacion.error })

  const lectura = await leerConTope(request, maxBytes)
  if (lectura.error) {
    return responder(request, env, lectura.error === 'demasiado-grande' ? 413 : 400, { error: lectura.error })
  }

  const inspeccion = inspeccionarWebp(lectura.bytes)
  if (!inspeccion.ok) return responder(request, env, 415, { error: inspeccion.motivo })
  if (Math.max(inspeccion.ancho, inspeccion.alto) > reglas.ladoMax) {
    return responder(request, env, 422, { error: 'dimensiones-excesivas-para-variante' })
  }

  const clave = `${destino}/${id}/${variante}.webp`
  const guardado = await env.MEDIOS.put(clave, lectura.bytes, {
    onlyIf: { etagDoesNotMatch: '*' }, // crear solo si no existe
    httpMetadata: { contentType: 'image/webp', cacheControl: CACHE_INMUTABLE },
    customMetadata: { subidoPor: autorizacion.uid, subidoEn: new Date().toISOString() },
  })
  const resumen = {
    ok: true,
    ref: `r2:${destino}/${id}`,
    clave,
    bytes: lectura.bytes.length,
    ancho: inspeccion.ancho,
    alto: inspeccion.alto,
  }
  if (guardado !== null) return responder(request, env, 201, resumen)

  // La clave ya existe. Si es la MISMA operación repetida (misma persona y
  // exactamente los mismos bytes), p. ej. porque se perdió la respuesta de una
  // escritura que sí terminó, se responde 200 sin escribir nada: es seguro
  // reintentar. Cualquier otro caso (otro usuario o contenido distinto) sigue
  // siendo 409; nunca se sobrescribe.
  const existente = await env.MEDIOS.get(clave)
  if (existente && existente.customMetadata?.subidoPor === autorizacion.uid) {
    const guardados = new Uint8Array(await existente.arrayBuffer())
    if (iguales(guardados, lectura.bytes)) return responder(request, env, 200, { ...resumen, reanudado: true })
  }
  return responder(request, env, 409, { error: 'ya-existe' })
}

function iguales(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

// Inventario de solo lectura para el recolector de huérfanos (scripts/medios-huerfanos.mjs).
// Paginado; solo admin. No expone nada que no sea público, pero enumerar el
// bucket no hace falta para el público, por eso exige sesión.
async function inventario(request, env, destino, url) {
  const autorizacion = await autorizarAdmin(request, env)
  if (!autorizacion.uid) return responder(request, env, autorizacion.estado, { error: autorizacion.error })

  const lista = await env.MEDIOS.list({
    prefix: `${destino}/`,
    cursor: url.searchParams.get('cursor') || undefined,
    limit: 500,
    include: ['customMetadata'],
  })
  return responder(request, env, 200, {
    objetos: lista.objects.map((o) => ({
      clave: o.key,
      bytes: o.size,
      subidoEn: o.customMetadata?.subidoEn ?? o.uploaded?.toISOString?.() ?? null,
      subidoPor: o.customMetadata?.subidoPor ?? null,
    })),
    cursor: lista.truncated ? lista.cursor : null,
  })
}

async function eliminar(request, env, destino, id) {
  const autorizacion = await autorizarAdmin(request, env)
  if (!autorizacion.uid) return responder(request, env, autorizacion.estado, { error: autorizacion.error })

  const claves = Object.keys(VARIANTES).map((v) => `${destino}/${id}/${v}.webp`)
  await env.MEDIOS.delete(claves) // idempotente: borrar algo ausente no es error
  return responder(request, env, 200, { ok: true, eliminados: claves })
}

// Lectura SOLO para desarrollo/pruebas (SERVIR_LECTURA=1). En producción el
// bucket público se publica con un dominio propio de medios y la caché de
// Cloudflare; este Worker no sirve imágenes.
async function servirLectura(request, env, clave) {
  const objeto = await env.MEDIOS.get(clave)
  if (!objeto) return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const cabeceras = new Headers({
    'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': objeto.httpMetadata?.cacheControl ?? 'no-store',
    ETag: objeto.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  if (request.headers.get('If-None-Match') === objeto.httpEtag) {
    return new Response(null, { status: 304, headers: cabeceras })
  }
  return new Response(objeto.body, { status: 200, headers: cabeceras })
}

export default {
  async fetch(request, env) {
    const origen = request.headers.get('Origin')
    if (origen && !origenesPermitidos(env).includes(origen)) {
      return responder(request, env, 403, { error: 'origen-no-permitido' })
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cabecerasCors(request, env) })
    }

    const partes = new URL(request.url).pathname.split('/').filter(Boolean)

    // PUT /v1/medios/{destino}/{id}/{variante}
    if (request.method === 'PUT' && partes.length === 5 && partes[0] === 'v1' && partes[1] === 'medios') {
      const [, , destino, id, variante] = partes
      if (!DESTINOS.has(destino) || !RE_ID.test(id) || !VARIANTES[variante]) {
        return responder(request, env, 400, { error: 'ruta-invalida' })
      }
      return subir(request, env, destino, id, variante)
    }

    // DELETE /v1/medios/{destino}/{id}
    if (request.method === 'DELETE' && partes.length === 4 && partes[0] === 'v1' && partes[1] === 'medios') {
      const [, , destino, id] = partes
      if (!DESTINOS.has(destino) || !RE_ID.test(id)) return responder(request, env, 400, { error: 'ruta-invalida' })
      return eliminar(request, env, destino, id)
    }

    // GET /v1/inventario/{destino}?cursor=...
    if (request.method === 'GET' && partes.length === 3 && partes[0] === 'v1' && partes[1] === 'inventario') {
      if (!DESTINOS.has(partes[2])) return responder(request, env, 400, { error: 'ruta-invalida' })
      return inventario(request, env, partes[2], new URL(request.url))
    }

    // GET /{destino}/{id}/{variante}.webp  (solo desarrollo)
    if (request.method === 'GET' && env.SERVIR_LECTURA === '1' && partes.length === 3) {
      const [destino, id, archivo] = partes
      if (DESTINOS.has(destino) && RE_ID.test(id) && /^[mg]\.webp$/.test(archivo)) {
        return servirLectura(request, env, `${destino}/${id}/${archivo}`)
      }
    }

    return responder(request, env, 404, { error: 'no-encontrado' })
  },
}
