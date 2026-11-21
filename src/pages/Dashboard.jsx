import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import { EsqueletoResumen } from '../components/Esqueleto.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import TarjetaPuntoEquilibrio from '../components/TarjetaPuntoEquilibrio.jsx'
import { publicarMetaCumplida, soltarMetaDashboard } from '../lib/metaDashboard.js'
import {
  METRICAS_VACIAS,
  calcularResultadoDashboard,
  obtenerMetricasDashboard,
} from '../lib/metricasDashboard.js'

const ETIQUETA_GASTOS = {
  hoy: 'Gastos del día (prorrateado)',
  semana: 'Gastos de la semana (mes ÷ 4)',
  mes: 'Gastos fijos + variables del mes',
  personalizado: 'Gastos del período (prorrateado)',
}

// Fila «etiqueta ······ monto» del Resumen y de la Cascada. En móvil la
// etiqueta puede partirse en dos líneas, pero el monto nunca (antes «−S/»
// quedaba arriba y «356.00» abajo aunque hubiera sitio), y el punteado se
// achica antes de empujar al texto. Estructura que leen los e2e
// (importeFilaDashboard): la etiqueta es hija directa de la fila y el monto
// es el único span.font-mono con dígitos.
function FilaMonto({ etiqueta, nota, claseEtiqueta = 'text-sm text-ink/60', claseMonto, className = '', children }) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span className={`min-w-0 ${claseEtiqueta}`}>{etiqueta}</span>
      {nota && <span className="ml-1 shrink-0 text-xs text-ink/40">({nota})</span>}
      <span className="mx-1.5 min-w-2 flex-1 translate-y-0.5 border-b border-dashed border-ink/25 sm:mx-2 sm:min-w-4" />
      <span className={`shrink-0 whitespace-nowrap font-mono ${claseMonto}`}>{children}</span>
    </div>
  )
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

  // La consulta (resumen_dashboard + gastos del mes prorrateados) vive en lib/metricasDashboard.js: el menú lateral la usa
  // también para saber si la meta está cumplida sin que esta pestaña se haya abierto.
  async function cargarDatos(vigente, silencioso) {
    if (!silencioso) setCargando(true)
    setError(null)
    const { metricas: nuevas, error: errorMetricas } = await obtenerMetricasDashboard(filtro, personalizado)

    if (!vigente.actual) return

    if (errorMetricas) {
      setError('No se pudo cargar el dashboard.')
      setMetricas(METRICAS_VACIAS)
      setCargando(false)
      return
    }

    setMetricas(nuevas)
    setCargando(false)
  }

  // useEffectEvent: el efecto corre solo cuando cambian sus dependencias, pero llama a la versión más reciente
  // de cargarDatos (lee los filtros actuales) sin volver a dispararse cada vez que esa función se recrea.
  const cargarDesdeEfecto = useEffectEvent((vigente, silencioso) => cargarDatos(vigente, silencioso))
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDesdeEfecto(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, filtro, personalizado.desde, personalizado.hasta])

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
  // (El cálculo está en calcularResultadoDashboard, compartido con el menú lateral.)
  const gananciaProductos = metricas.ingresoProductos - metricas.costoProductos

  const {
    ingresoBruto,
    ingresoNeto,
    gastosOperativos,
    utilidadNeta,
    montoDiezmo,
    gananciaFinal,
    metaEquilibrio,
    metaCumplida,
  } = calcularResultadoDashboard(metricas)
  // El menú lateral hace brillar la palabra «Dashboard» con la meta cumplida. Mientras esta pestaña está montada y ya
  // cargó, ella manda (con el filtro que la usuaria eligió); si se desmonta, el menú vuelve a calcularlo solo.
  useEffect(() => {
    if (!cargando && !error) publicarMetaCumplida(metaCumplida, { desdeDashboard: true })
  }, [metaCumplida, cargando, error])
  useEffect(() => () => soltarMetaDashboard(), [])

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
              desaparece (contents) y cada hijo conserva su orden original.
              La pastilla «¡Meta cumplida!» sale en medio de la tarjeta, así
              que ya no hace falta reservar espacio arriba. */}
          <div className="contents lg:order-1 lg:col-span-2 lg:flex lg:items-stretch lg:gap-4">
            <div className="order-1 min-w-0 lg:flex-1">
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
                <FilaMonto
                  key={fila.etiqueta}
                  etiqueta={fila.etiqueta}
                  nota={fila.nota}
                  claseMonto={`text-sm ${fila.clase}`}
                  // El envío va aparte, bajo una línea: es solo informativo
                  // y no entra en ninguna suma.
                  className={fila.informativo ? 'border-t border-border pt-2' : ''}
                >
                  {!fila.informativo && (fila.positivo ? '+' : '−')}
                  {formatearSoles(Math.abs(fila.valor))}
                </FilaMonto>
              ))}
            </div>
          </div>

          {/* Cascada de ganancia */}
          <div className="rounded-lg border border-border bg-surface p-4 order-4 lg:order-3">
            <h2 className="text-sm font-semibold text-ink">Cascada de ganancia</h2>
            <div className="mt-3 space-y-2">
              {pasosPrevios.map((paso) => (
                <FilaMonto
                  key={paso.etiqueta}
                  etiqueta={paso.etiqueta}
                  claseMonto={`text-sm ${paso.valor < 0 ? 'text-red' : 'text-green'}`}
                >
                  {paso.valor < 0 ? '−' : ''}
                  {formatearSoles(Math.abs(paso.valor))}
                </FilaMonto>
              ))}

              <FilaMonto
                etiqueta="Utilidad neta"
                claseEtiqueta="text-sm text-ink/70"
                claseMonto="text-sm font-semibold text-ink"
                className="border-t border-border pt-2"
              >
                {formatearSoles(utilidadNeta)}
              </FilaMonto>

              <FilaMonto etiqueta="10% diezmo" claseMonto="text-sm text-red">
                −{formatearSoles(montoDiezmo)}
              </FilaMonto>

              <FilaMonto
                etiqueta="Ganancia final"
                claseEtiqueta="text-sm font-semibold text-ink"
                claseMonto={`text-lg font-semibold ${gananciaFinal < 0 ? 'text-red' : 'text-green'}`}
                className="border-t border-border pt-2"
              >
                {formatearSoles(gananciaFinal)}
              </FilaMonto>
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
