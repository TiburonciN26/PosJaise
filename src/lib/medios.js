// Medios públicos nuevos en Cloudflare R2 (Fase 3).
//
// Contrato de referencia (se guarda en las MISMAS columnas `foto_url`, que
// son `text` libre, sin cambio de esquema):
//   - "r2:<destino>/<id>"  → objeto en R2: <destino>/<id>/m.webp (320 px) y
//                            <destino>/<id>/g.webp (tamaño de detalle).
//   - cualquier otro valor → comportamiento de siempre (Supabase Storage /
//                            URL completa de galería / ruta relativa).
// La AUSENCIA del prefijo nunca se interpreta como R2: las fotos antiguas
// siguen resolviéndose en Supabase aunque este módulo esté activo.
//
// Selección de proveedor para SUBIDAS NUEVAS, por ambiente (build):
//   VITE_MEDIOS_PROVEEDOR = "r2" | (vacío/otro = "supabase", por defecto)
//   VITE_MEDIOS_API_URL   = URL del Worker autenticado
//   VITE_MEDIOS_PUBLIC_URL= dominio público de medios (lectura/caché)
// Para revertir las subidas nuevas basta con quitar VITE_MEDIOS_PROVEEDOR y
// reconstruir; las referencias "r2:" ya guardadas siguen leyéndose.
//
// Aquí no hay credenciales de R2 ni SDK S3: solo `fetch` al Worker con el
// token de sesión de Supabase.
import { supabase } from './supabase.js'
import { basesReconocidas, normalizarBase, referenciaDeUrl, DESTINOS_R2 as DESTINOS_URL } from './urlsMedios.js'

export const PREFIJO_R2 = 'r2:'
export const DESTINOS_R2 = DESTINOS_URL

const LADO_MINIATURA = 320
const CALIDAD_MINIATURA = 0.8
const INTENTOS = 3

const quitarBarraFinal = (valor) => (valor ?? '').trim().replace(/\/+$/, '')

export function configuracionMedios() {
  return {
    proveedor: import.meta.env.VITE_MEDIOS_PROVEEDOR === 'r2' ? 'r2' : 'supabase',
    apiUrl: quitarBarraFinal(import.meta.env.VITE_MEDIOS_API_URL),
    publicUrl: quitarBarraFinal(import.meta.env.VITE_MEDIOS_PUBLIC_URL),
  }
}

export const esReferenciaR2 = (valor) => typeof valor === 'string' && valor.startsWith(PREFIJO_R2)

// ¿El ambiente pide R2 para este destino? (independiente de que esté bien configurado)
export function ambientePideR2(bucket) {
  return configuracionMedios().proveedor === 'r2' && DESTINOS_R2.includes(bucket)
}

// null si la configuración R2 está completa; si no, el mensaje para el operador.
// `subirFoto` FALLA con este mensaje en vez de caer a Supabase en silencio:
// quien configura VITE_MEDIOS_PROVEEDOR=r2 debe enterarse de que falta algo.
export function errorDeConfiguracionMedios() {
  const { apiUrl, publicUrl } = configuracionMedios()
  const faltan = [!apiUrl && 'VITE_MEDIOS_API_URL', !publicUrl && 'VITE_MEDIOS_PUBLIC_URL'].filter(Boolean)
  if (faltan.length) return `Medios R2 mal configurados: falta ${faltan.join(' y ')}.`
  // La URL pública debe ser ABSOLUTA (https; http solo en localhost): una relativa quedaría ambigua en Galería.
  if (!normalizarBase(publicUrl)) return 'Medios R2 mal configurados: VITE_MEDIOS_PUBLIC_URL debe ser una URL absoluta https.'
  return null
}

// Las subidas nuevas van a R2 solo si el ambiente lo pide, está completamente
// configurado, el destino es un bucket público de catálogo/galería y la imagen
// es WebP (el único formato que acepta el Worker). Una imagen que el navegador
// no pudo codificar como WebP (fallback JPEG de `procesarImagen`) sigue yendo a
// Supabase, que acepta cualquier formato, con una advertencia en consola.
export function subidasNuevasEnR2(bucket, blob) {
  if (!ambientePideR2(bucket) || errorDeConfiguracionMedios()) return false
  return blob === undefined ? true : blob.type === 'image/webp'
}

// "r2:fotos-productos/<id>" → URL pública de la variante. Sin dominio
// configurado devuelve null (nunca redirige a Supabase en silencio).
export function urlPublicaR2(referencia, variante = 'g') {
  if (!esReferenciaR2(referencia)) return null
  const { publicUrl } = configuracionMedios()
  if (!publicUrl) return null
  return `${publicUrl}/${referencia.slice(PREFIJO_R2.length)}/${variante}.webp`
}

// Galería guarda la URL completa. Si esa URL es de nuestros medios devuelve la referencia "r2:..." (para
// poder administrarla/eliminarla); si no, null. Reconoce la base configurada Y las aprobadas en
// VITE_MEDIOS_BASES_RECONOCIDAS (lista cerrada, separada por comas) para convivir durante una transición de
// entrega (r2.dev ↔ Pages /medios); valida origen, prefijo, destino, UUID y variante (ver urlsMedios.js).
export const basesDeMedios = () => basesReconocidas(configuracionMedios().publicUrl, import.meta.env.VITE_MEDIOS_BASES_RECONOCIDAS)
export const referenciaDeUrlR2 = (url) => referenciaDeUrl(url, basesDeMedios())

async function tokenDeSesion() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sin sesión para subir la imagen.')
  return token
}

// Reintenta solo fallos transitorios (red / 5xx / 429). Un 4xx de validación
// (401, 403, 409, 413, 415, 422) no se reintenta: repetirlo no lo arregla.
async function llamar(url, opciones, onProgreso) {
  let ultimo
  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    try {
      const respuesta = await fetch(url, opciones)
      if (respuesta.ok) return respuesta
      const cuerpo = await respuesta.json().catch(() => ({}))
      ultimo = Object.assign(new Error(cuerpo.error ?? `HTTP ${respuesta.status}`), { estado: respuesta.status })
      if (respuesta.status < 500 && respuesta.status !== 429) throw ultimo
    } catch (error) {
      if (error.estado && error.estado < 500 && error.estado !== 429) throw error
      ultimo = error
    }
    if (intento < INTENTOS) {
      onProgreso?.({ fase: 'reintentando', intento })
      await new Promise((resolver) => setTimeout(resolver, 400 * intento))
    }
  }
  throw ultimo
}

async function miniaturaDe(blob) {
  const bitmap = await createImageBitmap(blob)
  const escala = Math.min(1, LADO_MINIATURA / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * escala))
  canvas.height = Math.max(1, Math.round(bitmap.height * escala))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const miniatura = await new Promise((resolver) => canvas.toBlob(resolver, 'image/webp', CALIDAD_MINIATURA))
  if (!miniatura || miniatura.type !== 'image/webp') throw new Error('El navegador no puede generar WebP.')
  return miniatura
}

// Sube las dos variantes y devuelve la referencia "r2:<destino>/<id>".
// La clave la decide el Worker a partir de destino/id validados; el id es
// nuevo en cada subida (reemplazar = id nuevo, nunca se pisa un objeto).
// Si algo falla a medias se intenta limpiar y se propaga el error: la
// referencia solo se devuelve cuando AMBAS variantes quedaron guardadas.
// Reintentar con el mismo id es seguro: si una escritura terminó pero se perdió
// la respuesta, el Worker contesta 200 (misma persona, mismos bytes) en vez de 409.
export async function subirImagenR2(destino, blob, { onProgreso } = {}) {
  if (!DESTINOS_R2.includes(destino)) throw new Error('Destino de medios no permitido.')
  if (blob.type !== 'image/webp') throw new Error('Solo se admite WebP en R2.')

  const { apiUrl } = configuracionMedios()
  const token = await tokenDeSesion()
  reintentarEliminacionesPendientes() // oportunista: sin esperar ni bloquear la subida
  const id = crypto.randomUUID()
  const base = `${apiUrl}/v1/medios/${destino}/${id}`
  const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp' }

  onProgreso?.({ fase: 'preparando' })
  const miniatura = await miniaturaDe(blob)

  try {
    onProgreso?.({ fase: 'subiendo', variante: 'm' })
    await llamar(`${base}/m`, { method: 'PUT', headers: cabeceras, body: miniatura }, onProgreso)
    onProgreso?.({ fase: 'subiendo', variante: 'g' })
    await llamar(`${base}/g`, { method: 'PUT', headers: cabeceras, body: blob }, onProgreso)
  } catch (error) {
    // 409 = la clave ya existía con contenido ajeno/distinto: ese objeto NO lo
    // creó esta operación, así que no se borra. Para cualquier otro fallo se
    // limpia lo que esta operación haya podido dejar a medias.
    if (error.estado !== 409) await eliminarImagenR2(`${PREFIJO_R2}${destino}/${id}`).catch(() => {})
    throw error
  }

  onProgreso?.({ fase: 'listo' })
  return `${PREFIJO_R2}${destino}/${id}`
}

// --- Borrados pendientes -------------------------------------------------------
// A diferencia del helper de Supabase (que ignora el error), un borrado fallido
// aquí NO se pierde: queda en un diario local (este navegador) y se reintenta
// de forma oportunista (al subir otra imagen o al borrar con éxito). Lo que el
// diario no alcance (otro dispositivo, caché del navegador borrada) lo cubre el
// recolector de huérfanos con retención (scripts/medios-huerfanos.mjs).
const CLAVE_DIARIO = 'medios:eliminaciones-pendientes'
const MAX_REINTENTOS_POR_PASADA = 5
let reintentando = false

function leerDiario() {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_DIARIO) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter((e) => esReferenciaR2(e?.ref)) : []
  } catch {
    return []
  }
}

function escribirDiario(entradas) {
  try {
    localStorage.setItem(CLAVE_DIARIO, JSON.stringify(entradas))
  } catch {
    // sin almacenamiento disponible: queda el recolector de huérfanos
  }
}

export function eliminacionesPendientes() {
  return leerDiario()
}

function anotarPendiente(referencia, error) {
  const entradas = leerDiario()
  const previa = entradas.find((e) => e.ref === referencia)
  if (previa) {
    previa.intentos = (previa.intentos ?? 1) + 1
    previa.ultimoError = String(error?.message ?? error).slice(0, 120)
  } else {
    entradas.push({ ref: referencia, desde: new Date().toISOString(), intentos: 1, ultimoError: String(error?.message ?? error).slice(0, 120) })
  }
  escribirDiario(entradas)
}

async function borrarEnWorker(referencia) {
  const { apiUrl } = configuracionMedios()
  if (!apiUrl) throw new Error('Sin VITE_MEDIOS_API_URL')
  const token = await tokenDeSesion()
  await llamar(`${apiUrl}/v1/medios/${referencia.slice(PREFIJO_R2.length)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function reintentarEliminacionesPendientes() {
  if (reintentando) return 0
  reintentando = true
  let eliminadas = 0
  try {
    for (const entrada of leerDiario().slice(0, MAX_REINTENTOS_POR_PASADA)) {
      try {
        await borrarEnWorker(entrada.ref)
        escribirDiario(leerDiario().filter((e) => e.ref !== entrada.ref))
        eliminadas += 1
      } catch (error) {
        anotarPendiente(entrada.ref, error)
      }
    }
  } finally {
    reintentando = false
  }
  return eliminadas
}

// Devuelve true si el borrado se confirmó, false si no (queda anotado y se
// reintenta). El llamador puede ignorar el resultado sin perder la garantía.
export async function eliminarImagenR2(referencia) {
  if (!esReferenciaR2(referencia)) return false
  try {
    await borrarEnWorker(referencia)
    escribirDiario(leerDiario().filter((e) => e.ref !== referencia))
    return true
  } catch (error) {
    console.error('No se pudo eliminar la imagen en R2; queda pendiente', referencia, error)
    anotarPendiente(referencia, error)
    return false
  }
}
