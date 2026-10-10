// Núcleo del ensayo de rollback de URLs de Galería (Pages /medios → r2.dev), con las dependencias INYECTADAS para poder
// probar el flujo completo en memoria (scripts/verificar-ensayo-rollback-galeria.cjs) sin red, sin Auth y sin escrituras.
// El CLI real (scripts/ensayo-rollback-galeria-pages.cjs) hace el preflight, el login y construye las dependencias reales.
//
// Reglas de seguridad (RBG-01 / RBG-02):
//  · Las precondiciones son ABORTOS antes de cualquier escritura: título ya presente, id previsto ya presente o lecturas fallidas.
//  · La fila propia tiene una IDENTIDAD generada ANTES del INSERT (`ids.idFila`, enviada en el POST): la limpieza solo actúa sobre esa
//    id exacta y solo si esta ejecución INTENTÓ crearla. Título, orden o activo NUNCA identifican ni autorizan borrar una fila.
//  · Los objetos se borran únicamente después de confirmar, con una lectura exitosa, que la fila propia ya NO existe. Ante lectura
//    caída, DELETE sin efecto o resultado incierto se CONSERVAN los objetos y se registra el pendiente.
//  · RBG-03: la intención de escribir (cada PUT, el INSERT) se registra ANTES de la llamada. Una excepción o una respuesta perdida NO
//    prueba ausencia: el finally reconcilia por inventario estricto los prefijos propios. «Sin escrituras» solo vale si NUNCA se intentó escribir.
//  · Si no hubo ninguna escritura intentada (aborto de preflight/precondición) la limpieza no hace nada.
//  · Toda excepción de la limpieza o de la comprobación final deja la corrida INCOMPLETA.
const G = require('./guardas-interfaz-r2.cjs')

/**
 * @param {object} d dependencias:
 *  bases {pages, r2dev}, ids {idFila, idAntes, idDespues, titulo}, destino, conObjetos, prefijoStorage,
 *  U (módulo urlsMedios), leerFilas(), leerInventario(), insertarFila(cuerpo)→{estado},
 *  actualizarFila(id,titulo,cambios)→{estado,filas}, borrarFila(id)→{estado}, subir(id,variante,bytes)→estado,
 *  borrarGrupo(prefijo)→estado, leerUrl(url)→{estado,tipo,bytes}, fabricarWebp(lado)→Buffer
 */
async function ejecutarEnsayo(d) {
  const { pages, r2dev } = d.bases
  const { idFila, idAntes, idDespues, titulo } = d.ids
  const urlDe = (base, id, v = 'g') => `${base}/${d.destino}/${id}/${v}.webp`
  const igualesBytes = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0
  const informe = { completa: false, estadoFinalConfirmado: false, error: null, casos: [], creacionIntentada: false, creacionConfirmada: false, conservaObjetos: false, pendientes: [] }
  const caso = (nombre, ok, detalle = {}) => {
    informe.casos.push({ nombre, ok: Boolean(ok), detalle })
    d.log?.(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
  }
  let baseFilas = null
  let baseClaves = null
  let subidos = false

  try {
    // ---- snapshot y PRECONDICIONES: abortan antes de escribir ----
    baseFilas = await d.leerFilas()
    baseClaves = await d.leerInventario()
    caso('snapshot de galeria_web (cardinalidad verificada) e inventario de fotos-galeria leídos (lectura estricta, sin cursor)', Array.isArray(baseFilas) && baseClaves instanceof Set, { filas: baseFilas.length, claves: baseClaves.size })
    if (baseFilas.some((f) => f.titulo === titulo)) throw new Error('precondición: ya existe una fila con el título de esta ejecución; se aborta sin escribir')
    if (baseFilas.some((f) => f.id === idFila)) throw new Error('precondición: el id previsto de la fila propia ya existe; se aborta sin escribir')
    if ([...baseClaves].some((k) => k.startsWith(`${d.destino}/${idAntes}/`) || k.startsWith(`${d.destino}/${idDespues}/`))) throw new Error('precondición: los grupos previstos ya existen en el inventario; se aborta sin escribir')
    caso('precondiciones: título, id de fila y grupos previstos libres', true)

    const U = d.U
    const transicion = U.basesReconocidas(pages, r2dev)
    const soloR2dev = U.basesReconocidas(r2dev, '')
    const ruta = (url, bases) => U.rutaDeUrlGaleriaPura({ url, bases, prefijoStorage: d.prefijoStorage })

    // ---- (B) objetos ficticios ----
    let bytes = null
    if (d.conObjetos) {
      bytes = { m: await d.fabricarWebp(64), g: await d.fabricarWebp(128) }
      for (const id of [idAntes, idDespues]) {
        for (const v of ['m', 'g']) {
          subidos = true // RBG-03: la INTENCIÓN se registra ANTES de cada llamada que puede escribir (aunque lance o la respuesta se pierda)
          const estado = await d.subir(id, v, bytes[v])
          caso(`subida ${d.destino}/${id.slice(0, 8)}…/${v} por el Worker (201)`, estado === 201, { estado })
        }
      }
    }

    // ---- fila propia: identidad previa al INSERT; id previsto, intento y confirmación son estados separados ----
    informe.creacionIntentada = true
    let ins = { estado: null }
    try { ins = await d.insertarFila({ id: idFila, titulo, antes_url: urlDe(pages, idAntes), despues_url: urlDe(pages, idDespues), orden: 9999, activo: false }) } catch { ins = { estado: null } }
    const trasInsert = await d.leerFilas() // reconcilia por IDENTIDAD EXACTA aunque la respuesta se haya perdido
    const f0 = trasInsert.find((f) => f.id === idFila)
    informe.creacionConfirmada = Boolean(f0)
    caso('fila propia creada con su id previsto y URLs de Pages (INSERT 201, confirmada por relectura por id)', ins.estado === 201 && Boolean(f0), { estado: ins.estado, existe: Boolean(f0) })
    if (!f0 || ins.estado !== 201) throw new Error(`el INSERT no quedó confirmado (estado ${ins.estado}, fila ${f0 ? 'existe' : 'no existe'}); se aborta y la limpieza actúa solo sobre el id previsto`)
    caso('relectura: la fila tiene exactamente las dos URLs de Pages (activo=false, orden 9999)', f0.antes_url === urlDe(pages, idAntes) && f0.despues_url === urlDe(pages, idDespues) && f0.activo === false && f0.titulo === titulo && f0.orden === 9999, f0)
    caso('ANTES del rollback: con las bases de la transición ambas URLs se reconocen como medios propios (r2:fotos-galeria/…)', ruta(f0.antes_url, transicion) === `r2:${d.destino}/${idAntes}` && ruta(f0.despues_url, transicion) === `r2:${d.destino}/${idDespues}`)
    caso('ANTES del rollback: con una build solo-r2.dev NO se reconocen (ni se desvían a Storage): por eso se convierten antes de retirar la Function', ruta(f0.antes_url, soloR2dev) === null && ruta(f0.despues_url, soloR2dev) === null)
    if (d.conObjetos) {
      const lecturas = []
      for (const u of [f0.antes_url, f0.despues_url]) {
        let r = null
        for (let i = 0; i < 4 && !(r?.estado === 200); i += 1) { r = await d.leerUrl(u); if (r.estado !== 200) await d.espera?.(500) }
        lecturas.push({ u: u.slice(-50), estado: r.estado, bytes: r.bytes })
      }
      caso('con objetos: por Pages /medios ambas fotos responden 200 con los bytes exactos', lecturas.every((l) => l.estado === 200 && igualesBytes(l.bytes, bytes.g)), lecturas.map((l) => ({ u: l.u, estado: l.estado })))
    }

    // ---- ROLLBACK acotado a la fila propia ----
    const nuevaAntes = U.convertirBaseUrl(f0.antes_url, pages, r2dev)
    const nuevaDespues = U.convertirBaseUrl(f0.despues_url, pages, r2dev)
    caso('conversión pura: ambas URLs pasan de la base de Pages a la de r2.dev conservando destino/UUID/variante', nuevaAntes === urlDe(r2dev, idAntes) && nuevaDespues === urlDe(r2dev, idDespues), { nuevaAntes, nuevaDespues })
    const upd = await d.actualizarFila(idFila, titulo, { antes_url: nuevaAntes, despues_url: nuevaDespues })
    caso('UPDATE acotado por id Y título propios (devuelve exactamente 1 fila)', upd.estado === 200 && Array.isArray(upd.filas) && upd.filas.length === 1, { estado: upd.estado, filas: Array.isArray(upd.filas) ? upd.filas.length : null })
    const filas1 = await d.leerFilas()
    const f1 = filas1.find((f) => f.id === idFila)
    caso('relectura: la fila quedó EXACTAMENTE con las URLs de r2.dev (título, orden y activo intactos)', f1?.antes_url === nuevaAntes && f1?.despues_url === nuevaDespues && f1.titulo === titulo && f1.orden === 9999 && f1.activo === false, f1)
    caso('las demás filas (incl. «Foto de prueba (Inicio)») quedaron EXACTAMENTE como en el snapshot inicial', G.iguales(filas1.filter((f) => f.id !== idFila), baseFilas), { filas: filas1.length })
    caso('DESPUÉS del rollback: con una build solo-r2.dev ambas URLs se reconocen para administrar/borrar (r2:fotos-galeria/…) [reconocimiento del módulo puro, no un recorrido de UI recompilado]', ruta(f1?.antes_url, soloR2dev) === `r2:${d.destino}/${idAntes}` && ruta(f1?.despues_url, soloR2dev) === `r2:${d.destino}/${idDespues}`)
    if (d.conObjetos) {
      const lecturas = []
      for (const u of [f1.antes_url, f1.despues_url]) lecturas.push({ u: u.slice(-50), ...(await d.leerUrl(u)) })
      caso('con objetos: tras el rollback las fotos cargan por r2.dev (200 image/webp, bytes exactos)', lecturas.every((l) => l.estado === 200 && l.tipo === 'image/webp' && igualesBytes(l.bytes, bytes.g)), lecturas.map((l) => ({ u: l.u, estado: l.estado, tipo: l.tipo })))
      const aun = await d.leerUrl(urlDe(pages, idAntes))
      caso('con objetos: el rollback de datos NO retira la Function: Pages sigue sirviendo el objeto (200)', aun.estado === 200)
    }
    informe.completa = true
  } catch (e) {
    informe.error = String(e.message ?? e)
    d.log?.(`ERROR: ${informe.error}`)
    caso('la corrida terminó sin error', false, { error: informe.error })
  } finally {
    const hubo = informe.creacionIntentada || subidos
    if (!hubo) {
      // aborto antes de cualquier escritura: no se borra NADA (ni se confía en títulos u otros metadatos)
      informe.estadoFinalConfirmado = true // sin escrituras no hay nada que verificar ni restaurar (la corrida queda incompleta por su error)
      informe.sinEscrituras = true
    } else {
      try {
        // 1) La fila propia, SOLO por su id exacto, y solo si esta ejecución intentó crearla
        let filaExiste = false
        if (informe.creacionIntentada) {
          const filas = await d.leerFilas() // si lanza ⇒ estado desconocido ⇒ se CONSERVAN los objetos
          filaExiste = filas.some((f) => f.id === idFila)
          if (filaExiste) {
            let estadoDelete = null
            try { estadoDelete = (await d.borrarFila(idFila)).estado } catch { /* resultado incierto: se reconcilia leyendo */ }
            const despues = await d.leerFilas()
            filaExiste = despues.some((f) => f.id === idFila)
            informe.limpiezaFila = { estadoDelete, eliminada: !filaExiste }
          } else informe.limpiezaFila = { estadoDelete: null, eliminada: true, nota: 'la fila propia no existía' }
          caso('limpieza: la fila propia (por id exacto) ya no existe, confirmado por relectura (solo entonces se borran sus objetos)', !filaExiste, informe.limpiezaFila)
        }
        if (filaExiste) {
          informe.conservaObjetos = true
          informe.pendientes.push(`galeria_web:${idFila}`)
        } else {
          // 2) Solo con la ausencia de la fila confirmada: los grupos propios, por prefijo, con comprobación del inventario
          const lim = await G.limpiarObjetoPropio({
            prefijo: [`${d.destino}/${idAntes}/`, `${d.destino}/${idDespues}/`],
            base: baseClaves,
            leerInventario: d.leerInventario,
            borrarObjeto: (pre) => d.borrarGrupo(pre),
          })
          informe.limpiezaObjetos = lim
          if (!lim.confirmada) informe.pendientes.push(...lim.pendientes.map((k) => `objeto:${k}`), ...lim.errores)
          let filasFin = null
          try { filasFin = await d.leerFilas() } catch (e) { informe.errorSnapshotFinal = String(e.message ?? e) }
          const snapOk = Array.isArray(filasFin) && G.iguales(filasFin, baseFilas)
          informe.estadoFinalConfirmado = lim.confirmada && snapOk
          caso('ESTADO FINAL confirmado: galeria_web idéntica al snapshot inicial e inventario de fotos-galeria idéntico al inicial, sin claves propias pendientes y sin errores', informe.estadoFinalConfirmado, { objetos: lim, snapshotIgual: snapOk })
        }
        if (informe.conservaObjetos) caso('ESTADO FINAL confirmado (la fila propia sigue existiendo: se CONSERVAN sus objetos para revisión)', false, { pendientes: informe.pendientes })
      } catch (e) {
        informe.errorLimpieza = String(e.message ?? e)
        informe.conservaObjetos = true
        informe.pendientes.push('estado desconocido: se conservan fila y objetos propios')
        informe.estadoFinalConfirmado = false
        caso('limpieza y comprobación final sin errores (estado desconocido: se CONSERVAN los objetos)', false, { error: informe.errorLimpieza })
      }
    }
    informe.completa = informe.completa && informe.estadoFinalConfirmado === true
    informe.resumen = { casos: informe.casos.length, fallos: informe.casos.filter((c) => !c.ok).length }
  }
  return informe
}

module.exports = { ejecutarEnsayo }
