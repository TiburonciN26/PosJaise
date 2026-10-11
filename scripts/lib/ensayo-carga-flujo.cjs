// Flujo COMPLETO del ensayo de carga de /medios con dependencias inyectadas (el CLI solo las cablea; regresiones sin red en
// scripts/verificar-ensayo-carga.mjs). Contiene las salvaguardas de EC-02: precondición de prefijos libres ANTES de escribir, intención de
// escribir registrada antes de cada PUT, un 409 conserva el grupo (no se infiere propiedad) y la limpieza solo toca grupos propios.
const G = require('./guardas-interfaz-r2.cjs')
const R = require('./retirada-b.cjs')
const { ejecutarCarga } = require('./ensayo-carga.cjs')

const igualesBytes = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0

// Adaptador real de lectura: `seguro` es el fetch de lista cerrada; devuelve el ETag tal cual (null si falta, nunca undefined).
function crearLeerUrl({ seguro, url, medir = () => performance.now() }) {
  return async ({ grupo, variante, metodo = 'GET', headers = {} }) => {
    const t0 = medir()
    const r = await seguro(url(grupo, variante), { method: metodo, headers })
    const cuerpo = Buffer.from(await r.arrayBuffer())
    return {
      estado: r.status, medios: r.headers.get('x-medios-cache'), pop: (r.headers.get('cf-ray') ?? '').split('-')[1] ?? null,
      etag: r.headers.get('etag'), cache: r.headers.get('cache-control'), nosniff: r.headers.get('x-content-type-options'),
      robots: r.headers.get('x-robots-tag'), bytes: cuerpo, ms: Math.round(medir() - t0),
    }
  }
}

async function ejecutarEnsayoCarga({ ids, destino, deps, log = () => {} }) {
  const casos = []
  const caso = (nombre, ok, detalle = {}) => { casos.push({ nombre, ok: Boolean(ok), detalle }); log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`) }
  const informe = { completa: false, estadoFinalConfirmado: false, error: null, casos, pendientes: [], escrituras: false }
  const intencion = { A: false, B: false } // registrada ANTES de cada PUT
  const conflicto = { A: false, B: false } // 409: pertenencia incierta → se CONSERVA
  let base = null
  try {
    if (!ids?.A || !ids?.B || ids.A === ids.B) throw new Error('los dos grupos deben tener UUID distintos')
    base = await deps.inventario()
    caso('inventario inicial leído (lectura estricta)', base instanceof Set, { claves: base.size })
    // EC-02: ambos prefijos previstos deben estar AUSENTES antes de escribir; si no, se aborta sin PUT ni DELETE.
    const ocupados = [...base].filter((k) => k.startsWith(`${destino}/${ids.A}/`) || k.startsWith(`${destino}/${ids.B}/`))
    caso('precondición: ninguno de los dos prefijos previstos existe en el inventario inicial', ocupados.length === 0, { ocupados })
    if (ocupados.length) throw new Error('prefijo previsto ya existente: se aborta antes de escribir y sin limpieza')

    const m = await deps.fabricarWebp(64)
    const g = await deps.fabricarWebp(128)
    const bytes = { m, g }

    for (const grupo of ['A', 'B']) {
      for (const v of ['m', 'g']) {
        intencion[grupo] = true
        informe.escrituras = true
        const estado = await deps.subir(grupo, v, bytes[v])
        if (estado === 409) { conflicto[grupo] = true; caso(`subida ${grupo}/${v} (409 conflicto: el grupo se CONSERVA)`, false, { estado }); throw new Error(`409 en ${grupo}/${v}`) }
        caso(`subida ${grupo}/${v} por el Worker (201)`, estado === 201, { estado })
        if (estado !== 201) throw new Error(`PUT ${grupo}/${v} → ${estado}`)
      }
    }
    const inv1 = await deps.inventario()
    const nuevas = [...inv1].filter((k) => !base.has(k)).sort()
    caso('el inventario muestra exactamente las 4 claves propias nuevas', nuevas.length === 4 && nuevas.every((k) => k.startsWith(`${destino}/${ids.A}/`) || k.startsWith(`${destino}/${ids.B}/`)), nuevas)

    // ETag de referencia por HEAD (no puebla la caché). Debe existir: sin él no se lanza la carga (EC-01).
    const esperados = {}
    for (const v of ['m', 'g']) esperados[v] = { etag: (await deps.leerUrl({ grupo: 'A', variante: v, metodo: 'HEAD' })).etag }
    caso('ETag de referencia de A/m y A/g presentes', typeof esperados.m.etag === 'string' && esperados.m.etag !== '' && typeof esperados.g.etag === 'string' && esperados.g.etag !== '', esperados)

    const leer = async ({ tipo, variante }) => {
      const metodo = tipo.startsWith('HEAD') ? 'HEAD' : 'GET'
      const headers = tipo.startsWith('COND') ? { 'If-None-Match': esperados[variante].etag } : {}
      const r = await deps.leerUrl({ grupo: 'A', variante, metodo, headers })
      return { estado: r.estado, medios: r.medios, pop: r.pop, etag: r.etag, bytesOk: metodo === 'GET' ? igualesBytes(r.bytes, bytes[variante]) : true, ms: r.ms }
    }
    informe.carga = await ejecutarCarga({ leer, esperados, log })
    caso(`carga completada sin parada (${informe.carga.lecturas} lecturas, máx. ${informe.carga.maxSimultaneas} simultáneas)`, informe.carga.completa, informe.carga)
    if (!informe.carga.completa) throw new Error(`carga detenida: ${informe.carga.parada}`)

    const calientes = { m: null, g: null }
    for (const v of ['m', 'g']) {
      for (let i = 0; i < 8 && !calientes[v]; i += 1) {
        await deps.espera(400 * (i + 1))
        const r = await deps.leerUrl({ grupo: 'A', variante: v })
        if (r.estado === 200 && r.medios === 'HIT' && igualesBytes(r.bytes, bytes[v])) calientes[v] = { hit: true, pop: r.pop, etag: r.etag }
      }
      caso(`copia caliente de A/${v} confirmada antes de borrar`, !!calientes[v]?.pop, calientes[v] ?? {})
    }
    const del = await deps.borrarPrefijo(`${destino}/${ids.A}/`)
    caso('borrado del grupo A por el Worker (200)', del === 200, { estado: del })
    const despues = []
    for (const v of ['m', 'g']) {
      for (const [metodo, req] of [['GET', { metodo: 'GET' }], ['HEAD', { metodo: 'HEAD' }], ['COND', { metodo: 'GET', headers: { 'If-None-Match': esperados[v].etag } }]]) {
        const r = await deps.leerUrl({ grupo: 'A', variante: v, ...req })
        despues.push({ variante: v, metodo, estado: r.estado, cache: r.cache, nosniff: r.nosniff, robots: r.robots, pop: r.pop, cuerpoVacio: r.bytes.length === 0 })
      }
    }
    const ev = R.evaluarRetirada({ calientes, despues })
    for (const r of ev.resultados) caso(r.nombre, r.veredicto === 'ok', r)
    informe.retirada = { conclusion: ev.conclusion, calientes, despues }

    const ctl = await deps.leerUrl({ grupo: 'B', variante: 'm' })
    caso('control: el grupo B sigue sirviéndose 200 con sus bytes tras borrar A', ctl.estado === 200 && igualesBytes(ctl.bytes, m), { estado: ctl.estado })
    informe.completa = ev.conclusion === 'acreditada'
  } catch (e) {
    informe.error = String(e.message ?? e)
    log(`ERROR: ${informe.error}`)
    caso('la corrida terminó sin error', false, { error: informe.error })
  } finally {
    const hayIntencion = intencion.A || intencion.B
    if (!hayIntencion) {
      // Nada se intentó escribir: no hay limpieza que hacer y nunca se borra nada.
      informe.estadoFinalConfirmado = !informe.escrituras
      informe.limpieza = { necesaria: false, motivo: 'sin intención de escribir: no se ejecutó ningún DELETE' }
    } else {
      // Solo grupos con intención de escritura y SIN conflicto; un grupo con 409 se conserva y queda como pendiente explícito.
      const propios = ['A', 'B'].filter((gr) => intencion[gr] && !conflicto[gr]).map((gr) => `${destino}/${ids[gr]}/`)
      for (const gr of ['A', 'B']) if (conflicto[gr]) informe.pendientes.push(`${destino}/${ids[gr]}/ (409: pertenencia incierta, conservado)`)
      let lim
      if (base) {
        lim = await G.limpiarObjetoPropio({ prefijo: propios, base, leerInventario: deps.inventario, borrarObjeto: deps.borrarPrefijo })
      } else {
        lim = { confirmada: false, necesaria: false, errores: ['sin inventario inicial: no se puede confirmar el estado'], pendientes: [] }
      }
      informe.limpieza = lim
      informe.estadoFinalConfirmado = lim.confirmada && informe.pendientes.length === 0
      caso('ESTADO FINAL confirmado: inventario idéntico al inicial, sin claves propias pendientes ni grupos en conflicto', informe.estadoFinalConfirmado, { limpieza: lim, pendientes: informe.pendientes })
    }
    // Una sola señal: cualquier caso fallido → completa=false (el exit code y `completa` ya no se contradicen).
    informe.completa = informe.completa && informe.estadoFinalConfirmado === true && casos.every((c) => c.ok)
    informe.resumen = { casos: casos.length, fallos: casos.filter((c) => !c.ok).length }
  }
  return informe
}

module.exports = { ejecutarEnsayoCarga, crearLeerUrl }
