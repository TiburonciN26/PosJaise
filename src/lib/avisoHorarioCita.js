import { NOMBRES_DIA, textoTurnos, hayDiasAbiertos, turnosDelDia } from './horarioAtencion.js'
import { formatearHora } from './contactoNegocio.js'

// Aviso (no bloquea el guardado) cuando una cita cae fuera del horario de atención del salón. `fechaHora` = 'AAAA-MM-DDTHH:mm' en
// hora de Lima (el valor del campo del formulario); `semana` = normalizarSemana(horario_atencion_semanal()), o null si aún no cargó
// o el salón no tiene horario configurado (entonces no se avisa nada). Devuelve el texto o null.
const aMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function avisoHorarioCita({ fechaHora, duracionTotalMin = 0, semana }) {
  if (!fechaHora || !semana || !hayDiasAbiertos(semana)) return null
  const [fecha, hora] = fechaHora.split('T')
  if (!fecha || !hora) return null
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const jsDia = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
  const isodow = jsDia === 0 ? 7 : jsDia
  const nombreDia = NOMBRES_DIA[isodow]
  const turnos = turnosDelDia(semana, isodow)

  if (turnos.length === 0) {
    const plural = nombreDia.endsWith('s') ? nombreDia : `${nombreDia}s`
    return `Los ${plural.toLowerCase()} el salón no atiende según el horario de atención.`
  }

  const inicio = aMin(hora)
  const turno = turnos.find((t) => inicio >= aMin(t.inicio) && inicio < aMin(t.fin))
  if (!turno) {
    return `Esa hora queda fuera del horario de atención del ${nombreDia.toLowerCase()} (${textoTurnos(turnos)}).`
  }
  if (duracionTotalMin > 0 && inicio + duracionTotalMin > aMin(turno.fin)) {
    return `Con esa duración, el servicio terminaría después del cierre (${formatearHora(turno.fin)}).`
  }
  return null
}
