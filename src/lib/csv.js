function escaparCampoCSV(valor) {
  if (valor == null) return ''
  const texto = String(valor)
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function aCSV(filas, columnas) {
  const lineas = filas.map((fila) => columnas.map((c) => escaparCampoCSV(fila[c])).join(','))
  return [columnas.join(','), ...lineas].join('\n')
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
