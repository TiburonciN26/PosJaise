import { supabase } from './supabase.js'

const LADO_MAXIMO = 600
const CALIDAD_WEBP = 0.8
const TIPOS_ACEPTADOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

export function tipoDeImagenValido(archivo) {
  return TIPOS_ACEPTADOS.includes(archivo.type)
}

// Redimensiona (tope 600x600 manteniendo proporción, sin agrandar) y
// recomprime a WebP en el navegador vía <canvas> — no hace falta ninguna
// librería de procesamiento de imágenes (sharp, etc. son de Node, no
// corren en el cliente). Genérico: lo usan tanto fotos de producto como
// de perfil de usuario, mismas reglas para las dos.
export async function procesarImagen(archivo) {
  const bitmap = await createImageBitmap(archivo)

  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
  const ancho = Math.round(bitmap.width * escala)
  const alto = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const contexto = canvas.getContext('2d')
  contexto.drawImage(bitmap, 0, 0, ancho, alto)
  bitmap.close?.()

  const blobWebp = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', CALIDAD_WEBP),
  )

  // Algún navegador viejo puede no soportar codificar WebP en canvas
  // (toBlob resuelve null) — en ese caso caemos a JPEG en vez de fallar.
  if (blobWebp) return { blob: blobWebp, extension: 'webp' }

  const blobJpeg = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', CALIDAD_WEBP),
  )
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
