// Lógica pura del «Detalle del período» del Dashboard (src/lib/detalleDashboard.js). Sin base de datos ni navegador:
//   node --test tests/e2e/detalle-dashboard.test.mjs
// El total del pie de cada pestaña debe ser el monto del Resumen: una suma con residuos de céntimos se vería como un descuadre.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PESTANAS_DETALLE,
  esPestanaDetalle,
  filtrarDetalle,
  normalizarBusqueda,
  formatearFechaHoraLima,
  paginarDetalle,
  totalDetalle,
  totalesProductos,
} from '../../src/lib/detalleDashboard.js'

test('las pestañas cubren los rubros del Resumen y se reconocen por id', () => {
  assert.deepEqual(
    PESTANAS_DETALLE.map((p) => p.id),
    ['productos', 'servicios', 'descuentos', 'comisiones', 'gastos', 'envios'],
  )
  assert.equal(esPestanaDetalle('servicios'), true)
  assert.equal(esPestanaDetalle('ventas'), false)
  assert.equal(esPestanaDetalle(undefined), false)
})

test('totalDetalle suma la columna de cada pestaña sin residuos de céntimos', () => {
  assert.equal(totalDetalle('servicios', [{ precio: 0.1 }, { precio: 0.2 }]), 0.3)
  assert.equal(totalDetalle('descuentos', [{ descuento: 41 }]), 41)
  assert.equal(totalDetalle('comisiones', [{ pago: 12.5 }, { pago: null }]), 12.5)
  assert.equal(totalDetalle('gastos', [{ monto: '100.10' }, { monto: 50 }]), 150.1)
  assert.equal(totalDetalle('envios', []), 0)
  assert.equal(totalDetalle('inexistente', [{ precio: 5 }]), 0)
  assert.equal(totalDetalle('productos', null), 0)
})

test('totalesProductos cuadra ingreso, costo y ganancia', () => {
  const filas = [
    { ingreso: 150, costo: 75, unidades: 1 },
    { ingreso: 99.9, costo: 60.35, unidades: 3 },
  ]
  assert.deepEqual(totalesProductos(filas), { ingreso: 249.9, costo: 135.35, ganancia: 114.55, unidades: 4 })
})

test('paginarDetalle corta por página y acota la página pedida', () => {
  const filas = Array.from({ length: 31 }, (_, i) => i)
  const p1 = paginarDetalle(filas, 1, 15)
  assert.equal(p1.filas.length, 15)
  assert.equal(p1.totalPaginas, 3)
  assert.equal(paginarDetalle(filas, 3, 15).filas.length, 1)
  assert.equal(paginarDetalle(filas, 99, 15).pagina, 3)
  assert.equal(paginarDetalle(filas, 0, 15).pagina, 1)
  const vacio = paginarDetalle([], 1, 15)
  assert.equal(vacio.totalPaginas, 1)
  assert.equal(vacio.total, 0)
})

test('formatearFechaHoraLima usa la hora de Lima (UTC-5), no la del servidor', () => {
  // 03:20 UTC del 14/11 = 10:20 p. m. del 13/11 en Lima.
  const texto = formatearFechaHoraLima('2026-11-14T03:20:17.852588+00:00')
  assert.match(texto, /13 nov/)
  assert.match(texto, /10:20/)
  assert.equal(formatearFechaHoraLima(null), '')
  assert.equal(formatearFechaHoraLima('no es fecha'), '')
})

test('normalizarBusqueda ignora mayúsculas, tildes y espacios de más', () => {
  assert.equal(normalizarBusqueda('  Ramírez  GEL '), 'ramirez  gel')
  assert.equal(normalizarBusqueda(null), '')
})

test('filtrarDetalle: sin texto devuelve todo; con texto exige todas las palabras en cualquier orden', () => {
  const servicios = [
    { servicio: 'Pedicure Gel', cliente: 'Evelyn Ramírez', asistente: 'Claudia', codigo: 'VEN10' },
    { servicio: 'Corte', cliente: 'Ana Pérez', asistente: 'Claudia', codigo: 'VEN11' },
  ]
  assert.equal(filtrarDetalle('servicios', servicios, '   ').length, 2)
  assert.deepEqual(filtrarDetalle('servicios', servicios, 'ramirez gel'), [servicios[0]])
  assert.deepEqual(filtrarDetalle('servicios', servicios, 'gel ramirez'), [servicios[0]])
  assert.equal(filtrarDetalle('servicios', servicios, 'claudia').length, 2)
  assert.equal(filtrarDetalle('servicios', servicios, 'ven11 gel').length, 0)
  assert.equal(filtrarDetalle('servicios', null, 'x'), null)
})

test('filtrarDetalle de gastos entiende «fijo» y «variable»', () => {
  const gastos = [
    { nombre: 'Alquiler', tipo: 'FIJO', monto: 500 },
    { nombre: 'Bolsas', tipo: 'VARIABLE', monto: 20 },
  ]
  assert.deepEqual(filtrarDetalle('gastos', gastos, 'fijo'), [gastos[0]])
  assert.deepEqual(filtrarDetalle('gastos', gastos, 'variable'), [gastos[1]])
})

test('filtrarDetalle de productos: por nombre conserva la fila; por cliente la reduce a esas ventas y recalcula', () => {
  const producto = {
    nombre: 'Crema 3A',
    unidades: 3,
    ingreso: 90,
    costo: 48,
    ganancia: 42,
    ventas: [
      { cliente: 'Evelyn', vendedor: 'Claudia', codigo: 'VEN1', cantidad: 1, subtotal: 30 },
      { cliente: 'Ana', vendedor: 'Claudia', codigo: 'VEN2', cantidad: 2, subtotal: 60 },
    ],
  }
  assert.deepEqual(filtrarDetalle('productos', [producto], 'crema'), [producto])
  const [soloAna] = filtrarDetalle('productos', [producto], 'ana')
  assert.equal(soloAna.ventas.length, 1)
  assert.equal(soloAna.unidades, 2)
  assert.equal(soloAna.ingreso, 60)
  assert.equal(soloAna.costo, 32)
  assert.equal(soloAna.ganancia, 28)
  assert.deepEqual(filtrarDetalle('productos', [producto], 'zzz'), [])
})
