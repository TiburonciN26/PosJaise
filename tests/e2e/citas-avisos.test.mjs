import test from 'node:test'
import assert from 'node:assert/strict'
import { mensajeRecordatorioCita } from '../../src/lib/recordatorioCita.js'
import { textoInasistencias } from '../../src/lib/inasistencias.js'
import { avisoHorarioCita } from '../../src/lib/avisoHorarioCita.js'
import { normalizarSemana } from '../../src/lib/horarioAtencion.js'
import { deInputDatetimeLima } from '../../src/lib/fechas.js'

test('recordatorio de cita: saludo, día, hora, servicios y pedido de confirmación', () => {
  const texto = mensajeRecordatorioCita({
    nombreClienta: 'Aida Lopez Ruiz',
    fechaHoraIso: deInputDatetimeLima('2026-11-25T15:30').toISOString(),
    servicios: 'Corte, Tinte',
  })
  assert.ok(texto.startsWith('Hola Aida, '))
  assert.ok(texto.includes('miércoles 25 de noviembre a las 3:30 p. m. (Corte, Tinte).'))
  assert.ok(texto.endsWith('¿Nos confirmas tu asistencia? ¡Gracias!'))
  const sinNombre = mensajeRecordatorioCita({
    nombreClienta: null,
    fechaHoraIso: deInputDatetimeLima('2026-11-25T09:00').toISOString(),
    servicios: '',
  })
  assert.ok(sinNombre.startsWith('Hola, '))
  assert.ok(sinNombre.includes('a las 9:00 a. m..'))
})

test('inasistencias: sin aviso con 0; sugiere adelanto desde 2 salvo que ya lo tenga', () => {
  assert.equal(textoInasistencias(0), null)
  assert.equal(textoInasistencias(1), 'Esta clienta no asistió a 1 cita anterior.')
  assert.equal(textoInasistencias(3), 'Esta clienta no asistió a 3 citas anteriores. Conviene pedirle un adelanto.')
  assert.equal(textoInasistencias(3, { conAdelanto: true }), 'Esta clienta no asistió a 3 citas anteriores.')
})

// Lunes a viernes 10:00-13:00 y 15:00-20:00; sábado 8:00-14:00; domingo cerrado.
const filas = [1, 2, 3, 4, 5].map((dia) => ({
  dia,
  bloque1_inicio: '10:00:00',
  bloque1_fin: '13:00:00',
  bloque2_inicio: '15:00:00',
  bloque2_fin: '20:00:00',
}))
filas.push({ dia: 6, bloque1_inicio: '08:00:00', bloque1_fin: '14:00:00' })
const semana = normalizarSemana(filas)

test('aviso de horario: dentro del horario no avisa', () => {
  assert.equal(avisoHorarioCita({ fechaHora: '2026-11-25T11:00', duracionTotalMin: 60, semana }), null) // miércoles
  assert.equal(avisoHorarioCita({ fechaHora: '2026-11-28T08:00', duracionTotalMin: 30, semana }), null) // sábado
})

test('aviso de horario: día cerrado, fuera de horario y servicio que pasa del cierre', () => {
  assert.match(avisoHorarioCita({ fechaHora: '2026-11-29T11:00', semana }), /^Los domingos el salón no atiende/)
  assert.match(avisoHorarioCita({ fechaHora: '2026-11-25T14:00', semana }), /fuera del horario de atención del miércoles/) // descanso
  assert.match(avisoHorarioCita({ fechaHora: '2026-11-25T07:00', semana }), /fuera del horario/)
  assert.match(avisoHorarioCita({ fechaHora: '2026-11-25T19:30', duracionTotalMin: 60, semana }), /terminaría después del cierre/)
})

test('aviso de horario: sin horario cargado o sin días abiertos no avisa', () => {
  assert.equal(avisoHorarioCita({ fechaHora: '2026-11-29T11:00', semana: null }), null)
  assert.equal(avisoHorarioCita({ fechaHora: '2026-11-29T11:00', semana: normalizarSemana([]) }), null)
  assert.equal(avisoHorarioCita({ fechaHora: '', semana }), null)
})

// ── Aviso de choque (13) ──
import { citasQueChocan, textoChoques } from '../../src/lib/choquesCita.js'

const cita = (id, hora, minutos, nombre) => ({
  id,
  fecha_hora: deInputDatetimeLima(`2026-11-25T${hora}`).toISOString(),
  clientes: { nombre },
  cita_servicios: [{ duracion_min: minutos }],
})
const delDia = [cita('a', '10:00', 90, 'Aída'), cita('b', '14:00', 60, 'Pedro')]

test('choque: se cruza con una cita que empieza antes y sigue en curso', () => {
  const choques = citasQueChocan({ fechaHora: '2026-11-25T10:30', duracionTotalMin: 60, citas: delDia })
  assert.deepEqual(choques.map((c) => c.id), ['a'])
})

test('choque: pegada (termina justo cuando empieza la otra) no choca; antes y después tampoco', () => {
  assert.deepEqual(citasQueChocan({ fechaHora: '2026-11-25T11:30', duracionTotalMin: 30, citas: delDia }), [])
  assert.deepEqual(citasQueChocan({ fechaHora: '2026-11-25T09:00', duracionTotalMin: 60, citas: delDia }), [])
  assert.deepEqual(citasQueChocan({ fechaHora: '2026-11-25T12:00', duracionTotalMin: 120, citas: delDia }), []) // pegada a la de las 14:00
  assert.deepEqual(citasQueChocan({ fechaHora: '2026-11-25T12:00', duracionTotalMin: 150, citas: delDia }).map((c) => c.id), ['b'])
})

test('choque: varias a la vez; sin servicios cuenta 30 min; sin fecha no avisa', () => {
  const choques = citasQueChocan({ fechaHora: '2026-11-25T10:00', duracionTotalMin: 300, citas: delDia })
  assert.deepEqual(choques.map((c) => c.id), ['a', 'b'])
  assert.deepEqual(citasQueChocan({ fechaHora: '2026-11-25T10:20', duracionTotalMin: 0, citas: delDia }).map((c) => c.id), ['a'])
  assert.deepEqual(citasQueChocan({ fechaHora: '', duracionTotalMin: 30, citas: delDia }), [])
})

test('texto del choque', () => {
  const uno = citasQueChocan({ fechaHora: '2026-11-25T10:30', duracionTotalMin: 60, citas: delDia })
  assert.equal(textoChoques('Angela', uno), 'Angela ya tiene a Aída de 10:00 a. m. a 11:30 a. m. Puedes agendarla igual si es a propósito.')
  const dos = citasQueChocan({ fechaHora: '2026-11-25T10:00', duracionTotalMin: 300, citas: delDia })
  assert.ok(textoChoques('Angela', dos).includes('a Aída de 10:00 a. m. a 11:30 a. m. y a Pedro de 2:00 p. m. a 3:00 p. m.'))
  assert.equal(textoChoques('Angela', []), null)
})

// ── Hora por defecto al agendar: la apertura del día ──
import { horaSugeridaCita } from '../../src/lib/horaSugeridaCita.js'
import { aInputDatetimeLima } from '../../src/lib/fechas.js'

const semanaApertura = normalizarSemana([
  ...[1, 2, 3, 4, 5].map((dia) => ({ dia, bloque1_inicio: '10:00:00', bloque1_fin: '20:00:00' })),
  { dia: 6, bloque1_inicio: '08:00:00', bloque1_fin: '14:00:00' },
])
const sugerida = (dia, ahora) =>
  aInputDatetimeLima(horaSugeridaCita(deInputDatetimeLima(`${dia}T00:00`), semanaApertura, deInputDatetimeLima(ahora)))

test('hora por defecto: la apertura del día elegido', () => {
  assert.equal(sugerida('2026-11-25', '2026-11-23T15:00'), '2026-11-25T10:00') // miércoles
  assert.equal(sugerida('2026-11-28', '2026-11-23T15:00'), '2026-11-28T08:00') // sábado
})

test('hora por defecto: día cerrado o sin horario cargado → 9:00 a. m.', () => {
  assert.equal(sugerida('2026-11-29', '2026-11-23T15:00'), '2026-11-29T09:00') // domingo cerrado
  assert.equal(aInputDatetimeLima(horaSugeridaCita(deInputDatetimeLima('2026-11-25T00:00'), null, deInputDatetimeLima('2026-11-23T15:00'))), '2026-11-25T09:00')
})

test('hora por defecto hoy: la apertura si aún no llegó; si ya pasó, la próxima media hora', () => {
  assert.equal(sugerida('2026-11-23', '2026-11-23T07:05'), '2026-11-23T10:00')
  assert.equal(sugerida('2026-11-23', '2026-11-23T10:10'), '2026-11-23T10:30')
  assert.equal(sugerida('2026-11-23', '2026-11-23T15:30'), '2026-11-23T16:00')
  assert.equal(sugerida('2026-11-23', '2026-11-23T23:50'), '2026-11-23T23:30')
})
