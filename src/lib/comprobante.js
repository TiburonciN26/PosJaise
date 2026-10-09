// Reglas de los datos del comprobante (boleta / factura) al cobrar.
//
// Solo valida el FORMATO en el navegador; la consulta real del RUC/DNI la hará
// el proveedor de facturación cuando se conecte.

// Desde este total (con IGV) SUNAT exige identificar al comprador con DNI en la boleta.
export const UMBRAL_DNI_BOLETA = 700

export const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '')

export const dniValido = (texto) => /^\d{8}$/.test(texto)

// RUC: 11 dígitos, prefijo 10/15/17/20 y dígito verificador (módulo 11).
export function rucValido(texto) {
  if (!/^(10|15|17|20)\d{9}$/.test(texto)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(texto[i]), 0)
  const resto = 11 - (suma % 11)
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto
  return verificador === Number(texto[10])
}

export const boletaRequiereDni = (total) => total >= UMBRAL_DNI_BOLETA

// ¿Los datos elegidos alcanzan para emitir este comprobante con este total?
// `comprobante` es null (sin comprobante) o { tipo, documento, nombre, direccion }.
export function comprobanteCompleto(comprobante, total) {
  if (!comprobante) return true
  if (comprobante.tipo === 'FACTURA') {
    return rucValido(comprobante.documento ?? '') && Boolean(comprobante.nombre?.trim())
  }
  if (boletaRequiereDni(total)) return dniValido(comprobante.documento ?? '')
  // Debajo del umbral el DNI es opcional, pero si se escribió debe ser válido.
  return !comprobante.documento || dniValido(comprobante.documento)
}
