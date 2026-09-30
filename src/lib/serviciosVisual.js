// Ayudas visuales compartidas por Servicios y Detalle del servicio (ver
// docs/diseno-servicios/README.md) — nada de esto es dato real de negocio,
// solo presentación.

// Paletas de respaldo para servicios sin foto: variadas por categoría e id
// (mismo criterio que el lienzo aprobado), en vez de un ícono gris plano.
const PALETAS = [
  ['#c9a27e', '#1d1712', '#4a3526', '#a9c6ec'],
  ['#ff85a1', '#2b1a2a', '#6b3a5c', '#a9c6ec'],
  ['#a9c6ec', '#141c2b', '#33466b', '#ff85a1'],
  ['#cfe0f6', '#1b2530', '#4d6f8f', '#ff85a1'],
]

function hashTexto(texto) {
  let hash = 0
  for (let i = 0; i < texto.length; i += 1) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0
  return hash
}

// `servicios.id` es uuid, no un entero secuencial (bug real: la primera
// versión de esta función hacía `id * 29`, que con un uuid da NaN y
// rompe el gradiente entero) — se hashea el string del id para seguir
// variando la posición/ángulo de forma estable por servicio.
export function degradadoServicio(servicio) {
  const paleta = PALETAS[hashTexto(servicio.categoria ?? '') % PALETAS.length]
  const hashId = hashTexto(String(servicio.id ?? ''))
  const x = 15 + (hashId % 70)
  const y = 10 + (Math.floor(hashId / 7) % 75)
  const ang = 120 + (Math.floor(hashId / 11) % 90)
  return (
    `radial-gradient(110% 90% at ${x}% ${y}%, ${paleta[0]} 0%, transparent 55%), ` +
    `linear-gradient(${ang}deg, ${paleta[1]}, ${paleta[2]} 65%, ${paleta[3]} 140%)`
  )
}

// "180" → "3 h aprox."; "45" → "45 min"; "90" → "1 h 30 min".
export function formatearDuracion(minutos) {
  if (!minutos) return null
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  if (resto === 0) return `${horas} h aprox.`
  return `${horas} h ${resto} min`
}
