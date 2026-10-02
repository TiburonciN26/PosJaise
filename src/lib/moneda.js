export function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

// La DB guarda plata como numeric(10,2) (exacto); al sumar en el navegador
// con floats de JS, la suma puede arrastrar residuos de céntimos (ej.
// 0.1 + 0.2 = 0.30000000000000004) — invisible con montos chicos, pero un
// riesgo real al sumar muchas filas. Redondear el resultado de cada
// agregación (no cada paso intermedio) alcanza para que nunca se vea un
// residuo, sin tener que reescribir las sumas en céntimos enteros.
export function redondear2(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

// Azúcar para reduce()s de montos: sumarMontos(gastos, (g) => g.monto).
export function sumarMontos(items, seleccionar = (x) => x) {
  return redondear2(items.reduce((acumulado, item) => acumulado + seleccionar(item), 0))
}

// QA-028: parseFloat acepta un prefijo numérico ("12abc" -> 12) y Number()
// acepta "1e3", "0x10" o "Infinity". Para un importe tecleado se exige el texto
// COMPLETO: dígitos con punto decimal opcional y hasta 2 decimales (la columna
// es numeric(10,2); más decimales se redondearían en silencio). Devuelve NaN si
// no cumple (vacío, negativo, letras, coma, notación científica, 3+ decimales).
// La coma decimal no se admite: es lo mismo que hace Gastos (QA-014).
export function leerImporte(texto) {
  const limpio = String(texto ?? '').trim()
  if (!/^(?:\d{1,8}(?:\.\d{1,2})?|\.\d{1,2})$/.test(limpio)) return Number.NaN
  return Number(limpio)
}
