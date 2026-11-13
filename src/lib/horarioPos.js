import { aLima } from './fechas.js'
import { formatearHora } from './contactoNegocio.js'
import { NOMBRES_DIA } from './horarioAtencion.js'

// Apertura y cierre AUTOMÁTICO del negocio para el personal del POS (horario_pos, migración 20261112000005). Distinto
// del horario de atención de la web (horarioAtencion.js): este decide cuándo el interruptor «Negocio abierto» se
// prende y se apaga solo (lo aplica el servidor con pg_cron cada minuto).

// Filas de horario_pos_config() → { automatico, dias: [{ dia, turnos: [{ inicio, fin }] }] } con los 7 días ordenados;
// mismo formato que el horario web (horarioAtencion.js), así ambos usan el mismo editor (EditorTurnosSemana).
export function normalizarHorarioPos(filas) {
  const porDia = new Map((filas ?? []).map((fila) => [Number(fila.dia), fila]))
  const automatico = Boolean(filas?.[0]?.automatico)
  const dias = Array.from({ length: 7 }, (_, i) => {
    const fila = porDia.get(i + 1)
    const turnos = []
    if (fila?.apertura && fila?.cierre) {
      turnos.push({ inicio: fila.apertura.slice(0, 5), fin: fila.cierre.slice(0, 5) })
      if (fila.apertura2 && fila.cierre2) turnos.push({ inicio: fila.apertura2.slice(0, 5), fin: fila.cierre2.slice(0, 5) })
    }
    return { dia: i + 1, turnos }
  })
  return { automatico, dias }
}

function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

// Próximo evento programado después de `ahora` (hora de Lima): { abrir, dia, hora, enDias } o null si el modo automático
// está apagado o ningún día tiene horario. `enDias` = 0 hoy, 1 mañana, … Con `soloAbrir` true/false busca solo
// aperturas o solo cierres (p. ej. «si cierro ahora a mano, ¿cuándo se vuelve a abrir solo?»).
export function proximoEventoPos(config, ahora = new Date(), { soloAbrir } = {}) {
  if (!config?.automatico) return null
  const lima = aLima(ahora)
  const diaSemanaHoy = lima.getUTCDay() === 0 ? 7 : lima.getUTCDay()
  const minutosAhora = lima.getUTCHours() * 60 + lima.getUTCMinutes()
  for (let enDias = 0; enDias <= 7; enDias += 1) {
    const dia = ((diaSemanaHoy - 1 + enDias) % 7) + 1
    const turnos = config.dias.find((d) => d.dia === dia)?.turnos ?? []
    // Cada horario aporta dos eventos: abre al inicio y cierra al fin (con dos horarios, cierra en el descanso).
    for (const [hora, abrir] of turnos.flatMap((t) => [[t.inicio, true], [t.fin, false]])) {
      if (enDias === 0 && aMinutos(hora) <= minutosAhora) continue
      if (soloAbrir !== undefined && abrir !== soloAbrir) continue
      return { abrir, dia, hora, enDias }
    }
  }
  return null
}

// «Cierra automáticamente hoy a las 8:30 p. m.» / «Abre automáticamente mañana a las 10:00 a. m.» / «… el lunes …».
export function textoProximoEvento(evento) {
  if (!evento) return ''
  const cuando = evento.enDias === 0 ? 'hoy' : evento.enDias === 1 ? 'mañana' : `el ${NOMBRES_DIA[evento.dia].toLowerCase()}`
  return `${evento.abrir ? 'Abre' : 'Cierra'} automáticamente ${cuando} a las ${formatearHora(evento.hora)}`
}
