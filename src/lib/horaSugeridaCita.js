import { aLima, deInputDatetimeLima } from './fechas.js'
import { turnosDelDia } from './horarioAtencion.js'

// Hora con la que se abre «Nueva cita» para un día: la APERTURA de ese día según el horario de atención (9:00 a. m. si no hay horario
// cargado o el día está cerrado). Si el día es hoy y la apertura ya pasó, la próxima media hora (10:10 → 10:30), para no proponer una
// hora que ya no se puede agendar. Antes proponía la hora de pared del día seleccionado en el calendario (a menudo las 12:00 a. m.).
// `dia`: cualquier instante de ese día; `semana` = normalizarSemana(horario_atencion_semanal()) o null. Devuelve el instante UTC.
const PASO_MIN = 30
const APERTURA_POR_DEFECTO = '09:00'
const ULTIMA_HORA_MIN = 23 * 60 + 30

const pad = (n) => String(n).padStart(2, '0')
const aMinutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function horaSugeridaCita(dia, semana, ahora = new Date()) {
  const lima = aLima(dia)
  const fecha = `${lima.getUTCFullYear()}-${pad(lima.getUTCMonth() + 1)}-${pad(lima.getUTCDate())}`
  const isodow = lima.getUTCDay() === 0 ? 7 : lima.getUTCDay()
  let minutos = aMinutos(turnosDelDia(semana, isodow)[0]?.inicio ?? APERTURA_POR_DEFECTO)

  const limaAhora = aLima(ahora)
  const esHoy =
    limaAhora.getUTCFullYear() === lima.getUTCFullYear() &&
    limaAhora.getUTCMonth() === lima.getUTCMonth() &&
    limaAhora.getUTCDate() === lima.getUTCDate()
  if (esHoy) {
    const enMinutos = limaAhora.getUTCHours() * 60 + limaAhora.getUTCMinutes()
    const siguiente = Math.min(ULTIMA_HORA_MIN, Math.ceil((enMinutos + 1) / PASO_MIN) * PASO_MIN)
    minutos = Math.max(minutos, siguiente)
  }
  return deInputDatetimeLima(`${fecha}T${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`)
}
