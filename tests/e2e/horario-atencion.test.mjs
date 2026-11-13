// Lógica pura del horario de atención por día (src/lib/horarioAtencion.js). Sin base de datos ni navegador:
//   node --test tests/e2e/horario-atencion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparHorario,
  hayDiasAbiertos,
  horasDelDia,
  normalizarSemana,
  textoHorarioEnLinea,
  turnosDelDia,
} from '../../src/lib/horarioAtencion.js';
import { formatearHora } from '../../src/lib/contactoNegocio.js';

const fila = (dia, b1i = null, b1f = null, b2i = null, b2f = null) => ({
  dia,
  bloque1_inicio: b1i,
  bloque1_fin: b1f,
  bloque2_inicio: b2i,
  bloque2_fin: b2f,
});

// Lunes a viernes doble turno, sábado un turno, domingo cerrado (como lo devuelve horario_atencion_semanal()).
const FILAS = [
  ...[1, 2, 3, 4, 5].map((d) => fila(d, '10:00:00', '13:00:00', '15:00:00', '20:30:00')),
  fila(6, '10:00:00', '14:00:00'),
  fila(7),
];

test('normalizarSemana: siempre 7 días ordenados; cerrado = sin turnos; horas sin segundos', () => {
  const semana = normalizarSemana([...FILAS].reverse());
  assert.deepEqual(semana.map((d) => d.dia), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(semana[0].turnos, [{ inicio: '10:00', fin: '13:00' }, { inicio: '15:00', fin: '20:30' }]);
  assert.deepEqual(semana[5].turnos, [{ inicio: '10:00', fin: '14:00' }]);
  assert.deepEqual(semana[6].turnos, []);
  // Sin filas (lectura fallida o tabla vacía): 7 días cerrados.
  assert.equal(hayDiasAbiertos(normalizarSemana(null)), false);
  assert.equal(hayDiasAbiertos(semana), true);
});

test('agruparHorario: junta los días con los mismos turnos y omite los cerrados', () => {
  const grupos = agruparHorario(normalizarSemana(FILAS));
  assert.deepEqual(grupos.map((g) => g.dias), ['Lunes a Viernes', 'Sábado']);
  assert.equal(grupos[0].turnos.length, 2);
  // Días no seguidos con el mismo horario: se listan con comas.
  const sueltos = agruparHorario(normalizarSemana([fila(1, '09:00', '12:00'), fila(3, '09:00', '12:00'), fila(5, '16:00', '19:00')]));
  assert.deepEqual(sueltos.map((g) => g.dias), ['Lunes, Miércoles', 'Viernes']);
});

test('textoHorarioEnLinea: todos los turnos de cada grupo, grupos separados por «·»', () => {
  const texto = textoHorarioEnLinea(normalizarSemana(FILAS));
  const h = formatearHora;
  assert.equal(
    texto,
    `Lunes a Viernes ${h('10:00')}-${h('13:00')} y ${h('15:00')}-${h('20:30')} · Sábado ${h('10:00')}-${h('14:00')}`,
  );
});

test('turnosDelDia / horasDelDia: horas en punto de cada turno, sin la hora de cierre', () => {
  const semana = normalizarSemana(FILAS);
  assert.deepEqual(turnosDelDia(semana, 7), []);
  assert.deepEqual(turnosDelDia(null, 1), []);
  assert.deepEqual(horasDelDia(turnosDelDia(semana, 6)), ['10:00', '11:00', '12:00', '13:00']);
  assert.deepEqual(horasDelDia(turnosDelDia(semana, 1)), [
    '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00',
  ]);
  assert.deepEqual(horasDelDia([{ inicio: '09:30', fin: '11:00' }], 30), ['09:30', '10:00', '10:30']);
});

// ---- Apertura/cierre automático del POS (src/lib/horarioPos.js) ----
import { normalizarHorarioPos, proximoEventoPos, textoProximoEvento } from '../../src/lib/horarioPos.js';

// Lunes a viernes 10:00-20:30, sábado 10:00-14:00, domingo no abre (como lo devuelve horario_pos_config()).
const FILAS_POS = [
  ...[1, 2, 3, 4, 5].map((dia) => ({ dia, apertura: '10:00:00', cierre: '20:30:00', apertura2: null, cierre2: null, automatico: true })),
  { dia: 6, apertura: '10:00:00', cierre: '14:00:00', apertura2: null, cierre2: null, automatico: true },
  { dia: 7, apertura: null, cierre: null, apertura2: null, cierre2: null, automatico: true },
];
// Hora de Lima = UTC − 5 (Perú no tiene horario de verano). 2026-11-12 es jueves.
const enLima = (fecha, hora) => new Date(`${fecha}T${hora}:00-05:00`);

test('proximoEventoPos: hoy cierra, mañana abre, salta los días que no abren', () => {
  const config = normalizarHorarioPos(FILAS_POS);
  assert.equal(config.automatico, true);
  assert.deepEqual(config.dias[6], { dia: 7, turnos: [] });
  assert.deepEqual(config.dias[0], { dia: 1, turnos: [{ inicio: '10:00', fin: '20:30' }] });
  // Jueves 15:55 → cierra hoy 20:30.
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '15:55')), { abrir: false, dia: 4, hora: '20:30', enDias: 0 });
  // Jueves 08:00 → abre hoy 10:00; jueves 21:00 → abre mañana (viernes) 10:00.
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '08:00')), { abrir: true, dia: 4, hora: '10:00', enDias: 0 });
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '21:00')), { abrir: true, dia: 5, hora: '10:00', enDias: 1 });
  // Sábado 15:00 → el domingo no abre: abre el lunes (en 2 días).
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-14', '15:00')), { abrir: true, dia: 1, hora: '10:00', enDias: 2 });
  // Justo a la hora del evento ya no cuenta como «próximo».
  assert.equal(proximoEventoPos(config, enLima('2026-11-12', '20:30')).abrir, true);
});

test('proximoEventoPos: filtro solo aperturas / solo cierres, y apagado = null', () => {
  const config = normalizarHorarioPos(FILAS_POS);
  // Jueves 15:55, la admin cierra a mano: ¿cuándo vuelve a abrir solo? Mañana 10:00 (el cierre de hoy no cuenta).
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '15:55'), { soloAbrir: true }), { abrir: true, dia: 5, hora: '10:00', enDias: 1 });
  // Domingo 12:00, la admin abre a mano: se cierra solo el lunes 20:30.
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-15', '12:00'), { soloAbrir: false }), { abrir: false, dia: 1, hora: '20:30', enDias: 1 });
  assert.equal(proximoEventoPos({ ...config, automatico: false }, enLima('2026-11-12', '15:55')), null);
  assert.equal(proximoEventoPos(normalizarHorarioPos([]), new Date()), null);
});

test('textoProximoEvento: hoy / mañana / el día de la semana', () => {
  assert.equal(textoProximoEvento(null), '');
  assert.equal(textoProximoEvento({ abrir: false, dia: 4, hora: '20:30', enDias: 0 }), `Cierra automáticamente hoy a las ${formatearHora('20:30')}`);
  assert.equal(textoProximoEvento({ abrir: true, dia: 5, hora: '10:00', enDias: 1 }), `Abre automáticamente mañana a las ${formatearHora('10:00')}`);
  assert.equal(textoProximoEvento({ abrir: true, dia: 1, hora: '10:00', enDias: 2 }), `Abre automáticamente el lunes a las ${formatearHora('10:00')}`);
});

test('proximoEventoPos con dos horarios: cierra en el descanso y vuelve a abrir', () => {
  const filas = FILAS_POS.map((f) => (f.dia === 4 ? { ...f, cierre: '13:00:00', apertura2: '15:00:00', cierre2: '20:30:00' } : f));
  const config = normalizarHorarioPos(filas);
  assert.deepEqual(config.dias[3].turnos, [{ inicio: '10:00', fin: '13:00' }, { inicio: '15:00', fin: '20:30' }]);
  // Jueves 12:00 → cierra hoy 13:00; 14:00 (descanso) → abre hoy 15:00; 16:00 → cierra hoy 20:30.
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '12:00')), { abrir: false, dia: 4, hora: '13:00', enDias: 0 });
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '14:00')), { abrir: true, dia: 4, hora: '15:00', enDias: 0 });
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '16:00')), { abrir: false, dia: 4, hora: '20:30', enDias: 0 });
  // La admin abre a mano en el descanso (14:00): el horario lo cierra hoy a las 20:30.
  assert.deepEqual(proximoEventoPos(config, enLima('2026-11-12', '14:00'), { soloAbrir: false }), { abrir: false, dia: 4, hora: '20:30', enDias: 0 });
});

// ---- Estado del editor compartido (src/lib/turnosSemana.js) ----
import { estadoInicialTurnos, turnosAGuardar, validarTurnos } from '../../src/lib/turnosSemana.js';

test('estadoInicialTurnos / validarTurnos: mismos mensajes que el servidor', () => {
  const dias = estadoInicialTurnos(normalizarSemana(FILAS));
  // El domingo (cerrado) queda apagado pero con la propuesta del primer día que abre.
  assert.equal(dias[6].activo, false);
  assert.equal(dias[6].turnos.length, 2);
  assert.deepEqual(turnosAGuardar(dias[6]), []);
  assert.equal(validarTurnos(dias), null);
  const conError = (dia, turnos) => validarTurnos(dias.map((d) => (d.dia === dia ? { ...d, turnos } : d)));
  assert.deepEqual(conError(2, [{ inicio: '13:00', fin: '10:00' }]), { dia: 2, mensaje: 'Martes: el primer turno debe terminar después de empezar.' });
  assert.equal(
    conError(3, [{ inicio: '10:00', fin: '13:00' }, { inicio: '12:00', fin: '20:00' }]).mensaje,
    'Miércoles: el segundo turno debe empezar después de que termine el primero.',
  );
  // Un día apagado no se valida.
  assert.equal(validarTurnos(dias.map((d) => (d.dia === 7 ? { ...d, turnos: [{ inicio: '13:00', fin: '10:00' }] } : d))), null);
});
