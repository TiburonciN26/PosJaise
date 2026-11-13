// Colores de las tarjetas de cita (pestaña Citas del POS) según el rol de quien la agendó (citas.creado_por), más un color
// propio para las citas que agenda la clienta desde la Web. Los valores viven en la tabla colores_citas_rol
// (migración 20261112000009) y solo la administradora los cambia, con guardar_colores_citas().

import { ETIQUETA_ROL } from './personal.js'

export const CLAVES_COLOR_CITA = [
  { clave: 'ADMINISTRADOR', label: ETIQUETA_ROL.ADMINISTRADOR },
  { clave: 'ENCARGADA', label: ETIQUETA_ROL.ENCARGADA },
  { clave: 'CAJERA', label: ETIQUETA_ROL.CAJERA },
  { clave: 'ASISTENTE', label: ETIQUETA_ROL.ASISTENTE },
  { clave: 'PERSONAL_APOYO', label: ETIQUETA_ROL.PERSONAL_APOYO },
  { clave: 'CLIENTE_WEB', label: 'Cliente Web' },
]

export const REGEX_COLOR = /^#[0-9A-Fa-f]{6}$/

// Color (#RRGGBB) que le toca a una cita, o null si no hay forma de saberlo (p. ej. quien la agendó ya no existe).
export function colorDeCita(cita, rolPorUsuario, colores) {
  const clave = cita.creado_por_cliente_web_id ? 'CLIENTE_WEB' : rolPorUsuario.get(cita.creado_por)
  return (clave && colores[clave]) || null
}

// Mismo tratamiento que el día seleccionado del calendario: borde del color y fondo del mismo color muy suave
// (sufijo alfa en hex: 80 ≈ 50 %, 24 ≈ 14 %), para que el texto siga legible sobre el tema oscuro.
export function estiloTarjetaCita(color) {
  if (!color) return undefined
  return { borderColor: `${color}80`, backgroundColor: `${color}24` }
}
