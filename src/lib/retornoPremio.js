// Retorno efectivo de un premio del catálogo (pestaña Web → Recompensas → formulario de premio). Lógica PURA.
//
// Responde: «por cada sol que gasta la clienta, ¿cuántos soles le devuelvo en este premio?».
//   retorno = valor del premio ÷ gasto necesario para juntar su costo.
//   · Monedas: gasto = costo en monedas ÷ monedas por sol (servicios y productos ganan distinto: se muestran ambos).
//   · Sellos: gasto = sellos del premio × gasto promedio por visita (un sello por visita con servicios).
// Los umbrales de lectura son una REFERENCIA general de programas de fidelidad de comercios, no una norma: la decisión real depende
// del margen del salón (ver la pestaña Rentabilidad).

export const RETORNO_BAJO = 3
export const RETORNO_ALTO = 8

const aNumero = (x) => {
  if (x === '' || x === null || x === undefined) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
const centavos = (x) => Math.round(Number(x) * 100 + 1e-9) / 100
const decimas = (x) => Math.round(Number(x) * 10) / 10

// Monedas que gana una clienta por cada S/ gastado, según la tasa configurada (p. ej. 5 monedas por cada S/ 20 = 0,25).
export const monedasPorSol = (tasa) => (tasa && Number(tasa.soles) > 0 ? Number(tasa.monedas) / Number(tasa.soles) : null)

// Cuánto vale el premio en soles. Devuelve null si no se puede saber todavía (y por qué se pide un dato de ejemplo).
export function valorDelPremio({ tipo, valor, tope, servicioPrecio, compraEjemplo }) {
  const v = aNumero(valor)
  if (tipo === 'MONTO') return v > 0 ? { soles: v, nota: null } : null
  if (tipo === 'SERVICIO') {
    const p = aNumero(servicioPrecio)
    return p > 0 ? { soles: p, nota: 'como máximo el precio del servicio (el cupón cubre el precio menos su protección)' } : null
  }
  if (!(v > 0)) return null
  const t = aNumero(tope)
  const compra = aNumero(compraEjemplo)
  if (compra > 0) {
    const d = centavos((compra * v) / 100)
    return { soles: t > 0 ? Math.min(d, t) : d, nota: `con una compra de ejemplo de S/ ${compra.toFixed(2)}` }
  }
  if (t > 0) return { soles: t, nota: 'como máximo (el tope de descuento)' }
  return null
}

// Costo en monedas que paga cada nivel (igual que la base: lo vacío hereda el del nivel inferior).
export function costosPorNivel({ costoBasico, costoPremium, costoVip }) {
  const b = aNumero(costoBasico)
  const p = aNumero(costoPremium) ?? b
  const v = aNumero(costoVip) ?? aNumero(costoPremium) ?? b
  return [
    { nivel: 'BASICO', costo: b },
    { nivel: 'PREMIUM', costo: p },
    { nivel: 'VIP', costo: v },
  ]
}

function filaRetorno(costo, valorSoles, rate) {
  if (!(costo >= 0) || !(rate > 0) || !(valorSoles > 0)) return { gasto: null, retorno: null }
  if (costo === 0) return { gasto: 0, retorno: null } // costo 0 = regalo: no hay retorno que calcular
  const gasto = costo / rate
  return { gasto: centavos(gasto), retorno: decimas((valorSoles / gasto) * 100) }
}

// Premios por MONEDAS: una fila por nivel con el gasto necesario y el retorno si la clienta gana sus monedas en servicios o en productos.
export function retornoMonedas({ valorSoles, costos, tasaServ, tasaProd }) {
  const rs = monedasPorSol(tasaServ)
  const rp = monedasPorSol(tasaProd)
  return costos
    .filter((c) => c.costo !== null)
    .map((c) => {
      const s = filaRetorno(c.costo, valorSoles, rs)
      const p = filaRetorno(c.costo, valorSoles, rp)
      return { nivel: c.nivel, costo: c.costo, gastoServicios: s.gasto, retornoServicios: s.retorno, gastoProductos: p.gasto, retornoProductos: p.retorno }
    })
}

// Premios por SELLOS: gasto = sellos del premio × gasto promedio por visita.
export function retornoSellos({ valorSoles, sellosPorPremio, gastoPorVisita }) {
  const g = aNumero(gastoPorVisita)
  const n = Number(sellosPorPremio)
  if (!(g > 0) || !(n > 0) || !(valorSoles > 0)) return { visitas: n > 0 ? n : null, gasto: null, retorno: null }
  const gasto = centavos(n * g)
  return { visitas: n, gasto, retorno: decimas((valorSoles / gasto) * 100) }
}

export function lecturaRetorno(pct) {
  if (pct === null || pct === undefined) return null
  if (pct < RETORNO_BAJO) return 'bajo'
  if (pct <= RETORNO_ALTO) return 'moderado'
  return 'alto'
}

export const TEXTO_LECTURA = {
  bajo: 'Retorno bajo: a la clienta le costará mucho llegar a este premio, puede resultar poco atractivo.',
  moderado: 'Retorno en el rango habitual de los programas de fidelidad.',
  alto: 'Retorno alto: estás devolviendo mucho. Compáralo con tu margen en la pestaña Rentabilidad.',
}
