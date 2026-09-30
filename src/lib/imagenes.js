import { supabase } from './supabase.js'

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

  // Algún navegador viejo puede no soportar codificar WebP en canvas
  // (toBlob resuelve null) — en ese caso caemos a JPEG en vez de fallar.
  if (blobWebp) return { blob: blobWebp, extension: 'webp' }

  const blobJpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
  return { blob: blobJpeg, extension: 'jpg' }
}

// bucket + ruta los decide el llamador — productos sube a la raíz del
// bucket "fotos-productos" (solo admin puede escribir ahí, ver
// 42_storage_fotos_productos.sql); perfil de usuario sube a
// "fotos-usuarios/{uid}/archivo.webp" (cada quien solo puede escribir en
// su propia carpeta, ver 46_foto_perfil_usuario.sql).
export async function subirFoto(bucket, ruta, blob) {
  const { error } = await supabase.storage.from(bucket).upload(ruta, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
  })

  if (error) throw error
  return ruta
}

export async function eliminarFoto(bucket, ruta) {
  if (!ruta) return
  await supabase.storage.from(bucket).remove([ruta])
}

export function urlPublicaFoto(bucket, ruta) {
  if (!ruta) return null
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
