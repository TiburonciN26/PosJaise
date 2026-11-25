// Descuento acordado en una cita + método del adelanto + permisos de alta de clientas + saludo de cumpleaños. Módulos puros, sin base
// de datos ni navegador:  node --test tests/e2e/descuento-cita.test.mjs
// El descuento SÍ es dinero perdido (a diferencia del adelanto): si un caso falla, la puerta de despliegue no publica.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparAtencionesPorCita,
  calcularAdelantoSugerido,
  calcularDescuentoCitaSugerido,
  descuentoSuperaTotal,
  metodoAdelantoDe,
} from '../../src/lib/adelantoCita.js'
import { calcularTotalesVenta } from '../../src/lib/cobro.js'
import { puedeRegistrarClientes } from '../../src/lib/permisosClientes.js'
import { mensajeCumpleanos, primerNombre } from '../../src/lib/saludoCumpleanos.js'

const linea = (registroServicioId, precio) => ({ tipo: 'SERVICIO', registroServicioId, precioUnitario: precio, cantidad: 1 })
const producto = (precio) => ({ tipo: 'PRODUCTO', productoId: 'p1', precioUnitario: precio, cantidad: 1 })
const atencion = (id, precio) => ({ id, precio })

// --- Formulario de la cita ---------------------------------------------------------------------------------------------------
test('adelanto + descuento no pueden pasar del total de los servicios', () => {
  assert.equal(descuentoSuperaTotal('10', '', 100), false)
  assert.equal(descuentoSuperaTotal('60', '40', 100), false, 'justo el total: permitido')
  assert.equal(descuentoSuperaTotal('61', '40', 100), true)
  assert.equal(descuentoSuperaTotal('150', '', 100), true)
})

test('descuento vacío, cero o no numérico nunca cuenta como excedido (de eso se ocupa la validación de formato)', () => {
  assert.equal(descuentoSuperaTotal('', '500', 100), false)
  assert.equal(descuentoSuperaTotal('0', '500', 100), false)
  assert.equal(descuentoSuperaTotal('abc', '500', 100), false)
})

test('un adelanto no numérico no suma al tope del descuento', () => {
  assert.equal(descuentoSuperaTotal('90', 'x', 100), false)
  assert.equal(descuentoSuperaTotal('90', undefined, 100), false)
})

test('sin servicios el total es 0: cualquier descuento positivo excede', () => {
  assert.equal(descuentoSuperaTotal('5', '', 0), true)
})

// --- Ventas: descuento que se aplica solo ------------------------------------------------------------------------------------
test('el descuento de la cita se propone completo cuando sus atenciones están en el carrito', () => {
  const descuentos = [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1'] }]
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 50)], descuentos), 10)
})

test('sin descuentos pendientes, o sin las atenciones de esa cita en el carrito, no se propone nada', () => {
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 50)], []), 0)
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 50)], undefined), 0)
  assert.equal(calcularDescuentoCitaSugerido([linea('r9', 50), producto(20)], [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1'] }]), 0)
})

test('nunca más que el precio de las atenciones de esa cita que están en el carrito', () => {
  const descuentos = [{ cita_id: 'c1', descuento: 80, registro_ids: ['r1', 'r2'] }]
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 30)], descuentos), 30)
})

test('cita con varios servicios: el descuento se cuenta UNA vez, no por servicio', () => {
  const descuentos = [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1', 'r2'] }]
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 40), linea('r2', 40)], descuentos), 10)
})

test('dos citas distintas suman cada una su descuento', () => {
  const descuentos = [
    { cita_id: 'c1', descuento: 10, registro_ids: ['r1'] },
    { cita_id: 'c2', descuento: 5, registro_ids: ['r2'] },
  ]
  assert.equal(calcularDescuentoCitaSugerido([linea('r1', 40), linea('r2', 40)], descuentos), 15)
})

test('el ejemplo del negocio: servicio de 100, descuento de 10 y adelanto de 30 → vale 90 y hoy se cobran 60', () => {
  const carrito = [linea('r1', 100)]
  const descuento = calcularDescuentoCitaSugerido(carrito, [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1'] }])
  const adelanto = calcularAdelantoSugerido(carrito, [{ cita_id: 'c1', pendiente: 30, registro_ids: ['r1'] }])
  // El descuento viaja como el descuento manual en soles (campo bloqueado del carrito).
  const totales = calcularTotalesVenta({ carrito, tipoDescuento: 'monto', valorDescuento: String(descuento), cuponPreview: null, montoRecibido: '', adelanto })
  assert.equal(totales.montoDescuento, 10)
  assert.equal(totales.total, 90)
  assert.equal(totales.adelantoAplicado, 30)
  assert.equal(totales.aCobrar, 60)
})

// --- «Atención a cobrar»: bloque de la cita ----------------------------------------------------------------------------------
test('una cita solo con descuento (sin adelanto) también junta sus atenciones en un bloque', () => {
  const descuentos = [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1', 'r2'] }]
  const resultado = agruparAtencionesPorCita([atencion('r1', 40), atencion('r2', 40)], [], descuentos)
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].atenciones.length, 2)
  assert.equal(resultado[0].adelanto, null)
  assert.equal(resultado[0].descuento, 10)
})

test('el descuento mostrado nunca supera el precio de las atenciones del bloque', () => {
  const resultado = agruparAtencionesPorCita([atencion('r1', 4)], [], [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1'] }])
  assert.equal(resultado[0].descuento, 4)
})

test('una atención sin descuento conserva exactamente su forma de siempre (sin clave descuento)', () => {
  assert.deepEqual(agruparAtencionesPorCita([atencion('r1', 10)], [], []), [{ atenciones: [atencion('r1', 10)], adelanto: null }])
  assert.deepEqual(agruparAtencionesPorCita([atencion('r1', 10)], undefined, undefined), [{ atenciones: [atencion('r1', 10)], adelanto: null }])
})

test('adelanto y descuento de la misma cita conviven en un solo bloque', () => {
  const adelantos = [{ cita_id: 'c1', pendiente: 5, registro_ids: ['r1', 'r2'] }]
  const descuentos = [{ cita_id: 'c1', descuento: 10, registro_ids: ['r1', 'r2'] }]
  const resultado = agruparAtencionesPorCita([atencion('r1', 20), atencion('r2', 20)], adelantos, descuentos)
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].adelanto, 5)
  assert.equal(resultado[0].descuento, 10)
})

// --- Método con que se pagó el adelanto --------------------------------------------------------------------------------------
test('el método del adelanto se muestra sin repetir; sin dato queda vacío', () => {
  assert.equal(metodoAdelantoDe([{ metodo: 'Yape' }]), 'Yape')
  assert.equal(metodoAdelantoDe([{ metodo: 'Yape' }, { metodo: 'Yape' }, { metodo: 'Efectivo' }]), 'Yape, Efectivo')
  assert.equal(metodoAdelantoDe([{ metodo: null }]), '')
  assert.equal(metodoAdelantoDe(undefined), '')
})

// --- Alta de clientas desde los modales --------------------------------------------------------------------------------------
test('administradora, cajera, encargada y asistente registran clientas; personal de apoyo y cliente no', () => {
  for (const rol of ['ADMINISTRADOR', 'CAJERA', 'ENCARGADA', 'ASISTENTE']) assert.equal(puedeRegistrarClientes(rol), true, rol)
  for (const rol of ['PERSONAL_APOYO', 'CLIENTE', '', undefined, null]) assert.equal(puedeRegistrarClientes(rol), false, String(rol))
})

// --- WhatsApp de cumpleaños: solo saludo -------------------------------------------------------------------------------------
test('el saludo de cumpleaños no ofrece descuento, cupón ni promoción', () => {
  const mensaje = mensajeCumpleanos('María Fernanda López')
  assert.match(mensaje, /^¡Feliz cumpleaños, María! 🎉/)
  assert.doesNotMatch(mensaje, /descuento|%|cup[oó]n|promo|oferta|gratis|S\//i)
})

test('el saludo funciona sin nombre', () => {
  assert.match(mensajeCumpleanos(''), /^¡Feliz cumpleaños! 🎉/)
  assert.match(mensajeCumpleanos(undefined), /^¡Feliz cumpleaños! 🎉/)
  assert.equal(primerNombre('  Ana   Gómez '), 'Ana')
})
