// Reglas de los datos del comprobante (boleta / factura) al cobrar.
//
// Solo valida el FORMATO en el navegador (la base lo vuelve a validar en
// registrar_comprobante_venta). No hay consulta real de RUC/DNI ni emisión ante
// SUNAT: la contadora emite el comprobante legal con la lista que exporta Historial.

// El precio de venta ya incluye IGV (18 %).
export const TASA_IGV = 0.18

// Total con IGV -> { base (op. gravada), igv }, redondeados a céntimos y cuadrando con el total.
export function desglosarIGV(total) {
  const totalNumero = Number(total) || 0
  const base = Math.round((totalNumero / (1 + TASA_IGV)) * 100) / 100
  const igv = Math.round((totalNumero - base) * 100) / 100
  return { base, igv }
}

export const nombreComprobante = (tipo) => (tipo === 'FACTURA' ? 'Factura' : 'Boleta')

// Desde este total (con IGV) SUNAT exige identificar al comprador con DNI en la boleta.
export const UMBRAL_DNI_BOLETA = 700

export const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '')

export const dniValido = (texto) => /^\d{8}$/.test(texto)

// RUC: 11 dígitos, prefijo 10/15/17/20 y dígito verificador (módulo 11).
// En desarrollo (`npm run dev`) basta con 11 dígitos, para poder probar con
// números inventados; la versión de producción (`npm run build`) sí exige el
// RUC real. La base solo comprueba el formato de 11 dígitos en ambos casos.
export function rucValido(texto) {
  if (import.meta.env.DEV) return /^\d{11}$/.test(texto)
  if (!/^(10|15|17|20)\d{9}$/.test(texto)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(texto[i]), 0)
  const resto = 11 - (suma % 11)
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto
  return verificador === Number(texto[10])
}

// Desde el umbral la boleta pide documento Y nombre del comprador (nombre de la función por historia: antes solo DNI).
export const boletaRequiereDni = (total) => total >= UMBRAL_DNI_BOLETA

// Documentos con que una boleta identifica al comprador. La factura siempre es RUC.
export const TIPOS_DOCUMENTO_BOLETA = [
  { id: 'DNI', label: 'DNI' },
  { id: 'CE', label: 'Carné de extranjería' },
  { id: 'PASAPORTE', label: 'Pasaporte' },
]

const ETIQUETAS_DOCUMENTO = { DNI: 'DNI', RUC: 'RUC', CE: 'C. extranjería', PASAPORTE: 'Pasaporte' }
export const etiquetaDocumento = (tipoDocumento) => ETIQUETAS_DOCUMENTO[tipoDocumento] ?? 'Documento'

// CE y pasaporte: hasta 12 letras o números. DNI y RUC: solo dígitos.
export const esDocumentoAlfanumerico = (tipoDocumento) => tipoDocumento === 'CE' || tipoDocumento === 'PASAPORTE'

export function limpiarDocumento(tipoDocumento, texto) {
  if (esDocumentoAlfanumerico(tipoDocumento)) {
    return String(texto ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
  }
  return soloDigitos(texto)
}

export function longitudMaximaDocumento(tipoDocumento) {
  if (tipoDocumento === 'RUC') return 11
  if (tipoDocumento === 'DNI') return 8
  return 12
}

export function documentoValido(tipoDocumento, texto) {
  if (tipoDocumento === 'RUC') return rucValido(texto)
  if (tipoDocumento === 'DNI') return dniValido(texto)
  return /^[A-Za-z0-9]{1,12}$/.test(texto)
}

// Celular peruano: 9 dígitos que empiezan con 9. Acepta «+51 987 654 321», «987-654-321», etc. Devuelve los 9 dígitos o null.
export function normalizarCelular(texto) {
  let digitos = soloDigitos(texto)
  if (digitos.length === 11 && digitos.startsWith('51')) digitos = digitos.slice(2)
  return /^9\d{8}$/.test(digitos) ? digitos : null
}

// 987654321 -> «987 654 321»
export function formatearCelular(texto) {
  const celular = normalizarCelular(texto)
  return celular ? `${celular.slice(0, 3)} ${celular.slice(3, 6)} ${celular.slice(6)}` : ''
}

// ¿Los datos elegidos alcanzan para emitir este comprobante con este total?
// `comprobante` es null (sin comprobante) o { tipo, tipoDocumento, documento, nombre, direccion, celular }.
// `celular`: el celular que se usará para enviar el PDF (el del cliente seleccionado o el escrito en la ventana);
// sin uno válido el comprobante queda incompleto, porque no habría cómo hacerle llegar el PDF.
export function comprobanteCompleto(comprobante, total, celular) {
  if (!comprobante) return true
  if (!normalizarCelular(celular)) return false
  if (comprobante.tipo === 'FACTURA') {
    return rucValido(comprobante.documento ?? '') && Boolean(comprobante.nombre?.trim())
  }
  const tipoDocumento = comprobante.tipoDocumento ?? 'DNI'
  // Desde el umbral: documento válido Y nombre del comprador.
  if (boletaRequiereDni(total)) {
    return documentoValido(tipoDocumento, comprobante.documento ?? '') && Boolean(comprobante.nombre?.trim())
  }
  // Debajo del umbral el documento es opcional, pero si se escribió debe ser válido.
  return !comprobante.documento || documentoValido(tipoDocumento, comprobante.documento)
}
