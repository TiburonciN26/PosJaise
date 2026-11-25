// Citas con varias sesiones: fechas propuestas, validación y etiquetas (src/lib/sesionesCita.js). Sin base de datos ni navegador:
//   node --test tests/e2e/sesiones-cita.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrastraSesiones,
  etiquetaSesion,
  resumenSesiones,
  sesionesFuturasPendientes,
  sesionesSiguientes,
  sumarDiasInput,
  validarSesiones,
} from '../../src/lib/sesionesCita.js'

const tratamiento = { servicioId: 's1', sesionesTotal: 3, sesionesIntervaloDias: 30 }
const normal = { servicioId: 's2' }

test('sumar días conserva la hora y cruza meses y años', () => {
  assert.equal(sumarDiasInput('2026-11-25T15:30', 30), '2026-12-25T15:30')
  assert.equal(sumarDiasInput('2026-12-20T09:00', 30), '2027-01-19T09:00')
  assert.equal(sumarDiasInput('2028-02-15T10:00', 14), '2028-02-29T10:00', 'año bisiesto')
})

test('un valor vacío o mal formado no inventa fechas', () => {
  assert.equal(sumarDiasInput('', 30), '')
  assert.equal(sumarDiasInput(undefined, 30), '')
  assert.equal(sumarDiasInput('25/11/2026', 30), '')
})

test('un servicio normal no genera sesiones siguientes', () => {
  assert.deepEqual(resumenSesiones([normal]), { total: 1, intervaloDias: 30 })
  assert.deepEqual(sesionesSiguientes({ fechaHora: '2026-11-25T15:30', lineas: [normal] }), [])
  assert.deepEqual(sesionesSiguientes({ fechaHora: '2026-11-25T15:30', lineas: [] }), [])
})

test('tratamiento de 3 sesiones cada 30 días: propone la 2 y la 3 a la misma hora', () => {
  const sesiones = sesionesSiguientes({ fechaHora: '2026-11-25T15:30', lineas: [tratamiento] })
  assert.deepEqual(sesiones.map((s) => [s.numero, s.fechaHora]), [[2, '2026-12-25T15:30'], [3, '2027-01-24T15:30']])
})

test('sin fecha de la 1.ª sesión todavía no se propone nada', () => {
  assert.deepEqual(sesionesSiguientes({ fechaHora: '', lineas: [tratamiento] }), [])
})

test('si se edita una sesión, las siguientes se acomodan a partir de ella', () => {
  const sesiones = sesionesSiguientes({
    fechaHora: '2026-11-25T15:30',
    lineas: [tratamiento],
    cambios: { 2: '2027-01-05T11:00' },
  })
  assert.equal(sesiones[0].fechaHora, '2027-01-05T11:00')
  assert.equal(sesiones[1].fechaHora, '2027-02-04T11:00')
})

test('la hora de una sesión siguiente se puede cambiar sin tocar las demás fechas manuales', () => {
  const sesiones = sesionesSiguientes({
    fechaHora: '2026-11-25T15:30',
    lineas: [tratamiento],
    cambios: { 2: '2026-12-25T10:00', 3: '2027-02-01T10:00' },
  })
  assert.deepEqual(sesiones.map((s) => s.fechaHora), ['2026-12-25T10:00', '2027-02-01T10:00'])
})

test('un servicio normal junto al tratamiento solo va en la 1.ª sesión', () => {
  const sesiones = sesionesSiguientes({ fechaHora: '2026-11-25T15:30', lineas: [normal, tratamiento] })
  for (const sesion of sesiones) assert.deepEqual(sesion.lineas, [tratamiento])
})

test('dos tratamientos con distinto número de sesiones: cada uno entra en las que le tocan', () => {
  const corto = { servicioId: 's3', sesionesTotal: 2, sesionesIntervaloDias: 15 }
  const sesiones = sesionesSiguientes({ fechaHora: '2026-11-25T15:30', lineas: [corto, tratamiento] })
  assert.equal(sesiones.length, 2)
  assert.deepEqual(sesiones[0].lineas, [corto, tratamiento])
  assert.deepEqual(sesiones[1].lineas, [tratamiento])
})

test('sin intervalo configurado se usa 30 días y el máximo es 12 sesiones', () => {
  assert.equal(resumenSesiones([{ sesionesTotal: 2 }]).intervaloDias, 30)
  assert.equal(resumenSesiones([{ sesionesTotal: 99, sesionesIntervaloDias: 7 }]).total, 12)
})

test('validar: todas con fecha y cada una después de la anterior', () => {
  const ok = [{ numero: 2, fechaHora: '2026-12-25T15:30' }, { numero: 3, fechaHora: '2027-01-24T15:30' }]
  assert.equal(validarSesiones('2026-11-25T15:30', ok), null)
  assert.match(validarSesiones('2026-11-25T15:30', [{ numero: 2, fechaHora: '' }]), /sesión 2/)
  assert.match(validarSesiones('2026-11-25T15:30', [{ numero: 2, fechaHora: '2026-11-25T15:30' }]), /después de la sesión 1/)
  assert.match(validarSesiones('2026-11-25T15:30', [{ numero: 2, fechaHora: '2027-01-01T10:00' }, { numero: 3, fechaHora: '2026-12-01T10:00' }]), /sesión 3/)
  assert.equal(validarSesiones('2026-11-25T15:30', []), null)
})

test('etiqueta de la cápsula y cuándo cancelar arrastra a las demás', () => {
  const primera = { serie_id: 'x', sesion_numero: 1, sesiones_total: 3 }
  const segunda = { serie_id: 'x', sesion_numero: 2, sesiones_total: 3 }
  assert.equal(etiquetaSesion(segunda), 'Sesión 2 de 3')
  assert.equal(etiquetaSesion({}), null)
  assert.equal(arrastraSesiones(primera), true)
  assert.equal(arrastraSesiones(segunda), false)
  assert.equal(arrastraSesiones({ sesion_numero: 1 }), false)
})

test('el aviso del mes lista las sesiones pendientes de un tratamiento (la 1 incluida), en orden de fecha', () => {
  const cita = (id, sesion, estado, fecha, serie = 's1') => ({ id, serie_id: serie, sesion_numero: sesion, sesiones_total: 3, estado, fecha_hora: fecha })
  const lista = sesionesFuturasPendientes([
    cita('a', 3, 'PENDIENTE', '2026-12-20T15:00:00Z'),
    cita('b', 2, 'PENDIENTE', '2026-12-05T15:00:00Z', 's2'),
    cita('c', 1, 'PENDIENTE', '2026-12-01T15:00:00Z'),
    cita('d', 2, 'CANCELADA', '2026-12-03T15:00:00Z'),
    cita('e', 2, 'COMPLETADA', '2026-12-04T15:00:00Z'),
    { id: 'f', serie_id: null, sesion_numero: null, estado: 'PENDIENTE', fecha_hora: '2026-12-06T15:00:00Z' },
  ])
  assert.deepEqual(lista.map((c) => c.id), ['c', 'b', 'a'])
  assert.deepEqual(sesionesFuturasPendientes(undefined), [])
})
