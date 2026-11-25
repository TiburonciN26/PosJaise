// Citas con varias sesiones (tratamientos): fechas propuestas para las sesiones siguientes. Módulo PURO (sin React ni Supabase),
// con test en tests/e2e/sesiones-cita.test.mjs. Las fechas son el valor de un <input datetime-local> en hora de Lima
// ('AAAA-MM-DDTHH:mm'); Lima no tiene horario de verano, así que sumar días a la «hora de pared» es exacto.
//
// REGLAS (migración 20261125000001): el adelanto y el descuento son solo de la 1.ª sesión; las siguientes llevan la misma clienta y
// asistente, y su fecha y hora se pueden editar; cancelar la 1.ª cancela las demás (eso lo hace el servidor).

export const INTERVALO_SESIONES_POR_DEFECTO = 30
export const MAX_SESIONES = 12

const entero = (valor) => {
  const n = parseInt(valor, 10)
  return Number.isFinite(n) ? n : 0
}

// Suma días a 'AAAA-MM-DDTHH:mm' conservando la hora. Un valor vacío o mal formado devuelve ''.
export function sumarDiasInput(valor, dias) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor ?? '')
  if (!partes) return ''
  const [, anio, mes, dia, hora, minuto] = partes.map(Number)
  const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias, hora, minuto))
  const pad = (n) => String(n).padStart(2, '0')
  return `${fecha.getUTCFullYear()}-${pad(fecha.getUTCMonth() + 1)}-${pad(fecha.getUTCDate())}T${pad(fecha.getUTCHours())}:${pad(fecha.getUTCMinutes())}`
}

// Cuántas sesiones tiene el tratamiento de este carrito y cada cuántos días se propone la siguiente. Si hay varios servicios por
// sesiones se usa el que más sesiones tiene (los demás entran solo en las sesiones que les tocan). `lineas`: [{ sesionesTotal,
// sesionesIntervaloDias }]; las líneas de servicios normales no traen esos campos (cuentan como 1).
export function resumenSesiones(lineas) {
  let total = 1
  let intervalo = INTERVALO_SESIONES_POR_DEFECTO
  for (const linea of lineas ?? []) {
    const sesiones = Math.min(MAX_SESIONES, entero(linea.sesionesTotal))
    if (sesiones > total) {
      total = sesiones
      intervalo = entero(linea.sesionesIntervaloDias) > 0 ? entero(linea.sesionesIntervaloDias) : INTERVALO_SESIONES_POR_DEFECTO
    }
  }
  return { total, intervaloDias: intervalo }
}

// Sesiones SIGUIENTES (2..N) propuestas: [{ numero, fechaHora, lineas }]. Cada fecha por defecto es la de la sesión anterior más el
// intervalo, a la misma hora; `cambios` ({ [numero]: 'AAAA-MM-DDTHH:mm' }) guarda lo que la recepcionista editó a mano, y las
// siguientes se acomodan a partir de lo editado. `lineas` de cada sesión = los servicios del carrito que tienen esa sesión
// (sesionesTotal >= numero). Sin fecha de la 1.ª sesión o sin tratamiento devuelve [].
export function sesionesSiguientes({ fechaHora, lineas, cambios = {} }) {
  const { total, intervaloDias } = resumenSesiones(lineas)
  if (total < 2 || !fechaHora) return []
  const sesiones = []
  let anterior = fechaHora
  for (let numero = 2; numero <= total; numero += 1) {
    const propia = cambios[numero]
    const fecha = propia || sumarDiasInput(anterior, intervaloDias)
    sesiones.push({
      numero,
      fechaHora: fecha,
      lineas: lineas.filter((linea) => entero(linea.sesionesTotal) >= numero),
    })
    anterior = fecha || anterior
  }
  return sesiones
}

// Mensaje de error de las sesiones siguientes o null: todas con fecha, y cada una después de la anterior (la 1.ª incluida).
export function validarSesiones(fechaHora, sesiones) {
  let anterior = fechaHora
  for (const sesion of sesiones ?? []) {
    if (!sesion.fechaHora) return `Elige la fecha y hora de la sesión ${sesion.numero}.`
    if (sesion.fechaHora <= anterior) {
      return `La sesión ${sesion.numero} debe ser después de la sesión ${sesion.numero - 1}.`
    }
    anterior = sesion.fechaHora
  }
  return null
}

// Etiqueta corta para la cápsula de la cita: «Sesión 2 de 3», o null si es una cita suelta.
export function etiquetaSesion(cita) {
  if (!cita?.serie_id || !cita.sesion_numero || !cita.sesiones_total) return null
  return `Sesión ${cita.sesion_numero} de ${cita.sesiones_total}`
}

// ¿Cancelar o reactivar esta cita arrastra a otras? Solo la 1.ª sesión de una serie.
export function arrastraSesiones(cita) {
  return Boolean(cita?.serie_id) && cita.sesion_numero === 1
}

// Citas de las que avisa la franja rosada de Citas: TODAS las sesiones de un tratamiento (la 1 incluida: es la que cae en el mes
// actual) que siguen pendientes, en orden de fecha. `citas` son las del mes que se está viendo. No entran las canceladas,
// completadas o «no asistió».
export function sesionesFuturasPendientes(citas) {
  return (citas ?? [])
    .filter((cita) => cita.serie_id && cita.sesion_numero >= 1 && cita.estado === 'PENDIENTE')
    .sort((a, b) => (a.fecha_hora < b.fecha_hora ? -1 : a.fecha_hora > b.fecha_hora ? 1 : 0))
}
