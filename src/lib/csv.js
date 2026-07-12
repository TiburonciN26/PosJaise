// M4 de la 2ª auditoría: Excel/Sheets ejecutan como fórmula cualquier celda
// que empiece con =, +, - o @ al abrir el CSV (ej. un producto llamado
// "=1+1"). Anteponer una comilla simple fuerza texto plano — inyección CSV
// clásica, riesgo bajo acá pero estándar corregirlo.
const INICIO_PELIGROSO = /^[=+\-@]/

function escaparCampoCSV(valor) {
  if (valor == null) return ''
  let texto = String(valor)
  if (INICIO_PELIGROSO.test(texto)) texto = `'${texto}`
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

// El BOM (﻿) al inicio es lo que hace que Excel en Windows detecte
// UTF-8 solo — sin él, tildes/ñ se ven como "AtenciÃ³n" al abrir el CSV ahí.
export function aCSV(filas, columnas) {
  const lineas = filas.map((fila) => columnas.map((c) => escaparCampoCSV(fila[c])).join(','))
  return '﻿' + [columnas.join(','), ...lineas].join('\n')
}

// Dispara la descarga de un archivo de texto (CSV) en el navegador.
export function descargarArchivo(nombre, contenido) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
}
