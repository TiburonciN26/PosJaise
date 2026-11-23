// Búsqueda de la pestaña Citas. Se busca dentro de una ventana de fechas (el mes que se está viendo, un mes antes y un mes después:
// ver Citas.jsx) para que la lista no se vuelva pesada, y el texto se compara contra lo que la gente suele recordar de una cita:
// la clienta (nombre o teléfono), el servicio, la asistente y la nota. Sin distinguir mayúsculas ni tildes.

function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '')

export function coincideBusquedaCita(cita, texto) {
  const buscado = normalizar(texto).trim()
  if (!buscado) return false

  const campos = [
    cita.clientes?.nombre,
    cita.cliente_nombre_referencia,
    cita.asistentes?.nombres_completos,
    cita.nota,
    ...(cita.cita_servicios ?? []).map((cs) => cs.servicios?.nombre),
  ]
  if (campos.some((campo) => normalizar(campo).includes(buscado))) return true

  // Teléfono: solo si lo escrito tiene al menos 3 dígitos (un «1» no debe traer a media agenda) y sin importar espacios o guiones.
  const digitos = soloDigitos(texto)
  return digitos.length >= 3 && soloDigitos(cita.clientes?.telefono).includes(digitos)
}
