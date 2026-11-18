// Almacén (migración 20261112000011_almacen): las funciones del servidor escriben con errcode P0001 / 42501 mensajes
// pensados para la usuaria (stock insuficiente, negocio cerrado, nombre repetido…); cualquier otro error muestra uno genérico.
export function mensajeErrorAlmacen(error, generico) {
  return error?.code === 'P0001' || error?.code === '42501' ? error.message : generico
}

// El stock mínimo ya no se pide en el formulario: todo artículo avisa «bajo» al llegar a 3 (mismo default en la tabla).
export const STOCK_MINIMO_ALMACEN = 3

// Filtros de tecleo: los campos numéricos solo aceptan lo que pueden guardar (se aplican en cada onChange, así una letra
// o un signo pegado simplemente no aparece). La validación completa sigue al guardar y en el servidor.
export function soloEnteros(texto) {
  return String(texto ?? '').replace(/\D/g, '').slice(0, 9)
}

// soloImporte vive en moneda.js (también lo usa Caja chica); se re-exporta para los modales del Almacén.
export { soloImporte } from './moneda.js'

// Los ingresos se anotan por PRECIO UNITARIO (lo que costó cada botella, rollo…) y el total sale solo: cantidad × precio.
// El servidor sigue guardando el costo total del ingreso (almacen_movimientos.costo_total, numeric(10,2)), así que se
// redondea a céntimos aquí. null si falta alguno de los dos o no es un número válido.
export const COSTO_MAXIMO_ALMACEN = 99999999.99

export function calcularCostoTotal(cantidad, precioUnitario) {
  if (!Number.isFinite(cantidad) || !Number.isFinite(precioUnitario)) return null
  return Math.round(cantidad * precioUnitario * 100) / 100
}
