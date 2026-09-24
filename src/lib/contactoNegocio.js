// Helpers compartidos por SeccionContacto (NosotrosCliente.jsx) y
// PieClienteWeb.jsx (footer) — ambos consumen datos_contacto()/
// horario_atencion() (87_contacto_negocio.sql / 74_horario_atencion.sql)
// y necesitan formatear lo mismo, así que viven en un solo lugar.
const NOMBRES_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export function formatearDias(dias) {
  if (!dias || dias.length === 0) return ''
  const ordenados = [...dias].sort((a, b) => a - b)
  const esContiguo = ordenados.every((dia, i) => i === 0 || dia === ordenados[i - 1] + 1)
  if (esContiguo && ordenados.length > 1) {
    return `${NOMBRES_DIA[ordenados[0]]} a ${NOMBRES_DIA[ordenados[ordenados.length - 1]]}`
  }
  return ordenados.map((dia) => NOMBRES_DIA[dia]).join(', ')
}

export function formatearHora(horaSql) {
  if (!horaSql) return ''
  const [horas, minutos] = horaSql.split(':').map(Number)
  return new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(2000, 0, 1, horas, minutos),
  )
}

export function numeroWhatsapp(telefono) {
  const digitos = telefono.replace(/\D/g, '')
  return digitos.length === 9 ? `51${digitos}` : digitos
}
