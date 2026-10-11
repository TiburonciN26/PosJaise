// Núcleo del ENSAYO DE CARGA de la entrega /medios (dependencias inyectadas; probado SIN red por scripts/verificar-ensayo-carga.cjs).
// Reglas del plan V2 de Codex §5: tope TOTAL de 450 lecturas y 10 simultáneas, niveles 1/5/10 con tres muestras, nunca aumenta la carga
// por su cuenta y PARA ante 429/5xx repetidos, discrepancia de bytes/ETag o tráfico inesperado. Las latencias son del cliente, no CPU.
const MAX_LECTURAS = 450
const MAX_SIMULTANEAS = 10
const NIVELES = [1, 5, 10]
const MUESTRAS = 3
const LECTURAS_POR_MUESTRA = { 1: 10, 5: 30, 10: 60 } // 3 × (10+30+60) = 300 lecturas calientes
const TIPOS = ['GET-m', 'GET-g', 'HEAD-m', 'COND-g'] // reparto rotatorio
const MAX_ERRORES_SERVIDOR = 3 // 429/5xx acumulados que detienen la corrida

function percentil(valores, p) {
  if (!valores.length) return null
  const o = [...valores].sort((a, b) => a - b)
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]
}
const resumenMs = (v) => ({ n: v.length, p50: percentil(v, 50), p95: percentil(v, 95), p99: percentil(v, 99), max: v.length ? Math.max(...v) : null })

// leer({tipo, variante}) → {estado, medios, pop, etag, bytesOk, ms}. Lanza ante red caída (cuenta como error y detiene).
async function ejecutarCarga({ leer, esperados, log = () => {} }) {
  // EC-01: sin ETag de referencia válido NO se lanza la carga (no habría contra qué comparar).
  const referenciaValida = (v) => typeof esperados?.[v]?.etag === 'string' && esperados[v].etag !== ''
  if (!referenciaValida('m') || !referenciaValida('g')) {
    return { completa: false, parada: 'sin ETag de referencia válido para m y g: no se lanza la carga', lecturas: 0, maxSimultaneas: 0, erroresServidor: 0, fria: [], porNivel: {}, porMuestra: [], tope: { lecturas: MAX_LECTURAS, simultaneas: MAX_SIMULTANEAS } }
  }
  let lecturas = 0
  let simultaneas = 0
  let maxSimultaneas = 0
  let erroresServidor = 0
  let parada = null
  const registro = []

  const una = async (tipo, nivel, muestra, fase) => {
    if (parada) return
    if (lecturas >= MAX_LECTURAS) { parada = `presupuesto de ${MAX_LECTURAS} lecturas agotado`; return }
    lecturas += 1
    simultaneas += 1
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas)
    try {
      const variante = tipo.endsWith('-m') ? 'm' : 'g'
      const r = await leer({ tipo, variante })
      registro.push({ tipo, nivel, muestra, fase, estado: r.estado, medios: r.medios ?? null, pop: r.pop ?? null, ms: r.ms })
      if (r.estado === 429 || r.estado >= 500) {
        erroresServidor += 1
        if (erroresServidor >= MAX_ERRORES_SERVIDOR) parada = `${erroresServidor} respuestas 429/5xx: se detiene sin aumentar la carga`
        return
      }
      const esperado = tipo.startsWith('COND') ? 304 : 200
      if (r.estado !== esperado) { parada = `estado inesperado ${r.estado} en ${tipo} (esperado ${esperado})`; return }
      if (tipo.startsWith('GET') && r.bytesOk !== true) { parada = `bytes distintos a los subidos en ${tipo}`; return }
      // EC-01: en TODO 200/304 (GET, HEAD y condicional) el ETag debe estar presente e igual al de referencia; ausente/vacío/null = anomalía.
      if (typeof r.etag !== 'string' || r.etag === '') { parada = `ETag ausente en ${tipo}`; return }
      if (r.etag !== esperados[variante].etag) { parada = `ETag inesperado en ${tipo}`; return }
    } catch (e) {
      erroresServidor += 1
      parada = `fallo de red: ${String(e.message ?? e)}`
    } finally {
      simultaneas -= 1
    }
  }

  // Fase fría: la primera lectura de cada variante (MISS esperado) — se registra para comparar con la caliente.
  for (const tipo of ['GET-m', 'GET-g']) await una(tipo, 0, 0, 'fria')
  for (const nivel of NIVELES) {
    for (let muestra = 1; muestra <= MUESTRAS && !parada; muestra += 1) {
      const total = LECTURAS_POR_MUESTRA[nivel]
      let siguiente = 0
      const trabajador = async () => {
        while (!parada) {
          const i = siguiente
          if (i >= total) return
          siguiente += 1
          await una(TIPOS[i % TIPOS.length], nivel, muestra, 'caliente')
        }
      }
      await Promise.all(Array.from({ length: Math.min(nivel, MAX_SIMULTANEAS) }, trabajador))
      log(`nivel ${nivel} muestra ${muestra}: ${total} lecturas planificadas, acumuladas ${lecturas}`)
    }
    if (parada) break
  }

  const porNivel = {}
  for (const nivel of NIVELES) {
    const filas = registro.filter((x) => x.nivel === nivel && x.fase === 'caliente')
    porNivel[nivel] = {
      ...resumenMs(filas.map((x) => x.ms)),
      hit: filas.filter((x) => x.medios === 'HIT').length,
      miss: filas.filter((x) => x.medios === 'MISS').length,
      errores: filas.filter((x) => x.estado === 429 || x.estado >= 500).length,
      pops: [...new Set(filas.map((x) => x.pop).filter(Boolean))],
    }
  }
  const porMuestra = []
  for (const nivel of NIVELES) {
    for (let muestra = 1; muestra <= MUESTRAS; muestra += 1) {
      const filas = registro.filter((x) => x.nivel === nivel && x.muestra === muestra && x.fase === 'caliente')
      if (filas.length) porMuestra.push({ nivel, muestra, ...resumenMs(filas.map((x) => x.ms)), hit: filas.filter((x) => x.medios === 'HIT').length, errores: filas.filter((x) => x.estado === 429 || x.estado >= 500).length })
    }
  }
  return {
    completa: parada === null,
    porMuestra,
    nota: 'Los percentiles incluyen las respuestas con error; son latencias del cliente, no CPU. El tope de 450 cuenta SOLO las lecturas de medios de la carga.',
    parada,
    lecturas,
    maxSimultaneas,
    erroresServidor,
    fria: registro.filter((x) => x.fase === 'fria'),
    porNivel,
    tope: { lecturas: MAX_LECTURAS, simultaneas: MAX_SIMULTANEAS },
  }
}

module.exports = { ejecutarCarga, percentil, resumenMs, MAX_LECTURAS, MAX_SIMULTANEAS, NIVELES, MUESTRAS, LECTURAS_POR_MUESTRA }
