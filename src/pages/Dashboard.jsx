import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import { EsqueletoResumen } from '../components/Esqueleto.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import TarjetaPuntoEquilibrio from '../components/TarjetaPuntoEquilibrio.jsx'
import DetalleDashboard from '../components/DetalleDashboard.jsx'
import { PESTANA_INICIAL_DETALLE, esPestanaDetalle } from '../lib/detalleDashboard.js'
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

  // Pestaña abierta de «Detalle del período» (sobrevive a que la pantalla se desmonte, como el filtro de fechas).
  const [pestanaDetalle, setPestanaDetalle] = useEstadoVista('/dashboard:detalle', PESTANA_INICIAL_DETALLE)
  const tarjetaDetalle = useRef(null)
  // Alto de la barra de fechas fija (la primera hija «sticky»): el buscador del detalle se pega justo debajo, no encima.
  const raiz = useRef(null)
  useLayoutEffect(() => {
    const nodo = raiz.current
    const barra = nodo?.querySelector(':scope > .sticky')
    if (!nodo || !barra) return undefined
    const medir = () => nodo.style.setProperty('--alto-filtros', `${barra.offsetHeight}px`)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(barra)
    return () => observador.disconnect()
  }, [])
  // Sube con cada lectura de métricas: el detalle descarta lo que ya había leído y vuelve a pedirlo.
  const [versionDatos, setVersionDatos] = useState(0)

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
    setVersionDatos((n) => n + 1)
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

  // QA-024: Estadísticas parte de sum(ventas.total), ya descontado — la cascada debe partir del mismo ingreso en ambas
  // pantallas, o la ganancia final difiere para el mismo período. Desde 2026-11-22 (migración 20261122000002)
  // ingresoProductos/ingresoServicios ya son lo que de verdad entró: el descuento de cada venta se reparte entre sus ítems
  // (antes sumaban venta_items.subtotal, el importe ANTES del descuento, y el «bruto» mostraba plata que nunca entró). Por eso
  // «Descuentos» es solo informativo (ya está restado) y la cascada no lo vuelve a restar.
  //
  // QA-031 separó el envío de "Descuentos" (ventas.total lo incluye). Desde el
  // 2026-11-12 el envío NO es ingreso: la clienta lo paga y se le entrega
  // completo al repartidor, así que contarlo inflaba la ganancia en ese monto.
  // Ingreso = sum(ventas.total − envío), el mismo "Ingreso neto" de Estadísticas
  // (migración 20261112000007). envioCobrado queda solo como dato informativo
  // en el Resumen del período.
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
    { etiqueta: '10% gastos operativos (estimado)', valor: -gastosOperativos },
    { etiqueta: 'Costo de productos vendidos', valor: -metricas.costoProductos },
    { etiqueta: 'Comisión pagada a asistentes', valor: -metricas.comisionesPagadas },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: -metricas.gastosMes },
  ]

  // Resumen del período como lista (reemplaza las tarjetas sueltas de estos
  // 7 montos) — mismo formato visual que la cascada de ganancia de más
  // abajo, cada fila conserva el color que tenía su tarjeta.
  const filasResumen = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto, positivo: true, clase: 'text-green', pestana: 'productos' },
    { etiqueta: 'Ingreso productos', valor: metricas.ingresoProductos, positivo: true, clase: 'text-amber', pestana: 'productos' },
    { etiqueta: 'Ingreso servicios', valor: metricas.ingresoServicios, positivo: true, clase: 'text-blue', pestana: 'servicios' },
    // Solo informa cuánto se descontó: ya está restado del ingreso de arriba (no se resta otra vez en la cascada).
    { etiqueta: 'Descuentos', nota: 'ya restados del ingreso', valor: metricas.descuentos, positivo: false, clase: 'text-red', pestana: 'descuentos' },
    { etiqueta: 'Gastos productos', valor: metricas.costoProductos, positivo: false, clase: 'text-red', pestana: 'productos' },
    { etiqueta: 'Ganancia productos', valor: gananciaProductos, positivo: true, clase: 'text-green', pestana: 'productos' },
    { etiqueta: 'Comisiones a pagar', valor: metricas.comisionesPagadas, positivo: false, clase: 'text-red', pestana: 'comisiones' },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: metricas.gastosMes, positivo: false, clase: 'text-blue', pestana: 'gastos' },
    // Solo informativo (sin signo, en gris): el envío pasa al repartidor y no
    // entra en ningún cálculo de ganancia.
    {
      etiqueta: 'Envío cobrado',
      nota: 'pasa al repartidor',
      valor: metricas.envioCobrado,
      informativo: true,
      clase: 'text-ink/50',
      pestana: 'envios',
    },
  ]

  // Tocar una fila del Resumen abre su pestaña en «Detalle del período» y baja hasta ella.
  function abrirDetalle(pestana) {
    if (!esPestanaDetalle(pestana)) return
    setPestanaDetalle(pestana)
    tarjetaDetalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      ref={raiz}
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
            <p className="mt-0.5 text-xs text-ink/50">Toca una fila para ver su detalle.</p>
            <div className="mt-3 space-y-1">
              {filasResumen.map((fila) => (
                // El botón envuelve la fila sin cambiar su estructura (etiqueta hija directa, monto único span.font-mono).
                <button
                  key={fila.etiqueta}
                  type="button"
                  onClick={() => abrirDetalle(fila.pestana)}
                  aria-label={`Ver detalle de ${fila.etiqueta}`}
                  className={`-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-3 ${
                    fila.informativo ? 'mt-1 border-t border-border pt-2' : ''
                  }`}
                >
                  <FilaMonto
                    etiqueta={fila.etiqueta}
                    nota={fila.nota}
                    claseMonto={`text-sm ${fila.clase}`}
                  >
                    {!fila.informativo && (fila.positivo ? '+' : '−')}
                    {formatearSoles(Math.abs(fila.valor))}
                  </FilaMonto>
                </button>
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

          <DetalleDashboard
            ref={tarjetaDetalle}
            pestana={pestanaDetalle}
            onCambiarPestana={setPestanaDetalle}
            filtro={filtro}
            personalizado={personalizado}
            activo={activo}
            version={versionDatos}
            gastosPeriodo={metricas.gastosMes}
            etiquetaGastos={ETIQUETA_GASTOS[filtro]}
          />
        </>
      )}
    </div>
  )
}
