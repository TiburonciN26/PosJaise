// Edad de una clienta a partir de su cumpleaños (columna date 'YYYY-MM-DD'), siempre contra el día de hoy en Lima
// (no el del dispositivo, ver fechas.js). La usan el formulario de cliente (edad calculada al elegir la fecha) y el perfil
// (Datos personales), para que los dos den el mismo número.
import { formatearFechaISO } from './fechas.js'

// Años cumplidos a hoy. null si no hay fecha, si es futura o si da una edad imposible (fecha mal tipeada).
export function edad(cumpleanosIso, hoyIso = formatearFechaISO(new Date())) {
  if (!cumpleanosIso || !/^\d{4}-\d{2}-\d{2}$/.test(cumpleanosIso)) return null
  const [anio, mes, dia] = cumpleanosIso.split('-').map(Number)
  const [anioHoy, mesHoy, diaHoy] = hoyIso.split('-').map(Number)
  let anios = anioHoy - anio
  if (mesHoy < mes || (mesHoy === mes && diaHoy < dia)) anios -= 1
  return anios >= 0 && anios < 120 ? anios : null
}
