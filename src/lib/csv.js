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

// Lee un CSV (el que se exportó, devuelto por la contadora y quizá guardado por Excel). Devuelve una lista de objetos
// con las cabeceras normalizadas (minúsculas, sin tildes ni espacios laterales). Acepta , o ; como separador (Excel en
// español guarda con «;»), comillas con "" dentro, BOM al inicio y saltos \r\n. Quita la comilla simple que aCSV()
// antepone a los valores que empiezan con = + - @.
export function parsearCSV(texto) {
  const contenido = String(texto ?? '').replace(/^﻿/, '')
  const primeraLinea = contenido.split(/\r?\n/, 1)[0] ?? ''
  const separador = (primeraLinea.match(/;/g) ?? []).length > (primeraLinea.match(/,/g) ?? []).length ? ';' : ','

  const filas = []
  let fila = []
  let campo = ''
  let entreComillas = false
  for (let i = 0; i < contenido.length; i += 1) {
    const caracter = contenido[i]
    if (entreComillas) {
      if (caracter === '"' && contenido[i + 1] === '"') {
        campo += '"'
        i += 1
      } else if (caracter === '"') {
        entreComillas = false
      } else {
        campo += caracter
      }
    } else if (caracter === '"') {
      entreComillas = true
    } else if (caracter === separador) {
      fila.push(campo)
      campo = ''
    } else if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && contenido[i + 1] === '\n') i += 1
      fila.push(campo)
      campo = ''
      filas.push(fila)
      fila = []
    } else {
      campo += caracter
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }

  const filasConDatos = filas.filter((f) => f.some((c) => c.trim() !== ''))
  if (filasConDatos.length === 0) return []
  const cabeceras = filasConDatos[0].map((c) =>
    c
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase(),
  )
  return filasConDatos.slice(1).map((valores) =>
    Object.fromEntries(
      cabeceras.map((cabecera, indice) => [cabecera, (valores[indice] ?? '').trim().replace(/^'(?=[=+\-@])/, '')]),
    ),
  )
}
