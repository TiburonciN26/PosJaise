// Consultas del «Detalle del período» del Dashboard. Mismo contrato que obtenerMetricasDashboard: devuelve
// { filas } o { error }; un fallo NUNCA se presenta como «no hay datos».
import { supabase } from './supabase.js'
import { anioMesEnLima, calcularRango } from './fechas.js'

// Ventas, servicios, descuentos, comisiones y envíos salen de la RPC detalle_dashboard (migración 20261121000001), que usa
// los mismos filtros que resumen_dashboard para que cada lista cuadre con su monto del Resumen.
export async function obtenerDetalleDashboard(seccion, filtro, personalizado) {
  const { desde, hasta } = calcularRango(filtro, personalizado)
  const { data, error } = await supabase.rpc('detalle_dashboard', {
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
    p_seccion: seccion,
  })
  if (error) return { error }
  return { filas: Array.isArray(data) ? data : [] }
}

// Gastos: son del MES (no tienen día), igual que en obtenerMetricasDashboard: mes donde empieza el rango, solo ACTIVOS.
// El monto prorrateado al período lo calcula el Dashboard (metricas.gastosMes) y se muestra aparte.
export async function obtenerDetalleGastos(filtro, personalizado) {
  const { desde } = calcularRango(filtro, personalizado)
  const { anio, mes } = anioMesEnLima(desde)
  const { data, error } = await supabase
    .from('gastos')
    .select('id, nombre, tipo, monto')
    .eq('mes', mes + 1)
    .eq('anio', anio)
    .eq('estado', 'ACTIVO')
    .order('monto', { ascending: false })
    .order('id')
  if (error) return { error }
  return { filas: data ?? [] }
}
