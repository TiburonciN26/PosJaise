// Consulta y cálculo de las métricas del Dashboard, compartidos entre la pestaña y el menú lateral (que hace brillar
// «Dashboard» con la meta cumplida aunque la pestaña nunca se haya abierto en la sesión). Una sola fuente para que los dos
// lleguen siempre al mismo «¿meta cumplida?».
import { supabase } from './supabase.js'
import { anioMesEnLima, calcularRango } from './fechas.js'
import { redondear2, sumarMontos } from './moneda.js'
import { calcularCascadaGanancia, calcularGastosProrrateados } from './finanzas.js'

// Misma fórmula que porcentajeEquilibrio de TarjetaPuntoEquilibrio.jsx. Copiada aquí para que el menú lateral (que carga
// siempre) no arrastre el componente de la tarjeta; si cambia una, cambiar la otra.
function porcentajeEquilibrio(ingreso, meta) {
  if (meta > 0) return (ingreso / meta) * 100
  return ingreso > 0 ? 100 : 0
}

export const METRICAS_VACIAS = {
  ingresoProductos: 0,
  ingresoServicios: 0,
  costoProductos: 0,
  comisionesPagadas: 0,
  descuentos: 0,
  envioCobrado: 0,
  productosVendidos: 0,
  serviciosRealizados: 0,
  cantidadVentas: 0,
  gastosMes: 0,
}

// Devuelve { metricas } o { error } (el RPC falló). El de gastos que falle cuenta como 0, igual que antes.
export async function obtenerMetricasDashboard(filtro, personalizado) {
  const { desde, hasta } = calcularRango(filtro, personalizado)

  // Mes de referencia para los gastos: el mes donde empieza el rango
  // evaluado (mismo criterio para los 4 filtros, y para el período
  // "anterior" que calcula Estadísticas).
  const { anio: anioReferencia, mes: mesReferenciaIndice } = anioMesEnLima(desde)

  // A3 de la 3ª auditoría: antes traía todas las ventas del período con
  // venta_items embebidos (+ una consulta a productos_vista por el costo)
  // solo para sumar en el navegador. resumen_dashboard() hace esas sumas
  // en Postgres y devuelve 6 escalares — nunca las filas crudas.
  const [resumenRes, gastosRes] = await Promise.all([
    supabase.rpc('resumen_dashboard', {
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
    }),
    // Solo gastos ACTIVOS: los cancelados (en Gastos o al anular una salida de Caja chica) ya no se pagaron.
    supabase
      .from('gastos')
      .select('monto')
      .eq('mes', mesReferenciaIndice + 1)
      .eq('anio', anioReferencia)
      .eq('estado', 'ACTIVO'),
  ])

  if (resumenRes.error) return { error: resumenRes.error }

  const fila = resumenRes.data?.[0]
  const gastosMesTotal = sumarMontos(gastosRes.data ?? [], (g) => g.monto)

  return {
    metricas: {
      ingresoProductos: redondear2(fila?.ingreso_productos ?? 0),
      ingresoServicios: redondear2(fila?.ingreso_servicios ?? 0),
      costoProductos: redondear2(fila?.costo_productos ?? 0),
      comisionesPagadas: redondear2(fila?.comisiones_pagadas ?? 0),
      descuentos: redondear2(fila?.descuentos ?? 0),
      envioCobrado: redondear2(fila?.envio_cobrado ?? 0),
      productosVendidos: fila?.productos_vendidos ?? 0,
      serviciosRealizados: fila?.servicios_realizados ?? 0,
      cantidadVentas: fila?.cantidad_ventas ?? 0,
      gastosMes: calcularGastosProrrateados({
        filtro,
        gastosMesTotal,
        anio: anioReferencia,
        mes: mesReferenciaIndice,
        desde,
        hasta,
      }),
    },
  }
}

// La cascada completa a partir de las métricas. Ver en Dashboard.jsx el porqué del ingreso neto (QA-024, QA-031: el
// envío no es ingreso, se le entrega al repartidor).
export function calcularResultadoDashboard(metricas) {
  // ingresoProductos/ingresoServicios ya vienen DESPUÉS de descuentos (migración 20261122000002: el descuento de cada venta se
  // reparte entre sus ítems), o sea lo que de verdad entró. `descuentos` queda como dato informativo: no se resta otra vez.
  const ingresoBruto = redondear2(metricas.ingresoProductos + metricas.ingresoServicios)
  const ingresoNeto = ingresoBruto
  const cascada = calcularCascadaGanancia({
    ingresoBruto: ingresoNeto,
    costoProductos: metricas.costoProductos,
    comisionesPagadas: metricas.comisionesPagadas,
    gastosMes: metricas.gastosMes,
  })
  return {
    ingresoBruto,
    ingresoNeto,
    ...cascada,
    metaCumplida: porcentajeEquilibrio(ingresoNeto, cascada.metaEquilibrio) >= 100,
  }
}
