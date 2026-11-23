import { aLima } from './fechas.js'

// Texto del WhatsApp que se le manda a la clienta para recordarle su cita y pedirle que confirme. Se abre en wa.me con el mensaje
// ya escrito; la persona del salón solo lo revisa y lo envía.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function horaLegible(fechaIso) {
  const l = aLima(new Date(fechaIso))
  const h = l.getUTCHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(l.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

export function mensajeRecordatorioCita({ nombreClienta, fechaHoraIso, servicios }) {
  const l = aLima(new Date(fechaHoraIso))
  const primerNombre = (nombreClienta ?? '').trim().split(/\s+/)[0]
  const saludo = primerNombre ? `Hola ${primerNombre}` : 'Hola'
  const dia = `${DIAS[l.getUTCDay()]} ${l.getUTCDate()} de ${MESES[l.getUTCMonth()]}`
  const detalle = servicios ? ` (${servicios})` : ''
  return [
    `${saludo}, te escribimos de Jaise Beauty Academy para recordarte tu cita del ${dia} a las ${horaLegible(fechaHoraIso)}${detalle}.`,
    '¿Nos confirmas tu asistencia? ¡Gracias!',
  ].join('\n')
}
