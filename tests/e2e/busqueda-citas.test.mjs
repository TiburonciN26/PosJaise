import test from 'node:test'
import assert from 'node:assert/strict'
import { coincideBusquedaCita } from '../../src/lib/busquedaCitas.js'

const cita = {
  clientes: { nombre: 'Aída López', telefono: '987 654 321' },
  cliente_nombre_referencia: null,
  asistentes: { nombres_completos: 'Angela Torres' },
  nota: 'Prefiere el turno de la tarde',
  cita_servicios: [{ servicios: { nombre: 'Laminado de cejas' } }, { servicios: { nombre: 'Corte' } }],
}

test('busca por clienta, servicio, asistente y nota, sin tildes ni mayúsculas', () => {
  assert.ok(coincideBusquedaCita(cita, 'aida'))
  assert.ok(coincideBusquedaCita(cita, 'LOPEZ'))
  assert.ok(coincideBusquedaCita(cita, 'laminado'))
  assert.ok(coincideBusquedaCita(cita, 'angela'))
  assert.ok(coincideBusquedaCita(cita, 'tarde'))
  assert.ok(!coincideBusquedaCita(cita, 'tinte'))
})

test('busca por teléfono con 3 o más dígitos, ignorando espacios y guiones', () => {
  assert.ok(coincideBusquedaCita(cita, '987654'))
  assert.ok(coincideBusquedaCita(cita, '987-654-321'))
  assert.ok(coincideBusquedaCita(cita, '321'))
  assert.ok(!coincideBusquedaCita(cita, '98')) // muy corto
  assert.ok(!coincideBusquedaCita(cita, '111'))
})

test('cita sin clienta registrada: usa el nombre de referencia; texto vacío no coincide', () => {
  const sinFicha = { clientes: null, cliente_nombre_referencia: 'Pedrito', cita_servicios: [] }
  assert.ok(coincideBusquedaCita(sinFicha, 'pedri'))
  assert.ok(!coincideBusquedaCita(sinFicha, '   '))
  assert.ok(!coincideBusquedaCita(sinFicha, '987'))
})
