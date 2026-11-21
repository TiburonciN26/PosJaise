// Aritmética del cobro en Ventas (POS). Módulo PURO: sin React, sin Supabase, sin navegador, para poder probarlo con
// node --test (tests/e2e/cobro.test.mjs) y que un error de cálculo NO llegue a producción (la puerta de despliegue corre
// esos tests). Las fórmulas se movieron TAL CUAL desde pages/Ventas.jsx (auditoría 2026-11-20, hallazgo 1.1): mismo
// redondeo, mismos topes y mismo orden de operaciones. El servidor (confirmar_venta) vuelve a calcular y es el que
// manda; esto es lo que ve la cajera antes de cobrar, y debe coincidir con lo que se cobra.
import { redondear2, sumarMontos } from './moneda.js'

// Comisión de Culqi (POS físico): 3.44% + IGV sobre el % (~4.0592% neto), o
// un mínimo de S/ 3.50 + IGV (S/ 4.13) si el % no llega a cubrirlo. Se
// calcula el monto inverso para que, después de la comisión, al negocio le
// quede exactamente el total de la venta — nunca asume la comisión del banco.
export const TASA_COMISION_TARJETA = 0.040592
export const COMISION_MINIMA_TARJETA = 4.13

export function calcularMontoPosTarjeta(total) {
  const montoPorcentaje = total / (1 - TASA_COMISION_TARJETA)
  const montoFijo = total + COMISION_MINIMA_TARJETA
  return redondear2(Math.max(montoPorcentaje, montoFijo))
}

// Desglose de lo que se digita en el POS: venta + comisión (3.44% o mínimo
// S/ 3.50) + IGV 18% sobre la comisión = monto. Solo lectura: se deriva del
// monto escrito, que es el único campo editable.
export function desglosarMontoTarjeta(monto) {
  const porPorcentaje = monto * 0.0344
  const esMinimo = porPorcentaje * 1.18 < COMISION_MINIMA_TARJETA
  const comision = esMinimo ? 3.5 : porPorcentaje
  const igv = esMinimo ? COMISION_MINIMA_TARJETA - 3.5 : porPorcentaje * 0.18
  return {
    monto,
    comision,
    igv,
    venta: monto - comision - igv,
    etiquetaComision: esMinimo ? 'mín.' : '3.44%',
  }
}

/**
 * Totales del carrito de Ventas.
 * @param {object} p
 * @param {{ cantidad: number, precioUnitario: number }[]} p.carrito
 * @param {'porcentaje'|'monto'|'cupon'} p.tipoDescuento
 * @param {string} p.valorDescuento   lo tecleado en el campo de descuento (% o S/)
 * @param {{ valor?: number, tipoDescuento?: string } | null} p.cuponPreview   cupón verificado (solo en tipo 'cupon')
 * @param {string} p.montoRecibido    efectivo recibido tecleado
 */
export function calcularTotalesVenta({ carrito, tipoDescuento, valorDescuento, cuponPreview, montoRecibido }) {
  const subtotal = sumarMontos(carrito, (item) => item.cantidad * item.precioUnitario)
  const valorDescuentoNumero = parseFloat(valorDescuento) || 0
  const esDescuentoPorcentaje = tipoDescuento === 'porcentaje'
  const esCupon = tipoDescuento === 'cupon'
  const descuentoPctAplicado = esDescuentoPorcentaje
    ? Math.min(100, Math.max(0, valorDescuentoNumero))
    : 0
  // Bug real reportado (cupón de Fidelización, 20%): esto SIEMPRE trataba
  // cuponPreview.valor como monto fijo en soles, sin mirar tipoDescuento —
  // el "Total"/"Vuelto" que veía la cajera en pantalla no coincidía con lo
  // que confirmar_venta() termina cobrando de verdad en el servidor (que sí
  // ya distinguía % de monto fijo, ver 97_cupones_fidelizacion.sql). Mismo
  // cálculo que ya existía acá abajo para el descuento manual por %.
  const montoDescuento = esCupon
    ? cuponPreview?.tipoDescuento === 'PORCENTAJE'
      ? redondear2(subtotal * ((cuponPreview.valor ?? 0) / 100))
      : redondear2(Math.min(cuponPreview?.valor ?? 0, subtotal))
    : esDescuentoPorcentaje
      ? redondear2(subtotal * (descuentoPctAplicado / 100))
      : redondear2(Math.min(Math.max(valorDescuentoNumero, 0), subtotal))
  const total = redondear2(subtotal - montoDescuento)
  const recibidoNumerico = parseFloat(montoRecibido) || 0
  const vuelto = redondear2(recibidoNumerico - total)
  return { subtotal, valorDescuentoNumero, esDescuentoPorcentaje, esCupon, descuentoPctAplicado, montoDescuento, total, recibidoNumerico, vuelto }
}

/**
 * Normaliza lo que se teclea en el campo de descuento: en % solo dígitos (máx. 3) con tope 100; en soles dígitos y un
 * único punto decimal, sin tope de caracteres.
 */
export function normalizarDescuentoTecleado(valor, esDescuentoPorcentaje) {
  if (esDescuentoPorcentaje) {
    const soloDigitos = valor.replace(/[^0-9]/g, '').slice(0, 3)
    return soloDigitos === '' ? '' : String(Math.min(100, parseInt(soloDigitos, 10)))
  }
  // Monto fijo en soles: dígitos + un único punto decimal, sin tope de caracteres.
  const limpio = valor.replace(/[^0-9.]/g, '')
  const primerPunto = limpio.indexOf('.')
  return primerPunto === -1
    ? limpio
    : limpio.slice(0, primerPunto + 1) + limpio.slice(primerPunto + 1).replace(/\./g, '')
}

/**
 * Resumen del carrito de productos del PORTAL (pages/cliente/CarritoCliente.jsx). Igual que antes de moverlo: suma sin
 * redondear (lo que se muestra pasa por toFixed(2) y lo que se PAGA o se manda al servidor pasa por centavos(), que
 * redondea a céntimos — ver tests/e2e/cobro.test.mjs).
 * @param {object} p
 * @param {{ precio: number, precioAntes?: number|null, cantidad: number }[]} p.productosMarcados  marcados y con stock
 * @param {'DELIVERY'|'RECOJO'|string} p.entrega
 * @param {{ costo?: number } | undefined} p.zona   zona de delivery elegida
 * @param {number} p.descuentoCupon   solo un descuento CONFIRMADO por el servidor (si no, 0)
 */
export function calcularResumenCarritoWeb({ productosMarcados, entrega, zona, descuentoCupon }) {
  const subtotal = productosMarcados.reduce((suma, p) => suma + p.precio * p.cantidad, 0)
  const subtotalSinDescuento = productosMarcados.reduce((suma, p) => suma + (p.precioAntes ?? p.precio) * p.cantidad, 0)
  const descuentoProductos = subtotalSinDescuento - subtotal
  const costoDelivery = entrega === 'DELIVERY' ? (zona?.costo ?? 0) : 0
  const total = Math.max(0, subtotal + costoDelivery - descuentoCupon)
  const totalSinDescuentos = subtotalSinDescuento + costoDelivery
  return { subtotal, subtotalSinDescuento, descuentoProductos, costoDelivery, total, totalSinDescuentos, hayAhorroTotal: totalSinDescuentos > total }
}

/** Soles → céntimos enteros (lo que viaja a Culqi y a crear_pedido_web). */
export const centavos = (n) => Math.round(Number(n) * 100)

/** Código de cupón: alfanumérico en mayúsculas, 6 caracteres como máximo. */
export function limpiarCodigoCupon(valor) {
  return String(valor).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6)
}
