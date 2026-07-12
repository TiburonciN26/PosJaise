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
