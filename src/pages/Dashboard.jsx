import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { anioMesEnLima, calcularRango, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { calcularCascadaGanancia, calcularGastosProrrateados } from '../lib/finanzas.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import { EsqueletoResumen } from '../components/Esqueleto.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import TarjetaPuntoEquilibrio, { porcentajeEquilibrio } from '../components/TarjetaPuntoEquilibrio.jsx'

const METRICAS_VACIAS = {
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

const ETIQUETA_GASTOS = {
  hoy: 'Gastos del día (prorrateado)',
  semana: 'Gastos de la semana (mes ÷ 4)',
  mes: 'Gastos fijos + variables del mes',
  personalizado: 'Gastos del período (prorrateado)',
}

export default function Dashboard({ activo = true }) {
  const [filtro, setFiltro] = useEstadoVista('/dashboard:filtro', 'mes')
  const [personalizado, setPersonalizado] = useEstadoVista('/dashboard:personalizado', () => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [metricas, setMetricas] = useState(METRICAS_VACIAS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const primeraCargaHecha = useRef(false)

  async function cargarDatos(vigente, silencioso) {
    if (!silencioso) setCargando(true)
    setError(null)
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

    if (!vigente.actual) return

    if (resumenRes.error) {
      setError('No se pudo cargar el dashboard.')
      setMetricas(METRICAS_VACIAS)
      setCargando(false)
      return
    }

    const fila = resumenRes.data?.[0]
    const gastosMesTotal = sumarMontos(gastosRes.data ?? [], (g) => g.monto)

    const gastosProrrateados = calcularGastosProrrateados({
      filtro,
      gastosMesTotal,
      anio: anioReferencia,
      mes: mesReferenciaIndice,
      desde,
      hasta,
    })

    setMetricas({
      ingresoProductos: redondear2(fila?.ingreso_productos ?? 0),
      ingresoServicios: redondear2(fila?.ingreso_servicios ?? 0),
      costoProductos: redondear2(fila?.costo_productos ?? 0),
      comisionesPagadas: redondear2(fila?.comisiones_pagadas ?? 0),
      descuentos: redondear2(fila?.descuentos ?? 0),
      envioCobrado: redondear2(fila?.envio_cobrado ?? 0),
      productosVendidos: fila?.productos_vendidos ?? 0,
      serviciosRealizados: fila?.servicios_realizados ?? 0,
      cantidadVentas: fila?.cantidad_ventas ?? 0,
      gastosMes: gastosProrrateados,
    })
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDatos(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, filtro, personalizado.desde, personalizado.hasta])

  const ingresoBruto = metricas.ingresoProductos + metricas.ingresoServicios
  // QA-024: ingresoProductos/ingresoServicios suman venta_items.subtotal (antes
  // del descuento de la venta). Estadísticas parte de sum(ventas.total), ya
  // descontado — la cascada debe partir del mismo ingreso neto en ambas
  // pantallas, o la ganancia final difiere para el mismo período.
  //
  // QA-031 separó el envío de "Descuentos" (ventas.total lo incluye). Desde el
  // 2026-11-12 el envío NO es ingreso: la clienta lo paga y se le entrega
  // completo al repartidor, así que contarlo inflaba la ganancia en ese monto.
  // Neto = bruto − descuentos = sum(ventas.total − envío), el mismo "Ingreso
  // neto" de Estadísticas (migración 20261112000007). envioCobrado queda solo
  // como dato informativo en el Resumen del período.
  const ingresoNeto = redondear2(ingresoBruto - metricas.descuentos)
  const gananciaProductos = metricas.ingresoProductos - metricas.costoProductos

  const { gastosOperativos, utilidadNeta, montoDiezmo, gananciaFinal, metaEquilibrio } =
    calcularCascadaGanancia({
      ingresoBruto: ingresoNeto,
      costoProductos: metricas.costoProductos,
      comisionesPagadas: metricas.comisionesPagadas,
      gastosMes: metricas.gastosMes,
    })
  const metaCumplida = porcentajeEquilibrio(ingresoNeto, metaEquilibrio) >= 100

  const pasosPrevios = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto },
    { etiqueta: 'Descuentos', valor: -metricas.descuentos },
    { etiqueta: '10% gastos operativos (estimado)', valor: -gastosOperativos },
    { etiqueta: 'Costo de productos vendidos', valor: -metricas.costoProductos },
    { etiqueta: 'Comisión pagada a asistentes', valor: -metricas.comisionesPagadas },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: -metricas.gastosMes },
  ]

  // Resumen del período como lista (reemplaza las tarjetas sueltas de estos
  // 7 montos) — mismo formato visual que la cascada de ganancia de más
  // abajo, cada fila conserva el color que tenía su tarjeta.
  const filasResumen = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto, positivo: true, clase: 'text-green' },
    { etiqueta: 'Descuentos', valor: metricas.descuentos, positivo: false, clase: 'text-red' },
    { etiqueta: 'Ingreso productos', valor: metricas.ingresoProductos, positivo: true, clase: 'text-amber' },
    { etiqueta: 'Ingreso servicios', valor: metricas.ingresoServicios, positivo: true, clase: 'text-blue' },
    { etiqueta: 'Gastos productos', valor: metricas.costoProductos, positivo: false, clase: 'text-red' },
    { etiqueta: 'Ganancia productos', valor: gananciaProductos, positivo: true, clase: 'text-green' },
    { etiqueta: 'Comisiones a pagar', valor: metricas.comisionesPagadas, positivo: false, clase: 'text-red' },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: metricas.gastosMes, positivo: false, clase: 'text-blue' },
    // Solo informativo (sin signo, en gris): el envío pasa al repartidor y no
    // entra en ningún cálculo de ganancia.
    {
      etiqueta: 'Envío cobrado',
      nota: 'pasa al repartidor',
      valor: metricas.envioCobrado,
      informativo: true,
      clase: 'text-ink/50',
    },
  ]

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Filtros de fecha: fijos arriba al hacer scroll */}
      <FiltrosFecha
        filtro={filtro}
        onCambiarFiltro={setFiltro}
        personalizado={personalizado}
        onCambiarPersonalizado={setPersonalizado}
        tema="purple-300"
        padding="ancha"
        disenoFechas="apilado"
        sticky
      />

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoResumen cantidad={9} />
      ) : (
        <>
          <div className="mt-(--separador-horizontal) flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
          {/* PC: punto de equilibrio a la izquierda y totales a la derecha
              (cada tarjeta del ancho de su contenido). En móvil el wrapper
              desaparece (contents) y cada hijo conserva su orden original. */}
          {/* Meta cumplida: la pastilla "¡Meta cumplida!" y el confeti salen
              por encima de la tarjeta — pt-8 les deja ese espacio (en móvil
              sobre la tarjeta; en PC sobre toda la fila, para que las
              tarjetas de totales sigan alineadas con ella). */}
          <div
            className={`contents lg:order-1 lg:col-span-2 lg:flex lg:items-stretch lg:gap-4 ${
              metaCumplida ? 'lg:pt-8' : ''
            }`}
          >
            <div className={`order-1 min-w-0 lg:flex-1 ${metaCumplida ? 'pt-8 lg:pt-0' : ''}`}>
              <TarjetaPuntoEquilibrio filtro={filtro} ingreso={ingresoNeto} meta={metaEquilibrio} />
            </div>
            <div className="order-3 grid grid-cols-3 gap-3 lg:flex lg:shrink-0 lg:gap-3 [&>*]:lg:flex [&>*]:lg:flex-col [&>*]:lg:justify-center [&>*]:lg:whitespace-nowrap">
              <TarjetaResumen etiqueta="Ventas" valor={metricas.cantidadVentas} />
              <TarjetaResumen
                etiqueta="Productos vendidos"
                valor={`${metricas.productosVendidos} uds.`}
                claseValor="text-ink"
              />
              <TarjetaResumen etiqueta="Servicios realizados" valor={metricas.serviciosRealizados} />
            </div>
          </div>

          {/* Resumen del período: lista (antes eran tarjetas sueltas) */}
          <div className="rounded-lg border border-border bg-surface p-4 order-2 lg:order-2">
            <h2 className="text-sm font-semibold text-ink">Resumen del período</h2>
            <div className="mt-3 space-y-2">
              {filasResumen.map((fila) => (
                <div key={fila.etiqueta} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{fila.etiqueta}</span>
                  {/* Nota como hermana (no dentro) de la etiqueta: los e2e buscan
                      la etiqueta por texto exacto y suben a esta fila. */}
                  {fila.nota && <span className="ml-1 shrink-0 text-xs text-ink/40">({fila.nota})</span>}
                  <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                  <span className={`font-mono ${fila.clase}`}>
                    {!fila.informativo && (fila.positivo ? '+' : '−')}
                    {formatearSoles(Math.abs(fila.valor))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Cascada de ganancia */}
          <div className="rounded-lg border border-border bg-surface p-4 order-4 lg:order-3">
            <h2 className="text-sm font-semibold text-ink">Cascada de ganancia</h2>
            <div className="mt-3 space-y-2">
              {pasosPrevios.map((paso) => (
                <div key={paso.etiqueta} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{paso.etiqueta}</span>
                  <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                  <span
                    className={`font-mono ${paso.valor < 0 ? 'text-red' : 'text-green'}`}
                  >
                    {paso.valor < 0 ? '− ' : ''}
                    {formatearSoles(Math.abs(paso.valor))}
                  </span>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm text-ink/70">Utilidad neta</span>
                <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatearSoles(utilidadNeta)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-ink/60">10% diezmo</span>
                <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                <span className="font-mono text-red">− {formatearSoles(montoDiezmo)}</span>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-semibold text-ink">Ganancia final</span>
                <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                <span
                  className={`font-mono text-lg font-semibold ${
                    gananciaFinal < 0 ? 'text-red' : 'text-green'
                  }`}
                >
                  {formatearSoles(gananciaFinal)}
                </span>
              </div>
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
