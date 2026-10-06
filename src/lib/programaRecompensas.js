// Reglas del programa de Recompensas tal como las ve la clienta en el portal (Citas, detalle de servicio y de producto, carrito de
// servicios, Inicio y «Cómo funciona»). Funciones PURAS: sin React ni red, para poder comprobarlas con node:test.
//
// Principio: las tasas, umbrales y cifras de sellos salen SIEMPRE de la configuración vigente (recompensas_reglas_publicas()). Nunca
// hay valores por omisión: si la configuración no se pudo leer o no es utilizable, estas funciones devuelven null/vacío y la pantalla
// muestra un aviso, no una tasa inventada. Con el programa apagado no se anuncia ninguna regla del programa nuevo.

const NUM = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
const NUM_TASA = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 })
export const formatearCantidad = (n) => NUM.format(Number(n))
const formatearTasa = (n) => NUM_TASA.format(Number(n))

const positivo = (v) => Number.isFinite(v) && v > 0

// Normaliza la fila de recompensas_reglas_publicas(). Devuelve:
//   null                      → sin datos o no utilizable (la pantalla lo trata como error de carga),
//   { activo: false }         → programa apagado (sin reglas que anunciar),
//   { activo: true, ...reglas } → programa activo con todas las cifras válidas.
export function normalizarReglas(fila) {
  if (!fila || typeof fila.activo !== 'boolean') return null
  if (!fila.activo) return { activo: false }
  const n = (v) => (v === null || v === undefined ? Number.NaN : Number(v))
  const r = {
    tasaServ: { monedas: n(fila.tasa_serv_monedas), soles: n(fila.tasa_serv_soles) },
    tasaProd: { monedas: n(fila.tasa_prod_monedas), soles: n(fila.tasa_prod_soles) },
    umbralPremium: n(fila.umbral_premium),
    umbralVip: n(fila.umbral_vip),
    sellosMax: n(fila.sellos_max),
    sellosPorPremio: n(fila.sellos_por_premio),
  }
  const valido =
    positivo(r.tasaServ.monedas) && positivo(r.tasaServ.soles) && positivo(r.tasaProd.monedas) && positivo(r.tasaProd.soles) &&
    positivo(r.umbralPremium) && positivo(r.umbralVip) && r.umbralVip > r.umbralPremium &&
    Number.isInteger(r.sellosMax) && r.sellosMax >= 1 && Number.isInteger(r.sellosPorPremio) && r.sellosPorPremio >= 1
  return valido ? { activo: true, ...r } : null
}

// «5 monedas por cada S/ 20».
export function textoTasa({ monedas, soles }) {
  return `${formatearTasa(monedas)} ${Number(monedas) === 1 ? 'moneda' : 'monedas'} por cada S/ ${formatearTasa(soles)}`
}

// Monedas que daría una compra: importe neto × monedas / soles, igual que el servidor al confirmar la venta. Es una ESTIMACIÓN: el
// servidor calcula sobre el importe final (después de descuentos y cupones). Nunca negativa.
export function estimarMonedas(reglas, { servicios = 0, productos = 0 } = {}) {
  if (!reglas?.activo) return null
  const s = Math.max(0, Number(servicios) || 0)
  const p = Math.max(0, Number(productos) || 0)
  return (s * reglas.tasaServ.monedas) / reglas.tasaServ.soles + (p * reglas.tasaProd.monedas) / reglas.tasaProd.soles
}

// «≈ 25 monedas» (hasta 2 decimales; una cifra menor a 0.01 no se redondea a 0).
export function textoMonedasEstimadas(valor) {
  const v = Number(valor)
  if (!Number.isFinite(v) || v < 0) return null
  if (v > 0 && v < 0.01) return '≈ menos de 0.01 monedas'
  return `≈ ${formatearCantidad(v)} ${formatearCantidad(v) === '1' ? 'moneda' : 'monedas'}`
}

// Avance de nivel por CLASIFICACIÓN (no por monedas gastables). `pct` es el avance dentro del nivel actual; `faltan` son los puntos de
// clasificación que faltan para el siguiente nivel (0 en VIP).
export function avanceNivel({ nivel, clasificacion, umbralPremium, umbralVip }) {
  const c = Number(clasificacion)
  const premium = Number(umbralPremium)
  const vip = Number(umbralVip)
  let piso = 0
  let techo = premium
  let siguiente = 'Premium'
  if (nivel === 'PREMIUM') { piso = premium; techo = vip; siguiente = 'VIP' }
  else if (nivel === 'VIP') { piso = vip; techo = vip; siguiente = null }
  const pct = techo > piso ? Math.min(100, Math.max(0, ((c - piso) / (techo - piso)) * 100)) : 100
  return { pct, faltan: siguiente ? Math.max(0, Math.ceil(techo - c)) : 0, siguiente }
}

// Posición del sello en la tarjeta actual (también con saldo negativo, que nunca se trunca).
export function tarjetaDeSellos(sellos, porPremio) {
  const s = Number(sellos)
  const p = Number(porPremio)
  const enTarjeta = ((s % p) + p) % p
  return { enTarjeta, completa: s > 0 && enTarjeta === 0, faltan: s < 0 ? null : p - enTarjeta, negativo: s < 0, porRecuperar: s < 0 ? Math.abs(s) : 0 }
}

// Texto de las reglas de sellos con las cifras vigentes.
export function reglaSellos({ sellosMax, sellosPorPremio }) {
  return (
    'Un sello por día de Perú cuando una venta confirmada incluye servicios, venga o no de una cita web. ' +
    `Los productos solos no dan sello. Acumulas hasta ${sellosMax} sellos y cada premio cuesta ${sellosPorPremio}.`
  )
}

// Estimado que se anuncia ANTES de comprar (detalle de servicio / producto, carrito de servicios). Devuelve el texto de los dos
// recuadros («monedas» y «sello») para el estado de carga del programa:
//   programa = { estado: 'cargando' | 'ok' | 'error', activo: boolean | null, reglas: normalizarReglas(...) | null }
//   legacy   = { puntosPorSol: number | null }  → fórmula heredada de los puntos (solo con el programa apagado)
// Un error de carga nunca se convierte en una cifra.
export function resumenEstimado({ programa, tipo, precio, legacy }) {
  const esServicio = tipo === 'SERVICIO'
  if (programa.estado === 'cargando') {
    return { cifra: 'Calculando…', detalle: 'tu estimado', sello: { cifra: 'Sello', detalle: 'calculando…' }, estado: 'cargando' }
  }
  if (programa.estado === 'error' || programa.activo === null) {
    return { cifra: 'Monedas y sellos', detalle: 'no disponibles ahora', sello: { cifra: 'Sello', detalle: 'no disponible ahora' }, estado: 'error' }
  }
  if (programa.activo) {
    const importe = { servicios: esServicio ? precio : 0, productos: esServicio ? 0 : precio }
    const texto = textoMonedasEstimadas(estimarMonedas(programa.reglas, importe))
    return {
      cifra: texto ?? 'Monedas',
      detalle: 'estimado, se acredita al confirmarse la compra',
      sello: esServicio
        ? { cifra: 'Puede dar 1 sello', detalle: 'si tu venta confirmada incluye servicios (máx. 1 por día)' }
        : { cifra: 'Sin sello', detalle: 'los productos solos no dan sello' },
      estado: 'activo',
    }
  }
  // Programa apagado: comportamiento heredado.
  if (!esServicio) {
    return { cifra: 'Suma con tus servicios', detalle: 'las compras de productos aún no dan puntos', sello: { cifra: 'Suma sello', detalle: 'de fidelidad con tus servicios' }, estado: 'heredado' }
  }
  const porSol = legacy?.puntosPorSol
  if (!Number.isFinite(porSol)) {
    return { cifra: 'Suma puntos', detalle: 'al completar tu visita', sello: { cifra: 'Suma sello', detalle: 'de fidelidad' }, estado: 'heredado' }
  }
  return {
    cifra: `+${Math.max(0, Math.round(Number(precio) * porSol))} puntos`,
    detalle: 'aprox. por esta visita',
    sello: { cifra: 'Suma sello', detalle: 'de fidelidad' },
    estado: 'heredado',
  }
}
