// Fase 10A · V2 (F10A-02/04 de Codex): evaluación de presupuestos separada de la CLI para poder probarla sin navegador.
//   · Cada grupo del alcance EXIGE su archivo y los resultados que declara el presupuesto (`esperados`, escenarios de vitales,
//     ciclos de sesión, muestras mínimas). Lo que falta, está vacío o no es numérico es un PROBLEMA (evaluación incompleta), nunca
//     un aprobado ni una fila omitida.
//   · Las comparaciones usan el valor EXACTO. En vitales, LCP/CLS/interacción se recalculan desde las muestras crudas con la
//     mediana exacta (no se confía en el resumen, que en la V1 estaba redondeado a un decimal). El redondeo es solo de la tabla.
import { createRequire } from 'node:module'

const { mediana } = createRequire(import.meta.url)('./estadistica.cjs')

export const ARCHIVOS = { cupones: 'cupones-reposo.json', busqueda: 'busqueda-amplia.json', iniciales: 'datos-iniciales.json', sesion: 'sesion-larga.json', vitales: 'vitales.json' }
export const GRUPOS = Object.keys(ARCHIVOS)

const esNumero = (x) => typeof x === 'number' && Number.isFinite(x)

/** Compara un valor exacto con su límite. `null`, texto o NaN nunca cumplen. */
export function cumple(valor, limite, cmp = '<=') {
  if (cmp === '===') return valor === limite
  if (!esNumero(valor)) return false
  return cmp === '<=' ? valor <= limite : valor >= limite
}

/** Presentación: CLS con 4 decimales; el resto con 1. Solo para la tabla; la decisión ya está tomada con el valor exacto. */
export function formatear(valor, que = '') {
  if (!esNumero(valor)) return String(valor)
  if (/CLS/.test(que)) return valor.toFixed(4)
  return String(Math.round(valor * 10) / 10)
}

/**
 * @param {{ leer: (archivo: string) => any, P: object, grupos: string[] }} p  `leer` devuelve el JSON o null si no existe
 *        (y lanza si está malformado).
 * @returns {{ filas: object[], problemas: string[] }}
 */
export function evaluarPresupuestos({ leer, P, grupos }) {
  const filas = []
  const problemas = []
  const chequear = (grupo, que, valor, limite, cmp = '<=') => filas.push({ grupo, que, valor: valor ?? null, limite: `${cmp} ${limite}`, ok: cumple(valor, limite, cmp) })
  const cargar = (grupo) => {
    try {
      const j = leer(ARCHIVOS[grupo])
      if (j === null || j === undefined) problemas.push(`${grupo}: falta ${ARCHIVOS[grupo]}`)
      return j ?? null
    } catch (e) {
      problemas.push(`${grupo}: ${ARCHIVOS[grupo]} ilegible (${String(e.message).slice(0, 80)})`)
      return null
    }
  }
  const faltan = (grupo, esperados, presentes) => {
    for (const k of esperados) if (!presentes.includes(k)) problemas.push(`${grupo}: falta el resultado esperado «${k}»`)
  }

  if (grupos.includes('cupones')) {
    const cup = cargar('cupones'), p1 = P.cupones_reposo
    if (cup) {
      const res = Array.isArray(cup.resultados) ? cup.resultados : []
      faltan('cupones', p1.esperados ?? [], res.map((r) => `${r.ruta} ${r.tema}`))
      for (const r of res) {
        const k = `${r.ruta} ${r.tema}`
        if (!Array.isArray(r.muestras) || !r.muestras.length) { problemas.push(`cupones: «${k}» sin muestras`); continue }
        chequear('cupones', `${k} · TaskDuration mediana (ms/2,5 s)`, r.mediana_task_ms, p1.mediana_task_ms_max)
        chequear('cupones', `${k} · animaciones activas`, r.animaciones, p1.animaciones_activas_max)
        const tareas = r.muestras.map((m) => m.mayor_tarea_ms)
        chequear('cupones', `${k} · mayor tarea larga (ms)`, tareas.every(esNumero) ? Math.max(...tareas) : null, p1.mayor_tarea_larga_ms_max)
      }
    }
  }
  if (grupos.includes('busqueda')) {
    const bus = cargar('busqueda'), p4 = P.busqueda_amplia
    if (bus) {
      const res = Array.isArray(bus.resumen) ? bus.resumen : []
      faltan('busqueda', p4.esperados ?? [], res.map((r) => `${r.ruta} ${r.ancho}`))
      for (const r of res) {
        const k = `${r.ruta} ${r.ancho}px`
        chequear('busqueda', `${k} · nodos DOM`, r.nodosDom, p4.nodos_dom_max)
        chequear('busqueda', `${k} · tarjetas montadas`, r.tarjetasMontadas, p4.tarjetas_montadas_max)
        chequear('fotos', `${k} · imágenes pedidas en la carga`, r.imagenesCarga, P.fotos.imagenes_en_carga_max)
        chequear('busqueda', `${k} · bytes del catálogo en la carga`, r.bytesCatalogoCarga, p4.bytes_catalogo_carga_max)
        chequear('busqueda', `${k} · evento de búsqueda máx. (ms)`, r.busquedaEventoMaxMs, p4.busqueda_evento_max_ms)
        chequear('busqueda', `${k} · pedidos al catálogo por búsqueda`, r.busquedaPedidosCatalogo, p4.busqueda_pedidos_catalogo_max)
        chequear('busqueda', `${k} · encuentra el objetivo`, r.busquedaEncontroObjetivo, true, '===')
      }
    }
  }
  if (grupos.includes('iniciales')) {
    const ini = cargar('iniciales'), p5 = P.datos_iniciales
    if (ini) {
      const res = ini.resultados && typeof ini.resultados === 'object' ? ini.resultados : {}
      faltan('iniciales', p5.esperados ?? [], Object.keys(res))
      for (const [esc, r] of Object.entries(res)) {
        const m = r?.mediana
        if (!m) { problemas.push(`iniciales: «${esc}» sin mediana`); continue }
        chequear('iniciales', `${esc} · nodos`, m.nodos, p5.nodos_max)
        chequear('iniciales', `${esc} · bytes del API`, m.bytes, p5.bytes_max)
        chequear('iniciales', `${esc} · peticiones duplicadas`, m.duplicadas, p5.duplicadas_max)
        chequear('iniciales', `${esc} · canales Realtime`, m.canalesRealtime, p5.canales_realtime_max)
        chequear('iniciales', `${esc} · mayor tarea larga (ms)`, m.tareaMaxMs, p5.tarea_larga_max_ms)
      }
    }
  }
  if (grupos.includes('sesion')) {
    const ses = cargar('sesion'), p6 = P.sesion_larga
    if (ses) {
      const ciclos = Array.isArray(ses.ciclos) ? ses.ciclos : []
      if (ciclos.length !== (p6.ciclos_esperados ?? 3)) problemas.push(`sesion: ${ciclos.length} ciclos; se esperan ${p6.ciclos_esperados ?? 3}`)
      else {
        const [, c2, c3] = ciclos
        chequear('sesion', 'pantallas montadas (máx.)', ciclos.every((c) => esNumero(c.maxPantallas)) ? Math.max(...ciclos.map((c) => c.maxPantallas)) : null, p6.pantallas_montadas_max)
        chequear('sesion', 'heap tras GC al final (MB)', c3.finCiclo?.heapMB, p6.heap_tras_gc_mb_max)
        const dHeap = esNumero(c3.finCiclo?.heapMB) && esNumero(c2.finCiclo?.heapMB) ? c3.finCiclo.heapMB - c2.finCiclo.heapMB : null
        chequear('sesion', 'crecimiento de heap ciclo 2→3 (MB)', dHeap, p6.crecimiento_heap_ciclo2_a_3_mb_max)
        const dNodos = esNumero(c3.finCiclo?.nodos) && esNumero(c2.finCiclo?.nodos) ? c3.finCiclo.nodos - c2.finCiclo.nodos : null
        chequear('sesion', 'crecimiento de nodos ciclo 2→3', dNodos, p6.crecimiento_nodos_ciclo2_a_3_max)
        for (const c of ciclos) {
          chequear('sesion', `ciclo ${c.ciclo} · reposo en Ventas rAF/s`, c.reposo?.rafPorSeg, p6.reposo_raf_por_seg_max)
          chequear('sesion', `ciclo ${c.ciclo} · reposo temporizadores/s`, c.reposo?.timeoutsPorSeg, p6.reposo_temporizadores_por_seg_max)
          chequear('sesion', `ciclo ${c.ciclo} · reposo tarea ms/s`, c.reposo?.tareaMsPorSeg, p6.reposo_tarea_ms_por_seg_max)
        }
      }
    }
  }
  if (grupos.includes('vitales')) {
    const vit = cargar('vitales'), pv = P.vitales_laboratorio, pr = P.movimiento_reducido
    if (vit) {
      if (vit.completo === false) problemas.push(`vitales: el medidor declaró la medición incompleta (${(vit.errores ?? []).join(' | ').slice(0, 160) || 'sin detalle'})`)
      const esc = vit.escenarios && typeof vit.escenarios === 'object' ? vit.escenarios : {}
      faltan('vitales', pv.escenarios_esperados ?? [], Object.keys(esc))
      const conInteraccion = new Set(pv.escenarios_con_interaccion ?? [])
      for (const [id, r] of Object.entries(esc)) {
        for (const [modo, campo] of [['frio', 'muestrasFrio'], ['caliente', 'muestrasCaliente']]) {
          const xs = r?.[campo]
          if (!Array.isArray(xs) || xs.length < (pv.muestras_min ?? 1)) { problemas.push(`vitales: «${id}» ${modo} con ${Array.isArray(xs) ? xs.length : 0} muestras; se exigen ${pv.muestras_min ?? 1}`); continue }
          chequear('vitales', `${id} ${modo} · LCP (ms)`, mediana(xs.map((x) => x.lcp)), pv.lcp_ms_max)
          chequear('vitales', `${id} ${modo} · CLS`, mediana(xs.map((x) => x.cls)), pv.cls_max)
          if (conInteraccion.has(id)) chequear('vitales', `${id} ${modo} · interacción (ms)`, mediana(xs.map((x) => x.interaccionMs)), pv.interaccion_ms_max)
        }
      }
      const red = vit.reducido && typeof vit.reducido === 'object' ? vit.reducido : {}
      faltan('reducido', pr.esperados ?? [], Object.keys(red))
      for (const [id, r] of Object.entries(red)) {
        chequear('reducido', `${id} · rAF/s en reposo`, r?.rafPorSeg, pr.raf_por_seg_max)
        chequear('reducido', `${id} · animaciones en curso`, r?.animacionesEnCurso, pr.animaciones_en_curso_max)
      }
    }
  }
  return { filas, problemas }
}
