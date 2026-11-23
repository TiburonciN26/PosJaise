// Lógica pura del selector de fecha y hora de escritorio (components/InputFechaHora.jsx). Diseño en
// docs/diseno-selector-fecha-hora/. El valor del campo sigue siendo el de un <input type="datetime-local">: 'AAAA-MM-DDTHH:mm' (hora de
// pared de Lima, 24 horas); aquí se trabaja con la fecha 'AAAA-MM-DD' y los minutos desde las 00:00.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const PASO_MIN = 30
const HORARIO_POR_DEFECTO = { inicio: 9 * 60, ultimo: 19 * 60 + 30 } // sin horario de atención cargado o día cerrado
const pad = (n) => String(n).padStart(2, '0')
const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1)

// ── Valor del campo ──
export function partirValor(valor) {
  const [fecha = '', hora = ''] = String(valor ?? '').split('T')
  const [h, m] = hora.split(':').map(Number)
  const minutos = Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : HORARIO_POR_DEFECTO.inicio
  return { fecha, minutos }
}

export function armarValor(fecha, minutos) {
  return `${fecha}T${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`
}

// ── Fechas ('AAAA-MM-DD') ──
export function claveFecha(anio, mes, dia) {
  return `${anio}-${pad(mes + 1)}-${pad(dia)}`
}

function partesFecha(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  return { anio, mes: mes - 1, dia }
}

// 0 = domingo … 6 = sábado
export function diaDeLaSemana(fecha) {
  const { anio, mes, dia } = partesFecha(fecha)
  return new Date(Date.UTC(anio, mes, dia)).getUTCDay()
}

export function resumenFechaLarga(fecha) {
  const { anio, mes, dia } = partesFecha(fecha)
  return `${mayuscula(DIAS[diaDeLaSemana(fecha)])} ${dia} de ${MESES[mes]} ${anio}`
}

export function resumenDiaCorto(fecha) {
  const { mes, dia } = partesFecha(fecha)
  return `${DIAS_CORTO[diaDeLaSemana(fecha)]} ${dia} ${MESES_CORTO[mes]}`
}

export function tituloMes(anio, mes) {
  return `${mayuscula(MESES[mes])} ${anio}`
}

export function moverMes({ anio, mes }, delta) {
  const total = anio * 12 + mes + delta
  return { anio: Math.floor(total / 12), mes: ((total % 12) + 12) % 12 }
}

// Celdas del calendario de un mes: semana desde el LUNES; `null` = hueco antes del día 1, número = día del mes.
export function celdasDelMes(anio, mes) {
  const huecos = (new Date(Date.UTC(anio, mes, 1)).getUTCDay() + 6) % 7
  const dias = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  return [...Array(huecos).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)]
}

// ── Horas ──
export function etiquetaHora(minutos) {
  const h = Math.floor(minutos / 60)
  const hora = `${h % 12 === 0 ? 12 : h % 12}:${pad(minutos % 60)}`
  const meridiano = h < 12 ? 'a. m.' : 'p. m.'
  return { hora, meridiano, texto: `${hora} ${meridiano}` }
}

const aMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Horas que se ofrecen en un día: cada 30 min desde el inicio de cada turno (la hora de cierre no se ofrece). Sin turnos (día
// cerrado o horario sin cargar): de 9:00 a. m. a 7:30 p. m. `actual` = la hora ya elegida: si no cae en la cuadrícula (p. ej. una
// cita de las 10:07) se agrega para que se vea seleccionada y no se pierda sin querer.
export function horariosDelDia(turnos, actual = null) {
  const horas = []
  if (!turnos || turnos.length === 0) {
    for (let m = HORARIO_POR_DEFECTO.inicio; m <= HORARIO_POR_DEFECTO.ultimo; m += PASO_MIN) horas.push(m)
  } else {
    for (const { inicio, fin } of turnos) {
      for (let m = aMin(inicio); m < aMin(fin); m += PASO_MIN) horas.push(m)
    }
  }
  if (actual != null && !horas.includes(actual)) horas.push(actual)
  return [...new Set(horas)].sort((a, b) => a - b)
}

const GRUPOS = [
  { titulo: 'Mañana', sub: 'a. m.', hasta: 12 * 60 },
  { titulo: 'Tarde', sub: 'p. m.', hasta: 18 * 60 },
  { titulo: 'Noche', sub: 'p. m.', hasta: Infinity },
]

// [{ titulo, sub, items: [minutos] }] solo con los grupos que tienen horas.
export function agruparHorarios(minutos) {
  return GRUPOS.map((grupo, i) => {
    const desde = i === 0 ? -Infinity : GRUPOS[i - 1].hasta
    return { titulo: grupo.titulo, sub: grupo.sub, items: minutos.filter((m) => m >= desde && m < grupo.hasta) }
  }).filter((grupo) => grupo.items.length > 0)
}

// «Otra hora»: minutos ↔ hora 1-12 + minuto + a. m./p. m. (para horas fuera de la cuadrícula de 30 min).
export function partesDeMinutos(minutos) {
  const h = Math.floor(minutos / 60)
  return { hora12: h % 12 === 0 ? 12 : h % 12, minuto: minutos % 60, ampm: h >= 12 ? 'PM' : 'AM' }
}

export function minutosDePartes({ hora12, minuto, ampm }) {
  return ((Number(hora12) % 12) + (ampm === 'PM' ? 12 : 0)) * 60 + Number(minuto)
}
