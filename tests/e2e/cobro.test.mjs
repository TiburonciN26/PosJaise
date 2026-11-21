// Aritmética del cobro en Ventas (src/lib/cobro.js). Sin base de datos ni navegador:
//   node --test tests/e2e/cobro.test.mjs
// Esto es dinero: si uno de estos casos falla, la puerta de despliegue (build-cloudflare.mjs) no publica.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMISION_MINIMA_TARJETA,
  calcularMontoPosTarjeta,
  calcularResumenCarritoWeb,
  calcularTotalesVenta,
  centavos,
  desglosarMontoTarjeta,
  limpiarCodigoCupon,
  normalizarDescuentoTecleado,
} from '../../src/lib/cobro.js'

const carrito = [
  { cantidad: 3, precioUnitario: 12.5 },
  { cantidad: 1, precioUnitario: 9.99 },
] // subtotal 47.49
const totales = (extra) => calcularTotalesVenta({ carrito, tipoDescuento: 'monto', valorDescuento: '', cuponPreview: null, montoRecibido: '', ...extra })

test('subtotal: suma cantidad × precio y redondea a céntimos', () => {
  assert.equal(totales().subtotal, 47.49)
  assert.equal(totales().total, 47.49)
  assert.equal(calcularTotalesVenta({ carrito: [{ cantidad: 3, precioUnitario: 0.1 }], tipoDescuento: 'monto', valorDescuento: '', cuponPreview: null, montoRecibido: '' }).subtotal, 0.3)
  assert.equal(calcularTotalesVenta({ carrito: [], tipoDescuento: 'monto', valorDescuento: '', cuponPreview: null, montoRecibido: '' }).total, 0)
})

test('descuento en %: se aplica sobre el subtotal, con tope 0–100', () => {
  assert.equal(totales({ tipoDescuento: 'porcentaje', valorDescuento: '10' }).montoDescuento, 4.75)
  assert.equal(totales({ tipoDescuento: 'porcentaje', valorDescuento: '10' }).total, 42.74)
  assert.equal(totales({ tipoDescuento: 'porcentaje', valorDescuento: '150' }).total, 0)
  assert.equal(totales({ tipoDescuento: 'porcentaje', valorDescuento: '-5' }).total, 47.49)
  assert.equal(totales({ tipoDescuento: 'porcentaje', valorDescuento: '' }).total, 47.49)
})

test('descuento en soles: nunca negativo ni mayor que el subtotal', () => {
  assert.equal(totales({ valorDescuento: '7.49' }).total, 40)
  assert.equal(totales({ valorDescuento: '100' }).total, 0)
  assert.equal(totales({ valorDescuento: '100' }).montoDescuento, 47.49)
  assert.equal(totales({ valorDescuento: '-10' }).total, 47.49)
})

test('cupón al 20 %: descuenta el 20 % del subtotal, NO S/ 20 (bug real que se cobró mal)', () => {
  const r = totales({ tipoDescuento: 'cupon', cuponPreview: { valor: 20, tipoDescuento: 'PORCENTAJE' } })
  assert.equal(r.montoDescuento, 9.5)
  assert.equal(r.total, 37.99)
})

test('cupón de monto fijo: tope en el subtotal; sin cupón verificado no descuenta nada', () => {
  assert.equal(totales({ tipoDescuento: 'cupon', cuponPreview: { valor: 20, tipoDescuento: 'MONTO_FIJO' } }).total, 27.49)
  assert.equal(totales({ tipoDescuento: 'cupon', cuponPreview: { valor: 80, tipoDescuento: 'MONTO_FIJO' } }).total, 0)
  assert.equal(totales({ tipoDescuento: 'cupon', cuponPreview: null }).total, 47.49)
  // lo tecleado en el campo (el código) nunca se interpreta como descuento en modo cupón
  assert.equal(totales({ tipoDescuento: 'cupon', valorDescuento: '30', cuponPreview: null }).total, 47.49)
})

test('vuelto: recibido − total, en céntimos exactos; sin recibido es negativo', () => {
  assert.equal(totales({ montoRecibido: '50' }).vuelto, 2.51)
  assert.equal(totales({ montoRecibido: '47.49' }).vuelto, 0)
  assert.equal(totales({ montoRecibido: '' }).vuelto, -47.49)
  assert.equal(totales({ montoRecibido: '100', tipoDescuento: 'porcentaje', valorDescuento: '10' }).vuelto, 57.26)
})

test('tarjeta: casos conocidos del monto a digitar en el POS', () => {
  assert.equal(calcularMontoPosTarjeta(100), 104.23) // 100 / (1 − 0.040592)
  assert.equal(calcularMontoPosTarjeta(50), 54.13) // el % no cubre el mínimo: 50 + 4.13
  assert.equal(calcularMontoPosTarjeta(0), COMISION_MINIMA_TARJETA)
})

test('tarjeta: después de la comisión de Culqi al negocio le queda el total de la venta (±1 céntimo)', () => {
  for (let total = 0.5; total <= 3000; total = Math.round((total * 1.07 + 0.37) * 100) / 100) {
    const monto = calcularMontoPosTarjeta(total)
    const d = desglosarMontoTarjeta(monto)
    assert.ok(Math.abs(d.venta - total) <= 0.011, `total ${total}: monto ${monto} deja ${d.venta.toFixed(4)}`)
    assert.ok(Math.abs(d.comision + d.igv + d.venta - monto) < 1e-9, `total ${total}: el desglose no suma el monto`)
    assert.ok(d.comision + d.igv >= COMISION_MINIMA_TARJETA - 0.011, `total ${total}: comisión bajo el mínimo`)
  }
})

test('tarjeta: el desglose dice qué tramo de comisión aplica', () => {
  assert.equal(desglosarMontoTarjeta(54.13).etiquetaComision, 'mín.')
  assert.equal(desglosarMontoTarjeta(104.23).etiquetaComision, '3.44%')
})

test('descuento tecleado: en % solo dígitos con tope 100; en soles un único punto decimal', () => {
  assert.equal(normalizarDescuentoTecleado('abc12', true), '12')
  assert.equal(normalizarDescuentoTecleado('999', true), '100')
  assert.equal(normalizarDescuentoTecleado('1234', true), '100') // se corta a 3 dígitos (123) y luego al tope
  assert.equal(normalizarDescuentoTecleado('', true), '')
  assert.equal(normalizarDescuentoTecleado('12.5.3', false), '12.53')
  assert.equal(normalizarDescuentoTecleado('S/ 15.90', false), '15.90')
  assert.equal(normalizarDescuentoTecleado('1000000', false), '1000000') // sin tope: el tope lo pone el subtotal
})

test('carrito del portal: subtotal, ahorro por precio rebajado, delivery solo con DELIVERY y cupón confirmado', () => {
  const productosMarcados = [
    { precio: 20, precioAntes: 25, cantidad: 2 },
    { precio: 15, precioAntes: null, cantidad: 1 },
  ]
  const r = calcularResumenCarritoWeb({ productosMarcados, entrega: 'DELIVERY', zona: { costo: 8 }, descuentoCupon: 5 })
  assert.deepEqual(r, { subtotal: 55, subtotalSinDescuento: 65, descuentoProductos: 10, costoDelivery: 8, total: 58, totalSinDescuentos: 73, hayAhorroTotal: true })
  const recojo = calcularResumenCarritoWeb({ productosMarcados, entrega: 'RECOJO', zona: { costo: 8 }, descuentoCupon: 0 })
  assert.equal(recojo.costoDelivery, 0)
  assert.equal(recojo.total, 55)
  // un cupón mayor que la compra deja el total en 0, nunca negativo
  assert.equal(calcularResumenCarritoWeb({ productosMarcados, entrega: 'RECOJO', zona: undefined, descuentoCupon: 999 }).total, 0)
  assert.equal(calcularResumenCarritoWeb({ productosMarcados: [], entrega: 'DELIVERY', zona: undefined, descuentoCupon: 0 }).total, 0)
})

test('lo que se PAGA va en céntimos enteros: el error de coma flotante de la suma no llega a Culqi ni al servidor', () => {
  const r = calcularResumenCarritoWeb({ productosMarcados: [{ precio: 0.1, cantidad: 1 }, { precio: 0.2, cantidad: 1 }], entrega: 'RECOJO', zona: undefined, descuentoCupon: 0 })
  assert.notEqual(r.total, 0.3) // 0.1 + 0.2 = 0.30000000000000004: la suma en coma flotante no es exacta…
  assert.equal(centavos(r.total), 30) // …pero los céntimos sí
  assert.equal(centavos(19.99), 1999) // 19.99 × 100 = 1998.9999999999998 → 1999
  assert.equal(centavos('45.50'), 4550) // precios numeric(10,2) llegan como texto desde PostgREST
})

test('código de cupón: alfanumérico, mayúsculas, máximo 6', () => {
  assert.equal(limpiarCodigoCupon(' ab-c1 23x '), 'ABC123')
  assert.equal(limpiarCodigoCupon('fide20'), 'FIDE20')
  assert.equal(limpiarCodigoCupon(123), '123')
})
