import { NOMBRES_DIA } from './horarioAtencion.js'

// Estado del editor de la semana (EditorTurnosSemana.jsx): [{ dia, activo, turnos: [{ inicio, fin }] }] con horas
// "HH:MM" (24 h). Lo usan ModalHorarioAtencion (web) y ModalHorarioPos (apertura/cierre del POS). Las validaciones y
// mensajes son los mismos que en guardar_horario_atencion() y guardar_horario_pos().

const TURNO_POR_DEFECTO = { inicio: '10:00', fin: '20:30' }

// semana: [{ dia, turnos }] (normalizada). Un día sin turnos queda apagado pero con los turnos del primer día que abre,
// para que al prenderlo ya tenga una propuesta (y si se apaga y se vuelve a prender antes de guardar, reaparecen).
export function estadoInicialTurnos(semana) {
  const primero = semana.find((d) => d.turnos.length > 0)?.turnos ?? [TURNO_POR_DEFECTO]
  return semana.map(({ dia, turnos }) => ({
    dia,
    activo: turnos.length > 0,
    turnos: (turnos.length > 0 ? turnos : primero).map((t) => ({ ...t })),
  }))
}

// Devuelve { dia, mensaje } del primer error, o null.
export function validarTurnos(dias) {
  for (const { dia, activo, turnos } of dias) {
    if (!activo) continue
    const nombre = NOMBRES_DIA[dia]
    const [t1, t2] = turnos
    if (!t1?.inicio || !t1?.fin) return { dia, mensaje: `${nombre}: completa el inicio y el fin del primer turno.` }
    if (t1.inicio >= t1.fin) return { dia, mensaje: `${nombre}: el primer turno debe terminar después de empezar.` }
    if (t2) {
      if (!t2.inicio || !t2.fin) return { dia, mensaje: `${nombre}: completa el inicio y el fin del segundo turno.` }
      if (t2.inicio <= t1.fin) {
        return { dia, mensaje: `${nombre}: el segundo turno debe empezar después de que termine el primero.` }
      }
      if (t2.inicio >= t2.fin) return { dia, mensaje: `${nombre}: el segundo turno debe terminar después de empezar.` }
    }
  }
  return null
}

// Los turnos que se guardan por día ([] si el día está apagado).
export const turnosAGuardar = ({ activo, turnos }) => (activo ? turnos : [])
