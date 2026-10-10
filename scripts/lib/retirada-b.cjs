// Veredicto de la RETIRADA del enlace antiguo (contrato B) a partir de lo observado por un cliente. Lógica pura, probada SIN red
// por scripts/verificar-retirada-b.cjs (CB-01 de Codex).
//
// Un 404 tras el DELETE solo acredita la retirada de una copia CALIENTE si llega del MISMO centro de datos (POP, sufijo de CF-Ray)
// que dio el HIT previo de ESA variante: la Cache API es por POP, y un 404 de otro POP sin copia es compatible con la opción A.
// El cliente no puede dirigir el POP: si no coincide (o falta), el resultado es INCONCLUSO, nunca «acreditado».
//   · fallo       → tras el DELETE se entregó algo que no es 404 (bytes antiguos o 304), o el 404 no cumple no-store/nosniff/noindex/HEAD vacío.
//   · inconcluso  → 404 correcto pero sin HIT previo de esa variante, o POP ausente/distinto.
//   · ok          → 404 correcto en el mismo POP que la copia caliente de esa variante.
const VARIANTES = ['m', 'g']
const METODOS = ['GET', 'HEAD', 'COND'] // COND = GET con If-None-Match del ETag anterior
const ETIQUETA = { GET: 'GET', HEAD: 'HEAD', COND: 'If-None-Match con el ETag antiguo' }

function evaluarRetirada({ calientes = {}, despues = [] }) {
  const resultados = []
  for (const variante of VARIANTES) {
    for (const metodo of METODOS) {
      const nombre = `B: ${ETIQUETA[metodo]} de ${variante} tras el DELETE → 404 no-store en el mismo POP que su copia caliente`
      const cal = calientes[variante]
      const p = despues.find((x) => x.variante === variante && x.metodo === metodo)
      if (!p) { resultados.push({ nombre, veredicto: 'inconcluso', motivo: 'sin observación' }); continue }
      const bien404 = p.estado === 404 && p.cache === 'no-store' && p.nosniff === 'nosniff' && p.robots === 'noindex' && (metodo !== 'HEAD' || p.cuerpoVacio === true)
      if (p.estado !== 404) { resultados.push({ nombre, veredicto: 'fallo', motivo: `se entregó ${p.estado} tras el DELETE`, estado: p.estado }); continue }
      if (!bien404) { resultados.push({ nombre, veredicto: 'fallo', motivo: '404 sin no-store/nosniff/noindex o HEAD con cuerpo', estado: p.estado }); continue }
      if (!cal || cal.hit !== true || !cal.pop) { resultados.push({ nombre, veredicto: 'inconcluso', motivo: `sin HIT previo con POP para ${variante}` }); continue }
      if (!p.pop || p.pop !== cal.pop) { resultados.push({ nombre, veredicto: 'inconcluso', motivo: `POP distinto o ausente (HIT ${cal.pop}, 404 ${p.pop ?? 'ausente'})` }); continue }
      resultados.push({ nombre, veredicto: 'ok', pop: p.pop })
    }
  }
  const conclusion = resultados.some((r) => r.veredicto === 'fallo') ? 'fallida' : resultados.some((r) => r.veredicto === 'inconcluso') ? 'inconclusa' : 'acreditada'
  return { conclusion, resultados }
}

module.exports = { evaluarRetirada, VARIANTES, METODOS }
