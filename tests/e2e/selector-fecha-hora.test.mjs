import test from 'node:test'
import assert from 'node:assert/strict'
import {
  partirValor,
  armarValor,
  claveFecha,
  diaDeLaSemana,
  resumenFechaLarga,
  resumenDiaCorto,
  tituloMes,
  moverMes,
  celdasDelMes,
  etiquetaHora,
  horariosDelDia,
  agruparHorarios,
  partesDeMinutos,
  minutosDePartes,
} from '../../src/lib/selectorFechaHora.js'

test('valor del campo: partir y armar', () => {
  assert.deepEqual(partirValor('2026-11-22T09:00'), { fecha: '2026-11-22', minutos: 540 })
  assert.deepEqual(partirValor('2026-11-22T21:46'), { fecha: '2026-11-22', minutos: 21 * 60 + 46 })
  assert.deepEqual(partirValor(''), { fecha: '', minutos: 540 })
  assert.equal(armarValor('2026-11-22', 540), '2026-11-22T09:00')
  assert.equal(armarValor('2026-11-22', 19 * 60 + 30), '2026-11-22T19:30')
  assert.equal(claveFecha(2026, 10, 5), '2026-11-05')
})

test('textos de fecha en español', () => {
  assert.equal(diaDeLaSemana('2026-11-22'), 0) // domingo
  assert.equal(resumenFechaLarga('2026-11-22'), 'Domingo 22 de noviembre 2026')
  assert.equal(resumenFechaLarga('2026-12-02'), 'Miércoles 2 de diciembre 2026')
  assert.equal(resumenDiaCorto('2026-11-22'), 'Dom 22 nov')
  assert.equal(tituloMes(2026, 10), 'Noviembre 2026')
})

test('calendario: semana desde el lunes, huecos y cambio de mes', () => {
  // Noviembre 2026 empieza en domingo → 6 huecos y 30 días.
  const nov = celdasDelMes(2026, 10)
  assert.equal(nov.filter((c) => c === null).length, 6)
  assert.equal(nov.length, 36)
  assert.equal(nov[6], 1)
  assert.equal(nov.at(-1), 30)
  // Junio 2026 empieza en lunes → sin huecos.
  assert.equal(celdasDelMes(2026, 5)[0], 1)
  // Febrero bisiesto.
  assert.equal(celdasDelMes(2028, 1).filter((c) => c !== null).length, 29)
  assert.deepEqual(moverMes({ anio: 2026, mes: 11 }, 1), { anio: 2027, mes: 0 })
  assert.deepEqual(moverMes({ anio: 2026, mes: 0 }, -1), { anio: 2025, mes: 11 })
})

test('horas: etiquetas con a. m. / p. m.', () => {
  assert.equal(etiquetaHora(0).texto, '12:00 a. m.')
  assert.equal(etiquetaHora(9 * 60).texto, '9:00 a. m.')
  assert.equal(etiquetaHora(12 * 60 + 30).texto, '12:30 p. m.')
  assert.equal(etiquetaHora(19 * 60 + 30).texto, '7:30 p. m.')
  assert.equal(etiquetaHora(19 * 60 + 30).hora, '7:30')
})

test('horarios del día: salen de los turnos, cada 30 min, sin la hora de cierre', () => {
  const turnos = [{ inicio: '10:00', fin: '13:00' }, { inicio: '15:00', fin: '17:00' }]
  assert.deepEqual(horariosDelDia(turnos), [600, 630, 660, 690, 720, 750, 900, 930, 960, 990])
})

test('horarios del día: sin turnos, de 9:00 a. m. a 7:30 p. m.; la hora actual fuera de la cuadrícula se conserva', () => {
  const porDefecto = horariosDelDia([])
  assert.equal(porDefecto[0], 540)
  assert.equal(porDefecto.at(-1), 19 * 60 + 30)
  assert.equal(porDefecto.length, 22)
  const conActual = horariosDelDia([{ inicio: '10:00', fin: '12:00' }], 10 * 60 + 7)
  assert.deepEqual(conActual, [600, 607, 630, 660, 690])
  assert.deepEqual(horariosDelDia([{ inicio: '10:00', fin: '12:00' }], 630), [600, 630, 660, 690]) // ya está: no se duplica
})

test('grupos Mañana / Tarde / Noche', () => {
  const grupos = agruparHorarios(horariosDelDia([]))
  assert.deepEqual(grupos.map((g) => [g.titulo, g.items.length]), [['Mañana', 6], ['Tarde', 12], ['Noche', 4]])
  assert.deepEqual(agruparHorarios([600, 630]).map((g) => g.titulo), ['Mañana']) // los grupos vacíos no salen
  assert.deepEqual(agruparHorarios([17 * 60 + 30, 18 * 60]).map((g) => g.titulo), ['Tarde', 'Noche'])
})

test('otra hora: minutos ↔ hora 1-12, minuto y a. m./p. m.', () => {
  assert.deepEqual(partesDeMinutos(0), { hora12: 12, minuto: 0, ampm: 'AM' })
  assert.deepEqual(partesDeMinutos(12 * 60 + 15), { hora12: 12, minuto: 15, ampm: 'PM' })
  assert.deepEqual(partesDeMinutos(21 * 60 + 46), { hora12: 9, minuto: 46, ampm: 'PM' })
  for (let m = 0; m < 1440; m += 1) assert.equal(minutosDePartes(partesDeMinutos(m)), m)
})
