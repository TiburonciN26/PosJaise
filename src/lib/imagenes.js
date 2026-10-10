import { supabase } from './supabase.js'
import {
  ambientePideR2,
  eliminarImagenR2,
  errorDeConfiguracionMedios,
  esReferenciaR2,
  referenciaDeUrlR2,
  subidasNuevasEnR2,
  subirImagenR2,
  urlPublicaR2,
} from './medios.js'

const LADO_MAXIMO = 600
const CALIDAD_WEBP = 0.8
const TIPOS_ACEPTADOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

export function tipoDeImagenValido(archivo) {
  return TIPOS_ACEPTADOS.includes(archivo.type)
}

// Redimensiona (tope configurable, manteniendo proporción, sin agrandar) y
// recomprime a WebP en el navegador vía <canvas> — no hace falta ninguna
// librería de procesamiento de imágenes (sharp, etc. son de Node, no
// corren en el cliente). Genérico: lo usan fotos de producto, perfil de
// usuario/cliente y servicio, cada una con su propio tope de tamaño (ver
// llamadas) — 600px/0.8 sigue siendo el default para las que no lo pasan.
export async function procesarImagen(archivo, { ladoMaximo = LADO_MAXIMO, calidad = CALIDAD_WEBP } = {}) {
  const bitmap = await createImageBitmap(archivo)

  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height))
  const ancho = Math.round(bitmap.width * escala)
  const alto = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const contexto = canvas.getContext('2d')
  contexto.drawImage(bitmap, 0, 0, ancho, alto)
  bitmap.close?.()

  const blobWebp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', calidad))

  // Algún navegador puede no soportar codificar WebP en canvas: toBlob resuelve
  // null o, peor, un PNG (otro tipo) aunque se pidió WebP. Se comprueba el TIPO
  // REAL del blob, no solo que exista: la extensión nunca debe mentir sobre el
  // contenido. Si no es WebP caemos a JPEG en vez de fallar.
  if (blobWebp && blobWebp.type === 'image/webp') return { blob: blobWebp, extension: 'webp' }

  const blobJpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
  return { blob: blobJpeg, extension: 'jpg' }
}

// bucket + ruta los decide el llamador — productos sube a la raíz del
// bucket "fotos-productos" (solo admin puede escribir ahí, ver
// 42_storage_fotos_productos.sql); perfil de usuario sube a
// "fotos-usuarios/{uid}/archivo.webp" (cada quien solo puede escribir en
// su propia carpeta, ver 46_foto_perfil_usuario.sql).
//
// Fase 3: si el ambiente pide R2 y el bucket es público (productos, servicios,
// galería), la subida va al Worker autenticado, `ruta` se ignora (el servidor
// decide la clave) y el valor devuelto es la referencia "r2:<destino>/<id>",
// que los llamadores guardan en foto_url igual que antes guardaban la ruta.
export async function subirFoto(bucket, ruta, blob, opciones) {
  if (ambientePideR2(bucket)) {
    const faltante = errorDeConfiguracionMedios()
    if (faltante) throw new Error(faltante) // no caer a Supabase en silencio
    if (subidasNuevasEnR2(bucket, blob)) return subirImagenR2(bucket, blob, opciones)
    console.warn(`Imagen ${blob.type || 'sin tipo'}: R2 solo admite WebP; esta subida usa Supabase Storage.`)
  }

  const { error } = await supabase.storage.from(bucket).upload(ruta, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
  })

  if (error) throw error
  return ruta
}

export async function eliminarFoto(bucket, ruta) {
  if (!ruta) return
  if (esReferenciaR2(ruta)) return eliminarImagenR2(ruta)
  await supabase.storage.from(bucket).remove([ruta])
}

// `variante`: "g" (detalle, por defecto) o "m" (miniatura 320 px); solo
// aplica a referencias R2. Las fotos antiguas de Supabase no tienen variantes.
export function urlPublicaFoto(bucket, ruta, variante = 'g') {
  if (!ruta) return null
  if (esReferenciaR2(ruta)) return urlPublicaR2(ruta, variante)
  return supabase.storage.from(bucket).getPublicUrl(ruta).data.publicUrl
}

// galeria_web.antes_url/despues_url guardan la URL YA RESUELTA (ver
// 98_galeria_web.sql), a diferencia del resto de fotos del proyecto: puede
// ser una URL completa de Storage (foto real subida por el admin) o una
// ruta relativa a /public (la fila de prueba con fotos de referencia,
// reusada por NosotrosCliente.jsx e InicioCliente.jsx).
export function resolverUrlGaleria(url) {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`
}

// Ruta/referencia a eliminar a partir de la URL completa que guarda la galería:
// "r2:..." si es de nuestro dominio de medios, la ruta dentro del bucket si es
// una URL de Supabase Storage, y null si no es ninguna (p. ej. fotos de /public).
export function rutaDeUrlGaleria(bucket, url) {
  const referenciaR2 = referenciaDeUrlR2(url)
  if (referenciaR2) return referenciaR2
  const marcador = `/${bucket}/`
  const indice = url?.indexOf(marcador) ?? -1
  return indice === -1 ? null : url.slice(indice + marcador.length)
}

// Para buckets PRIVADOS (ej. comprobantes-pedidos-web) — getPublicUrl no
// sirve ahí, el archivo nunca es accesible sin firmar la URL. `segundos`
// por default alcanza para que el admin la abra desde el panel sin que
// la URL quede viva innecesariamente mucho tiempo después.
export async function urlFirmadaFoto(bucket, ruta, segundos = 300) {
  if (!ruta) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, segundos)
  if (error) throw error
  return data.signedUrl
}
