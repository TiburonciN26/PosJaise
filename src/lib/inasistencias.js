// Aviso al agendar o abrir una cita de una clienta que ya faltó a citas anteriores (estado NO_ASISTIO). Con 2 o más se sugiere pedir
// un adelanto (si la cita ya lo tiene, solo se informa). `total` NO incluye la cita que se está viendo o editando.
export function textoInasistencias(total, { conAdelanto = false } = {}) {
  if (!total || total < 1) return null
  const base =
    total === 1 ? 'Esta clienta no asistió a 1 cita anterior.' : `Esta clienta no asistió a ${total} citas anteriores.`
  return total >= 2 && !conAdelanto ? `${base} Conviene pedirle un adelanto.` : base
}
