// HARNESS del recolector de medios huérfanos acotado a UUID PROPIOS (plan V2 de Codex §6). Dependencias inyectadas: se prueba SIN red en
// scripts/verificar-ensayo-recolector.mjs. NO modifica ni acorta la retención del recolector habitual: el reloj simulado es el parámetro
// `ahora` que `recolectar` ya recibe y SOLO existe aquí; no verifica el envejecimiento real en Cloudflare.
//
// Qué demuestra (con objetos y una fila ficticios): el recolector borra el grupo SIN referencias pasado el plazo, conserva el grupo
// referenciado por una fila propia, respeta la retención con el reloj real, y nunca ve ni toca objetos ajenos (fuentes acotadas).
import { createRequire } from 'node:module'
import { grupoDeReferencia, recolectar } from './huerfanos-medios.mjs'

const require = createRequire(import.meta.url)
const G = require('./guardas-interfaz-r2.cjs')

const DIA_MS = 24 * 60 * 60 * 1000

// Snapshot canónico de filas (RG-02): TODOS los campos seleccionados, filas ordenadas por id y claves en orden fijo; el orden de
// llegada de las filas no importa, cualquier cambio de campo sí. Devuelve un texto comparable.
const CAMPOS = ['id', 'titulo', 'antes_url', 'despues_url', 'orden', 'activo']
export const snapshotFilas = (filas) => JSON.stringify([...filas].map((f) => Object.fromEntries(CAMPOS.map((c) => [c, f[c] ?? null]))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
export function diferenciasFilas(antes, despues) {
  const por = (l) => new Map(l.map((f) => [f.id, Object.fromEntries(CAMPOS.map((c) => [c, f[c] ?? null]))]))
  const a = por(antes)
  const d = por(despues)
  const dif = []
  for (const [id, fila] of a) {
    if (!d.has(id)) dif.push({ id, cambio: 'desaparecida' })
    else for (const c of CAMPOS) if (fila[c] !== d.get(id)[c]) dif.push({ id, campo: c, antes: fila[c], despues: d.get(id)[c] })
  }
  for (const id of d.keys()) if (!a.has(id)) dif.push({ id, cambio: 'nueva' })
  return dif
}

/**
 * Envuelve las fuentes reales para que el recolector SOLO vea y pueda borrar grupos propios. Un grupo ajeno nunca se lista, nunca
 * cuenta como referencia y `eliminar` lo rechaza aunque el recolector lo pidiera (defensa en profundidad).
 */
export function acotarFuentes(fuentes, propios) {
  const esPropio = (grupo) => propios.has(grupo)
  return {
    async listarReferencias() { return new Set([...(await fuentes.listarReferencias())].filter(esPropio)) },
    async listarObjetos() { return (await fuentes.listarObjetos()).filter((o) => esPropio(String(o.clave).split('/').slice(0, 2).join('/'))) },
    async estaReferenciado(grupo) {
      if (!esPropio(grupo)) throw new Error(`grupo ajeno ${grupo}: el harness no lo consulta`)
      return fuentes.estaReferenciado(grupo)
    },
    async eliminar(grupo) {
      if (!esPropio(grupo)) throw new Error(`grupo ajeno ${grupo}: el harness se niega a borrarlo`)
      return fuentes.eliminar(grupo)
    },
  }
}

/**
 * ids {protegido, huerfano, fila, titulo}, destino, bases {pages}, deps {
 *   fuentes, leerFilas(), inventario(), insertarFila(cuerpo)→{estado}, borrarFila(id)→{estado}, subir(grupo,variante,bytes)→estado,
 *   borrarPrefijo(prefijo)→estado, fabricarWebp(lado), ahora()→ms }
 */
export async function ejecutarEnsayoRecolector({ ids, destino, bases, deps, log = () => {} }) {
  const casos = []
  const caso = (nombre, ok, detalle = {}) => { casos.push({ nombre, ok: Boolean(ok), detalle }); log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`) }
  const informe = { completa: false, estadoFinalConfirmado: false, error: null, casos, pendientes: [], escrituras: false }
  const grupoP = `${destino}/${ids.protegido}`
  const grupoH = `${destino}/${ids.huerfano}`
  const propios = new Set([grupoP, grupoH])
  const intencion = { grupos: new Set(), fila: false }
  const conflictos = new Set()
  let baseClaves = null
  let baseFilas = null
  const urlDe = (id, v) => `${bases.pages}/${destino}/${id}/${v}.webp`
  try {
    if (new Set([ids.protegido, ids.huerfano, ids.fila]).size !== 3) throw new Error('los dos grupos y la fila deben tener identificadores distintos')
    baseClaves = await deps.inventario()
    baseFilas = await deps.leerFilas()
    const ocupados = [...baseClaves].filter((k) => k.startsWith(`${grupoP}/`) || k.startsWith(`${grupoH}/`))
    caso('precondición: ninguno de los dos prefijos ni la fila previstos existen', ocupados.length === 0 && !baseFilas.some((f) => f.id === ids.fila || f.titulo === ids.titulo), { ocupados })
    if (ocupados.length || baseFilas.some((f) => f.id === ids.fila || f.titulo === ids.titulo)) throw new Error('precondición no cumplida: se aborta antes de escribir y sin limpieza')

    const m = await deps.fabricarWebp(64)
    const g = await deps.fabricarWebp(128)
    for (const [grupo, id] of [['protegido', ids.protegido], ['huerfano', ids.huerfano]]) {
      for (const [v, cuerpo] of [['m', m], ['g', g]]) {
        intencion.grupos.add(`${destino}/${id}`)
        informe.escrituras = true
        const estado = await deps.subir(id, v, cuerpo)
        if (estado === 409) { conflictos.add(`${destino}/${id}`); caso(`subida ${grupo}/${v} (409: el grupo se CONSERVA)`, false, { estado }); throw new Error(`409 en ${grupo}/${v}`) }
        caso(`subida ${grupo}/${v} por el Worker (201)`, estado === 201, { estado })
        if (estado !== 201) throw new Error(`PUT ${grupo}/${v} → ${estado}`)
      }
    }
    intencion.fila = true
    let ins
    try { ins = await deps.insertarFila({ id: ids.fila, titulo: ids.titulo, antes_url: urlDe(ids.protegido, 'g'), despues_url: urlDe(ids.protegido, 'm'), orden: 9999, activo: false }) } catch { ins = { estado: null } }
    caso('fila propia creada (activo=false) que REFERENCIA solo el grupo protegido', ins.estado === 201 || ins.estado === 200 || ins.estado === 204, ins)
    const cuerpoFila = { id: ids.fila, titulo: ids.titulo, antes_url: urlDe(ids.protegido, 'g'), despues_url: urlDe(ids.protegido, 'm'), orden: 9999, activo: false }
    const f0 = (await deps.leerFilas()).find((f) => f.id === ids.fila)
    caso('relectura por id: la fila existe con TODOS sus campos y apunta al grupo protegido', f0 && snapshotFilas([f0]) === snapshotFilas([cuerpoFila]) && grupoDeReferencia(f0.antes_url) === grupoP && grupoDeReferencia(f0.despues_url) === grupoP, f0)

    const acotadas = acotarFuentes(deps.fuentes, propios)

    // 1. Lectura (aplicar:false) con el reloj REAL: ningún candidato (el huérfano está dentro de la retención).
    const seco = await recolectar({ fuentes: acotadas, aplicar: false, retencionDias: 14, ahora: deps.ahora() })
    caso('lectura acotada: 4 objetos propios, 1 referenciado (protegido) y ningún candidato dentro de la retención', seco.objetos === 4 && seco.referenciados === 1 && seco.totales.candidato === 0 && seco.totales['protegido-reciente'] === 1 && seco.totales.referenciado === 1, seco)
    // 2. Con aplicar:true y el reloj REAL tampoco se borra nada.
    const realAplicar = await recolectar({ fuentes: acotadas, aplicar: true, retencionDias: 14, ahora: deps.ahora() })
    const invReal = await deps.inventario()
    caso('aplicar con el reloj real: no elimina nada (la retención de 14 días protege al huérfano reciente)', realAplicar.eliminados.length === 0 && [...invReal].filter((k) => k.startsWith(`${grupoH}/`)).length === 2, realAplicar)

    // 3. Reloj SIMULADO (+15 días, exclusivo de este harness): el huérfano pasa a candidato; el protegido sigue referenciado.
    const futuro = deps.ahora() + 15 * DIA_MS
    const secoFuturo = await recolectar({ fuentes: acotadas, aplicar: false, retencionDias: 14, ahora: futuro })
    caso('con el reloj simulado (+15 días): el único candidato es el grupo SIN referencias', secoFuturo.candidatos.length === 1 && secoFuturo.candidatos[0].grupo === grupoH && secoFuturo.totales.referenciado === 1, secoFuturo)
    const aplicado = await recolectar({ fuentes: acotadas, aplicar: true, retencionDias: 14, ahora: futuro })
    caso('aplicar (reloj simulado): elimina SOLO el huérfano, sin errores ni abortos ni omitidos', aplicado.eliminados.length === 1 && aplicado.eliminados[0] === grupoH && aplicado.errores.length === 0 && aplicado.abortado === null && aplicado.omitidos.length === 0, aplicado)
    const invFin = await deps.inventario()
    const filaFin = (await deps.leerFilas()).find((f) => f.id === ids.fila)
    caso('estado tras el borrado selectivo: huérfano sin claves, protegido con sus 2 variantes, fila propia con TODOS sus campos intactos', [...invFin].filter((k) => k.startsWith(`${grupoH}/`)).length === 0 && [...invFin].filter((k) => k.startsWith(`${grupoP}/`)).length === 2 && !!filaFin && snapshotFilas([filaFin]) === snapshotFilas([cuerpoFila]), { claves: [...invFin].filter((k) => k.includes(ids.protegido) || k.includes(ids.huerfano)) })
    informe.recolector = { seco, realAplicar, secoFuturo, aplicado }
    informe.completa = true
  } catch (e) {
    informe.error = String(e.message ?? e)
    log(`ERROR: ${informe.error}`)
    caso('la corrida terminó sin error', false, { error: informe.error })
  } finally {
    const hayIntencion = intencion.grupos.size > 0 || intencion.fila
    if (!hayIntencion) {
      informe.estadoFinalConfirmado = !informe.escrituras
      informe.limpieza = { necesaria: false, motivo: 'sin intención de escribir: no se ejecutó ningún DELETE' }
    } else {
      // 1) la fila propia, por id exacta y solo si se intentó crear; 2) solo después, los grupos propios sin conflicto.
      const errores = []
      if (intencion.fila) {
        try {
          const filasAntes = await deps.leerFilas()
          if (filasAntes.some((f) => f.id === ids.fila)) {
            await deps.borrarFila(ids.fila)
            const despues = await deps.leerFilas()
            if (despues.some((f) => f.id === ids.fila)) errores.push('la fila propia sigue existiendo tras el DELETE')
          }
        } catch (e) { errores.push(`fila: ${String(e.message ?? e).slice(0, 120)}`) }
      }
      for (const gr of conflictos) informe.pendientes.push(`${gr}/ (409: pertenencia incierta, conservado)`)
      let lim = { confirmada: false, errores: ['sin inventario inicial'], pendientes: [] }
      if (baseClaves && errores.length === 0) {
        const prefijos = [...intencion.grupos].filter((gr) => !conflictos.has(gr)).map((gr) => `${gr}/`)
        // RG-01: UUID propio no basta si ya tiene otra referencia. Justo antes de CADA DELETE de limpieza se consulta la fuente estricta
        // (conteo válido en las cinco tablas); con referencia o lectura incierta el grupo se CONSERVA y queda como pendiente. La fila
        // ajena no se toca. Ventana residual: entre esta consulta y el DELETE.
        const acotadas = acotarFuentes(deps.fuentes, propios)
        const borrarSiSinReferencias = async (pre) => {
          const grupo = pre.replace(/\/$/, '')
          let referenciado
          try { referenciado = await acotadas.estaReferenciado(grupo) } catch (e) {
            informe.pendientes.push(`${grupo}/ (consulta de referencias incierta: conservado: ${String(e.message ?? e).slice(0, 80)})`)
            throw new Error(`conservado: no se pudo comprobar si ${grupo} está referenciado`)
          }
          if (referenciado) {
            informe.pendientes.push(`${grupo}/ (referenciado por otra fila: conservado)`)
            throw new Error(`conservado: ${grupo} tiene una referencia ajena`)
          }
          return deps.borrarPrefijo(pre)
        }
        lim = await G.limpiarObjetoPropio({ prefijo: prefijos, base: baseClaves, leerInventario: deps.inventario, borrarObjeto: borrarSiSinReferencias })
      } else if (errores.length) lim = { confirmada: false, errores, pendientes: [] }
      let filasIguales = false
      try {
        const filasFin = await deps.leerFilas()
        informe.diferenciasFilas = diferenciasFilas(baseFilas ?? [], filasFin)
        filasIguales = baseFilas !== null && snapshotFilas(filasFin) === snapshotFilas(baseFilas) // snapshot COMPLETO, no solo ids; sin restaurar datos ajenos
      } catch (e) { lim.errores = [...(lim.errores ?? []), `relectura de filas: ${String(e.message ?? e).slice(0, 120)}`] }
      informe.limpieza = lim
      informe.estadoFinalConfirmado = Boolean(lim.confirmada) && filasIguales && informe.pendientes.length === 0 && (baseFilas !== null)
      caso('ESTADO FINAL confirmado: inventario y filas idénticos a los iniciales, sin pendientes', informe.estadoFinalConfirmado, { limpieza: lim, filasIguales, diferencias: informe.diferenciasFilas, pendientes: informe.pendientes })
    }
    informe.completa = informe.completa && informe.estadoFinalConfirmado === true && casos.every((c) => c.ok)
    informe.resumen = { casos: casos.length, fallos: casos.filter((c) => !c.ok).length }
  }
  return informe
}
