// Adelanto de cita en Ventas (src/lib/adelantoCita.js + calcularTotalesVenta). El adelanto NO es un descuento. Sin base de datos ni navegador:
//   node --test tests/e2e/adelanto-cita.test.mjs
// Es dinero que se descuenta al cobrar: si un caso falla, la puerta de despliegue no publica.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAdelantoSugerido, adelantoSuperaTotal, totalServiciosCita, agruparAtencionesPorCita } from '../../src/lib/adelantoCita.js'
import { calcularTotalesVenta } from '../../src/lib/cobro.js'

const linea = (registroServicioId, precio) => ({ tipo: 'SERVICIO', registroServicioId, precioUnitario: precio, cantidad: 1 })
const producto = (precio, cantidad = 1) => ({ tipo: 'PRODUCTO', productoId: 'p1', precioUnitario: precio, cantidad })

test('el ejemplo del negocio: servicio de 10 con adelanto de 5 propone 5', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1'] }]
  assert.equal(calcularAdelantoSugerido([linea('r1', 10)], adelantos), 5)
})

test('sin adelantos o sin atenciones de la cita en el carrito no se propone nada', () => {
  assert.equal(calcularAdelantoSugerido([linea('r1', 10)], []), 0)
  assert.equal(calcularAdelantoSugerido([linea('r1', 10)], undefined), 0)
  assert.equal(calcularAdelantoSugerido([linea('r9', 10), producto(20)], [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1'] }]), 0)
})

test('nunca más que el precio de las atenciones de esa cita que están en el carrito', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 30, registro_ids: ['r1', 'r2'] }]
  assert.equal(calcularAdelantoSugerido([linea('r1', 10)], adelantos), 10)
  assert.equal(calcularAdelantoSugerido([linea('r1', 10), linea('r2', 15)], adelantos), 25)
})

test('cita con varios servicios cobrados juntos: el adelanto se cuenta UNA vez, no por servicio', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1', 'r2'] }]
  assert.equal(calcularAdelantoSugerido([linea('r1', 10), linea('r2', 10)], adelantos), 5)
})

test('dos citas distintas en el mismo ticket suman sus adelantos; los productos no cuentan', () => {
  const adelantos = [
    { cita_id: 'c1', pendiente: 5, registro_ids: ['r1'] },
    { cita_id: 'c2', pendiente: 7.5, registro_ids: ['r2'] },
  ]
  assert.equal(calcularAdelantoSugerido([linea('r1', 10), linea('r2', 20), producto(50, 2)], adelantos), 12.5)
})

test('redondea a centavos sin arrastrar error de coma flotante', () => {
  const adelantos = [
    { cita_id: 'c1', pendiente: 0.1, registro_ids: ['r1'] },
    { cita_id: 'c2', pendiente: 0.2, registro_ids: ['r2'] },
  ]
  assert.equal(calcularAdelantoSugerido([linea('r1', 10), linea('r2', 10)], adelantos), 0.3)
})

// ---- Modal «Atención a cobrar»: bloques de cita con adelanto ----
const atencion = (id, precio) => ({ id, precio })

test('atención suelta de una cita con adelanto: muestra ese adelanto, sin pasar de su precio', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1'] }]
  assert.deepEqual(agruparAtencionesPorCita([atencion('r1', 10)], adelantos), [{ atenciones: [atencion('r1', 10)], adelanto: 5 }])
  assert.equal(agruparAtencionesPorCita([atencion('r1', 3)], adelantos)[0].adelanto, 3)
})

test('sin adelanto (otra cita, sin cita, o RPC sin respuesta) cada atención va sola y sin monto', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1'] }]
  assert.deepEqual(agruparAtencionesPorCita([atencion('r9', 10)], adelantos), [{ atenciones: [atencion('r9', 10)], adelanto: null }])
  assert.equal(agruparAtencionesPorCita([atencion('r1', 10)], []).length, 1)
  assert.equal(agruparAtencionesPorCita([atencion('r1', 10)], undefined)[0].adelanto, null)
  assert.equal(agruparAtencionesPorCita([atencion('r1', 10)], [{ cita_id: 'c1', pendiente: 0, registro_ids: ['r1'] }])[0].adelanto, null)
})

test('cita con varios servicios con adelanto: un solo bloque con el adelanto de la cita, en el lugar de la primera', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 20, registro_ids: ['r1', 'r3'] }]
  const lista = [atencion('r1', 10), atencion('r2', 7), atencion('r3', 15)]
  const resultado = agruparAtencionesPorCita(lista, adelantos)
  assert.equal(resultado.length, 2)
  assert.deepEqual(resultado[0].atenciones.map((a) => a.id), ['r1', 'r3'])
  assert.equal(resultado[0].adelanto, 20)
  assert.deepEqual(resultado[1], { atenciones: [atencion('r2', 7)], adelanto: null })
})

test('el adelanto del bloque nunca supera la suma de los precios de sus atenciones', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 99, registro_ids: ['r1', 'r2'] }]
  assert.equal(agruparAtencionesPorCita([atencion('r1', 10), atencion('r2', 15)], adelantos)[0].adelanto, 25)
})

test('si de la cita solo queda una atención en la lista (la otra ya se cobró o está en el carrito) va suelta', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r2'] }]
  const resultado = agruparAtencionesPorCita([atencion('r2', 10)], adelantos)
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].atenciones.length, 1)
  assert.equal(resultado[0].adelanto, 5)
})

// ---- Totales: el adelanto NO cambia el total de la venta; solo rebaja lo que se cobra hoy (src/lib/cobro.js) ----
const ticket = (carrito, extra) =>
  calcularTotalesVenta({ carrito, tipoDescuento: 'porcentaje', valorDescuento: '', cuponPreview: null, montoRecibido: '', ...extra })

test('servicio de 10 con adelanto de 5: la venta sigue valiendo 10, se cobran 5 hoy y NO hay descuento', () => {
  const t = ticket([linea('r1', 10)], { adelanto: 5 })
  assert.equal(t.subtotal, 10)
  assert.equal(t.montoDescuento, 0)
  assert.equal(t.total, 10)
  assert.equal(t.adelantoAplicado, 5)
  assert.equal(t.aCobrar, 5)
})

test('el ejemplo del negocio: 10, adelanto 5 y descuento real 2 → la venta vale 8 y se cobran 3 hoy', () => {
  const t = ticket([linea('r1', 10)], { tipoDescuento: 'monto', valorDescuento: '2', adelanto: 5 })
  assert.equal(t.montoDescuento, 2)
  assert.equal(t.total, 8)
  assert.equal(t.adelantoAplicado, 5)
  assert.equal(t.aCobrar, 3)
  const porcentaje = ticket([linea('r1', 10)], { tipoDescuento: 'porcentaje', valorDescuento: '20', adelanto: 5 })
  assert.equal(porcentaje.total, 8)
  assert.equal(porcentaje.aCobrar, 3)
})

test('sin adelanto el total y lo que se cobra son lo mismo, como siempre', () => {
  const t = ticket([linea('r1', 10)], {})
  assert.equal(t.adelantoAplicado, 0)
  assert.equal(t.total, 10)
  assert.equal(t.aCobrar, 10)
})

test('el adelanto nunca es más que el total de la venta (tras el descuento) ni negativo', () => {
  const t = ticket([linea('r1', 10)], { tipoDescuento: 'monto', valorDescuento: '8', adelanto: 5 })
  assert.equal(t.total, 2)
  assert.equal(t.adelantoAplicado, 2)
  assert.equal(t.aCobrar, 0)
  assert.equal(ticket([linea('r1', 10)], { adelanto: 99 }).aCobrar, 0)
  assert.equal(ticket([linea('r1', 10)], { adelanto: -3 }).adelantoAplicado, 0)
})

test('el vuelto se calcula sobre lo que se cobra hoy, no sobre el total de la venta', () => {
  const t = ticket([linea('r1', 10)], { adelanto: 5, montoRecibido: '10' })
  assert.equal(t.vuelto, 5)
  const conDescuento = ticket([linea('r1', 10)], { tipoDescuento: 'monto', valorDescuento: '2', adelanto: 5, montoRecibido: '5' })
  assert.equal(conDescuento.vuelto, 2)
})

// ModalCita: el adelanto no puede pasar de la suma de los servicios del carrito.
test('el total de la cita suma los precios; vacíos o inválidos cuentan 0 y no hay residuos de céntimos', () => {
  assert.equal(totalServiciosCita([{ precio: '10' }, { precio: '0.1' }, { precio: '0.2' }]), 10.3)
  assert.equal(totalServiciosCita([{ precio: '' }, { precio: 'abc' }, { precio: '25.50' }]), 25.5)
  assert.equal(totalServiciosCita([]), 0)
})

test('adelanto mayor al total de los servicios se marca; igual o menor, no', () => {
  assert.equal(adelantoSuperaTotal('50.01', 50), true)
  assert.equal(adelantoSuperaTotal('50', 50), false)
  assert.equal(adelantoSuperaTotal('20', 50), false)
})

test('sin servicios cualquier adelanto positivo excede; vacío, cero o texto no cuentan como excedido', () => {
  assert.equal(adelantoSuperaTotal('5', 0), true)
  assert.equal(adelantoSuperaTotal('', 0), false)
  assert.equal(adelantoSuperaTotal('0', 0), false)
  assert.equal(adelantoSuperaTotal('abc', 10), false)
})
