// Fase 10A · V2: estadística común del medidor de vitales y del evaluador de presupuestos.
// Con un número par de muestras la mediana es la media de los dos valores centrales (la V1 tomaba el inferior). Solo cuentan
// números finitos: un valor ausente o de texto ('sin-campo') no es una muestra. Sin muestras válidas → null (nunca 0).
function mediana(xs) {
  const v = (Array.isArray(xs) ? xs : []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Número de muestras aceptado por el medidor: entero entre 1 y 9. */
function validarMuestras(valor) {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error(`--muestras debe ser un entero entre 1 y 9 (se recibió ${valor})`)
  return n
}

module.exports = { mediana, validarMuestras }
