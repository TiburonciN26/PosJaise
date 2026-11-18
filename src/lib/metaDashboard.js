// «¿El Dashboard tiene la meta cumplida?» compartido fuera de la pestaña, para que el menú lateral haga brillar la palabra
// «Dashboard» en cualquier pestaña. Un store mínimo de módulo (sin contexto).
//
// Dos fuentes:
//  - El Dashboard, mientras está montado y cargado: publica con el filtro que la usuaria eligió (Hoy/Semana/Mes/…) y manda.
//  - El menú lateral, al abrirse, si el Dashboard no está montado (nunca se abrió en la sesión, o PestanasCacheadas lo
//    desmontó): lo calcula solo con el mismo filtro guardado del Dashboard (por defecto «Mes»), vía actualizarMetaDesdeMenu.
import { useSyncExternalStore } from 'react'
import { leerEstadoVista } from './estadoVista.js'
import { calcularResultadoDashboard, obtenerMetricasDashboard } from './metricasDashboard.js'
import { formatearFechaISO } from './fechas.js'

// Al abrir el menú varias veces seguidas no hace falta volver a consultar: el resultado vale este tiempo.
const VIGENCIA_MS = 60_000

let metaCumplida = false
let dashboardMontado = false
let ultimaConsulta = 0
let consultando = false
const suscriptores = new Set()

function avisar(valor) {
  if (valor === metaCumplida) return
  metaCumplida = valor
  suscriptores.forEach((aviso) => aviso())
}

export function publicarMetaCumplida(valor, { desdeDashboard = false } = {}) {
  if (desdeDashboard) dashboardMontado = true
  avisar(valor)
}

// El Dashboard se desmonta: el valor se conserva, pero la próxima vez que se abra el menú se recalcula.
export function soltarMetaDashboard() {
  dashboardMontado = false
  ultimaConsulta = 0
}

export async function actualizarMetaDesdeMenu() {
  if (dashboardMontado || consultando || Date.now() - ultimaConsulta < VIGENCIA_MS) return
  consultando = true
  try {
    const hoy = formatearFechaISO(new Date())
    const filtro = leerEstadoVista('/dashboard:filtro') ?? 'mes'
    const personalizado = leerEstadoVista('/dashboard:personalizado') ?? { desde: hoy, hasta: hoy }
    const { metricas, error } = await obtenerMetricasDashboard(filtro, personalizado)
    // Si mientras tanto se montó el Dashboard, su valor manda.
    if (error || dashboardMontado) return
    ultimaConsulta = Date.now()
    avisar(calcularResultadoDashboard(metricas).metaCumplida)
  } finally {
    consultando = false
  }
}

function suscribir(aviso) {
  suscriptores.add(aviso)
  return () => suscriptores.delete(aviso)
}

export function useMetaCumplida() {
  return useSyncExternalStore(suscribir, () => metaCumplida)
}
