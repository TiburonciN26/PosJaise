import { aLima, deInputDatetimeLima } from './fechas.js'

// Aviso de choque (no bloquea el guardado): la asistente ya tiene otra cita pendiente que se cruza con la que se está agendando.
// A propósito NO se bloquea: en un salón es normal atender a otra clienta mientras un tinte reposa.
//   · `fechaHora`: 'AAAA-MM-DDTHH:mm' en hora de Lima (el valor del campo del formulario).
//   · `duracionTotalMin`: suma de los servicios de la cita nueva (si aún no hay servicios se cuenta como 30 min).
//   · `citas`: las pendientes de esa asistente ese día, con { id, fecha_hora, cliente_nombre_referencia, clientes: { nombre },
//     cita_servicios: [{ duracion_min }] } (sin la cita que se está editando).
const DURACION_POR_DEFECTO_MIN = 30
const MIN = 60 * 1000

function horaLegible(ms) {
  const l = aLima(new Date(ms))
  const h = l.getUTCHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(l.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

export function citasQueChocan({ fechaHora, duracionTotalMin, citas }) {
  if (!fechaHora || !fechaHora.includes('T')) return []
  const inicio = deInputDatetimeLima(fechaHora).getTime()
  const fin = inicio + (duracionTotalMin > 0 ? duracionTotalMin : DURACION_POR_DEFECTO_MIN) * MIN

  return (citas ?? [])
    .map((cita) => {
      const desde = new Date(cita.fecha_hora).getTime()
      const duracion = (cita.cita_servicios ?? []).reduce((total, cs) => total + (cs.duracion_min ?? 0), 0)
      const hasta = desde + (duracion > 0 ? duracion : DURACION_POR_DEFECTO_MIN) * MIN
      return {
        id: cita.id,
        nombre: cita.clientes?.nombre ?? cita.cliente_nombre_referencia ?? 'otra clienta',
        desde,
        hasta,
      }
    })
    .filter((otra) => otra.desde < fin && inicio < otra.hasta)
    .sort((a, b) => a.desde - b.desde)
}

// «Angela ya tiene a Aída de 10:00 a. m. a 11:30 a. m. Puedes agendarla igual si es a propósito.»
export function textoChoques(nombreAsistente, choques) {
  if (!choques || choques.length === 0) return null
  const quien = nombreAsistente || 'La asistente'
  const detalle = choques
    .map((c) => `a ${c.nombre} de ${horaLegible(c.desde)} a ${horaLegible(c.hasta)}`)
    .join(' y ')
  // `detalle` ya termina en «a. m.» / «p. m.»: ese punto cierra la oración.
  return `${quien} ya tiene ${detalle} Puedes agendarla igual si es a propósito.`
}
