// Reporte de rentabilidad de Recompensas (pestaña Web → Recompensas → Rentabilidad). Lógica PURA, sin React ni Supabase.
// La cuenta la hace la base (recompensas_rentabilidad, migración 20261124000003); aquí solo se arman los periodos y se interpreta
// con honestidad: nunca se presenta un margen como completo si faltan costos, ni se comparan grupos con muestras pequeñas.

export const MUESTRA_MINIMA_COHORTE = 20

export const PERIODOS = [
  { id: '30', label: 'Últimos 30 días', dias: 30 },
  { id: '90', label: 'Últimos 90 días', dias: 90 },
  { id: '180', label: 'Últimos 6 meses', dias: 180 },
  { id: '365', label: 'Último año', dias: 365 },
]

// Fecha de hoy en Lima (YYYY-MM-DD), sin depender de la zona del navegador.
export const hoyLima = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(ahora)

export function rangoUltimosDias(dias, ahora = new Date()) {
  const hasta = hoyLima(ahora)
  const d = new Date(`${hasta}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (dias - 1))
  return { desde: d.toISOString().slice(0, 10), hasta }
}

export const porcentaje = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)} %`)

// Cobertura de costos: qué parte de las líneas vendidas tiene costo conocido.
export function coberturaCostos(margen) {
  const total = Number(margen?.lineas ?? 0)
  const conCosto = Number(margen?.lineas_con_costo ?? 0)
  const pct = total > 0 ? Math.round((conCosto / total) * 1000) / 10 : null
  let nivel = 'sin-ventas'
  if (total > 0) nivel = conCosto === 0 ? 'ninguna' : pct < 70 ? 'parcial' : 'buena'
  return { total, conCosto, sinCosto: total - conCosto, pct, nivel }
}

export function avisoCobertura(cob) {
  switch (cob.nivel) {
    case 'sin-ventas':
      return 'No hay ventas en este periodo.'
    case 'ninguna':
      return 'Todavía ninguna venta de este periodo tiene costo conocido: costea tus servicios y productos para ver el margen real.'
    case 'parcial':
      return `Solo ${cob.pct} % de las líneas vendidas tiene costo conocido: el margen mostrado es PARCIAL. Costea lo que aparece en «Sin costo».`
    default:
      return cob.sinCosto > 0
        ? `${cob.sinCosto} línea(s) sin costo conocido no entran en el margen (ver «Sin costo»).`
        : 'Todas las líneas vendidas tienen costo conocido.'
  }
}

// Las clientas del programa vs el resto solo se comparan con muestra suficiente en ambos grupos.
export function compararCohortes(cohortes = []) {
  const miembras = cohortes.find((c) => c.grupo === 'MIEMBRAS') ?? null
  const resto = cohortes.find((c) => c.grupo === 'RESTO') ?? null
  const suficiente =
    Boolean(miembras && resto) &&
    Number(miembras.clientas) >= MUESTRA_MINIMA_COHORTE &&
    Number(resto.clientas) >= MUESTRA_MINIMA_COHORTE
  return { miembras, resto, suficiente }
}

// Deuda con las clientas: monedas ganadas que aún no se canjearon (no es un gasto hasta que se canjean, pero es un compromiso).
export const hayDeudaDeMonedas = (programa) => Number(programa?.monedas_pendientes_total ?? 0) > 0
