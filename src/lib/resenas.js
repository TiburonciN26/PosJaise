// Compartido por NosotrosCliente.jsx (muro completo) e InicioCliente.jsx
// (las 3 reseñas destacadas) — ambos consumen resenas_publicas()
// (86_resenas.sql) y aplican el mismo criterio de privacidad.

// "María López" → "María L." — el nombre completo real solo lo ve el
// admin (panel de moderación); en cualquier muro público alcanza con esto.
export function nombrePublico(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  if (partes.length < 2) return partes[0] ?? 'Clienta'
  return `${partes[0]} ${partes[1][0].toUpperCase()}.`
}
