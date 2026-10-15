import { supabase } from './supabase.js'
import { procesarImagen, tipoDeImagenValido, urlPublicaFoto } from './imagenes.js'
import { configuracionMedios, errorDeConfiguracionMedios, subirImagenR2 } from './medios.js'
import { MAX_FOTOS_LOGIN } from '../config/fotosLogin.js'

export const BUCKET_LOGIN = 'fotos-galeria'
const COLUMNAS = 'id, titulo, foto_url, orden, activo'
const REFERENCIA = /^r2:fotos-galeria\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function leerFotosLogin(soloActivas = false) {
  let consulta = supabase.from('login_web_fotos').select(COLUMNAS).order('orden').order('id')
  if (soloActivas) consulta = consulta.eq('activo', true)
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

export async function obtenerFotosLogin() {
  const fotos = await leerFotosLogin(true)
  return fotos.filter((f) => REFERENCIA.test(f.foto_url)).slice(0, MAX_FOTOS_LOGIN)
    .map((f) => ({ ...f, url: urlPublicaFoto(BUCKET_LOGIN, f.foto_url) })).filter((f) => f.url)
}

export async function prepararFotoLogin(archivo) {
  if (!tipoDeImagenValido(archivo)) throw new Error('Elige una imagen JPG, PNG o WebP.')
  if (archivo.size > 20 * 1024 * 1024) throw new Error('La foto no debe superar los 20 MB.')
  // Conserva más detalle que una miniatura y respeta los límites del Worker.
  for (const calidad of [0.84, 0.72, 0.6]) {
    const { blob } = await procesarImagen(archivo, { ladoMaximo: 1600, calidad })
    if (blob?.type !== 'image/webp') throw new Error('Este navegador no pudo convertir la foto a WebP.')
    if (blob.size <= 512 * 1024) return blob
  }
  const { blob } = await procesarImagen(archivo, { ladoMaximo: 1200, calidad: 0.6 })
  if (blob?.type !== 'image/webp' || blob.size > 512 * 1024) throw new Error('La foto tiene demasiado detalle. Prueba con otra imagen.')
  return blob
}

export async function subirFotoLogin(blob) {
  if (configuracionMedios().proveedor !== 'r2') throw new Error('Activa la configuración de R2 para subir fotos del login.')
  const falta = errorDeConfiguracionMedios()
  if (falta) throw new Error(falta)
  return subirImagenR2(BUCKET_LOGIN, blob)
}

export const filaLogin = (f, orden) => ({ id: f.id, titulo: f.titulo.trim(), foto_url: f.foto_url, orden, activo: f.activo })
const canonicas = (fotos) => [...fotos].sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id)).map((f) => filaLogin(f, f.orden))
const iguales = (a, b) => JSON.stringify(canonicas(a)) === JSON.stringify(canonicas(b))

export async function guardarFotosLogin(fotos, base) {
  if (fotos.length > MAX_FOTOS_LOGIN || fotos.some((f) => !REFERENCIA.test(f.foto_url))) throw new Error('Revisa las fotos antes de guardar.')
  const filas = fotos.map(filaLogin)
  const resultado = await supabase.rpc('guardar_login_web_fotos', { p_fotos: filas, p_base: base.map((f) => filaLogin(f, f.orden)) })
  if (!resultado.error && Array.isArray(resultado.data) && iguales(resultado.data, filas)) return resultado.data
  if (resultado.error?.code === '42501') throw new Error('Solo un administrador puede configurar el login.')
  // Una respuesta perdida no autoriza a borrar archivos ni a duplicar subidas.
  try {
    const actuales = await leerFotosLogin()
    if (iguales(actuales, filas)) return actuales
  } catch { /* Mantener el borrador y las referencias para reintentar. */ }
  throw new Error(resultado.error?.message || 'No se pudo confirmar el guardado. Conservamos el borrador; vuelve a intentarlo.')
}
