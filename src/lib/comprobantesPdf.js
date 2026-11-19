// PDF oficial de una boleta/factura (el que devuelve la contadora) y su envío por WhatsApp.
//
// El PDF vive en el bucket privado `comprobantes-emitidos` (solo la administradora lo lee o escribe; solo PDF, máx. 5 MB:
// migración 20261118000004). Se sube primero a Storage y después se guarda su ruta en la venta con
// adjuntar_pdf_comprobante(); el PDF anterior se borra al final, para no dejar archivos huérfanos si algo falla a medias.
import { supabase } from './supabase.js'
import { nombreComprobante } from './comprobante.js'

export const BUCKET_COMPROBANTES_EMITIDOS = 'comprobantes-emitidos'
export const TAMANO_MAXIMO_PDF = 5 * 1024 * 1024

// El enlace de WhatsApp dura 30 días: la persona puede abrirlo cuando le llegue.
const SEGUNDOS_ENLACE_WHATSAPP = 60 * 60 * 24 * 30

export function pdfValido(archivo) {
  if (!archivo) return 'Elige un archivo PDF.'
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name)
  if (!esPdf) return 'El archivo debe ser un PDF.'
  if (archivo.size > TAMANO_MAXIMO_PDF) return 'El PDF pesa más de 5 MB.'
  return null
}

// Sube el PDF y lo deja asociado a la venta. Devuelve { error } (texto) o {} si salió bien.
export async function adjuntarPdfComprobante(ventaId, archivo) {
  const mensaje = pdfValido(archivo)
  if (mensaje) return { error: mensaje }

  const ruta = `${ventaId}/${Date.now()}.pdf`
  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_COMPROBANTES_EMITIDOS)
    .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
  if (errorSubida) return { error: 'No se pudo subir el PDF.' }

  const { data: rutaAnterior, error: errorRpc } = await supabase.rpc('adjuntar_pdf_comprobante', {
    p_venta_id: ventaId,
    p_ruta: ruta,
  })
  if (errorRpc) {
    // La venta no quedó apuntando al archivo nuevo: se borra para no dejarlo huérfano.
    await supabase.storage.from(BUCKET_COMPROBANTES_EMITIDOS).remove([ruta])
    return { error: errorRpc.message }
  }

  if (rutaAnterior) await supabase.storage.from(BUCKET_COMPROBANTES_EMITIDOS).remove([rutaAnterior])
  return {}
}

export async function urlFirmadaPdf(ruta, segundos = 300) {
  const { data, error } = await supabase.storage.from(BUCKET_COMPROBANTES_EMITIDOS).createSignedUrl(ruta, segundos)
  if (error || !data?.signedUrl) throw error ?? new Error('Sin enlace')
  return data.signedUrl
}

// https://wa.me/51987654321?text=… — abre el chat con el comprador y el mensaje ya escrito. wa.me no permite adjuntar el
// archivo, por eso el mensaje lleva un enlace firmado al PDF.
export function enlaceWhatsApp({ celular, tipo, numeroLegal, nombre, url }) {
  const primerNombre = (nombre ?? '').trim().split(/\s+/)[0]
  const saludo = primerNombre ? `Hola ${primerNombre},` : 'Hola,'
  const documento = `${nombreComprobante(tipo).toLowerCase()} electrónica${numeroLegal ? ` ${numeroLegal}` : ''}`
  const texto = `${saludo} te enviamos tu ${documento} de Pos Jaise Beauty Academy. Puedes verla o descargarla aquí: ${url}\n\n¡Gracias por tu compra!`
  return `https://wa.me/51${celular}?text=${encodeURIComponent(texto)}`
}

// Abre WhatsApp con el PDF de la venta. La ventana se abre ANTES de pedir el enlace firmado (el navegador bloquea las que
// se abren tras una espera) y después se redirige. Devuelve true si salió bien.
export async function enviarPdfPorWhatsApp({ rutaPdf, celular, tipo, numeroLegal, nombre }) {
  const ventana = window.open('about:blank', '_blank')
  try {
    const url = await urlFirmadaPdf(rutaPdf, SEGUNDOS_ENLACE_WHATSAPP)
    const enlace = enlaceWhatsApp({ celular, tipo, numeroLegal, nombre, url })
    if (ventana) ventana.location.href = enlace
    else window.location.assign(enlace)
    return true
  } catch {
    ventana?.close()
    return false
  }
}

// Abre el PDF en otra pestaña (enlace de 5 minutos).
export async function verPdfComprobante(rutaPdf) {
  const ventana = window.open('about:blank', '_blank')
  try {
    const url = await urlFirmadaPdf(rutaPdf, 300)
    if (ventana) ventana.location.href = url
    else window.location.assign(url)
    return true
  } catch {
    ventana?.close()
    return false
  }
}
