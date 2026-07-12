import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { anioMesEnLima, calcularRango, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { calcularCascadaGanancia, calcularGastosProrrateados } from '../lib/finanzas.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'

const METRICAS_VACIAS = {
  ingresoProductos: 0,
  ingresoServicios: 0,
  costoProductos: 0,
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

const ETIQUETA_COBERTURA = {
  hoy: 'Gastos diarios cubiertos',
  semana: 'Gastos semanales cubiertos',
  mes: 'Gastos del mes cubiertos',
  personalizado: 'Gastos del período cubiertos',
}

function Brillo({ activo }) {
  if (!activo) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 w-1/3 animate-brillo-barra bg-gradient-to-r from-transparent via-white/25 to-transparent" />
  )
}

// Brillo que recorre solo las letras (no su fondo): se pinta como el propio
// relleno del texto vía background-clip, así el destello ilumina el glifo en
// vez de dibujarse como un cuadro de luz encima de todo. La clase de color
// (text-ink, etc.) va aparte (claseColorInactiva) porque si se mezcla con
// text-transparent en la misma className, cuál gana depende del orden en el
// CSS generado por Tailwind, no del orden en el string — y a veces pierde
// text-transparent, dejando el texto opaco y tapando el degradado.
function TextoBrillante({ activo, color, className = '', claseColorInactiva = '', children }) {
  if (!activo) {
    return <span className={`${className} ${claseColorInactiva}`}>{children}</span>
  }
  return (
    <span
      className={`${className} animate-brillo-texto bg-clip-text text-transparent`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${color} 30%, #ffffff 50%, ${color} 70%)`,
        backgroundSize: '220% 100%',
      }}
    >
      {children}
    </span>
  )
}

function BarraTermometro({ filtro, ingresoBruto, meta }) {
  const porcentaje = meta > 0 ? (ingresoBruto / meta) * 100 : ingresoBruto > 0 ? 100 : 0
  const anchoRelleno = Math.min(porcentaje, 100)
  const superado = meta > 0 ? ingresoBruto > meta : ingresoBruto > 0
  const llegoAlTope = porcentaje >= 100

  return (
    <div className="relative isolate overflow-hidden rounded-lg border border-purple-300 bg-surface px-4 pb-[11px] pt-[11px]">
      {llegoAlTope && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 w-1/2 animate-brillo-tarjeta"
          style={{
            animationDelay: '3s',
            backgroundImage:
              'linear-gradient(100deg, transparent, rgba(216,180,254,0.08), transparent)',
          }}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <TextoBrillante
          activo={llegoAlTope}
          color="#f0ede6"
          className="text-sm font-semibold"
          claseColorInactiva="text-ink"
        >
          Punto de equilibrio
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-ink/60">
          {superado && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.5)">
            {ingresoBruto.toFixed(2)} - {meta.toFixed(2)}
          </TextoBrillante>
        </span>
      </div>

      <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-purple-300/20 to-purple-300 transition-[width] duration-500"
          style={{ width: `${anchoRelleno}%` }}
        />
        <Brillo activo={llegoAlTope} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.6)" className="text-xs">
          {ETIQUETA_COBERTURA[filtro]}
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-ink/60">
          {porcentaje > 100 && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <TextoBrillante activo={llegoAlTope} color="rgba(240,237,230,0.5)">
            {Math.round(porcentaje)}% - 100%
          </TextoBrillante>
        </span>
      </div>
    </div>
  )
}

export default function Dashboard({ activo = true }) {
  const [filtro, setFiltro] = useState('semana')
  const [personalizado, setPersonalizado] = useState(() => {
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
      supabase.from('gastos').select('monto').eq('mes', mesReferenciaIndice + 1).eq('anio', anioReferencia),
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
  const gananciaProductos = metricas.ingresoProductos - metricas.costoProductos

  const { gastosOperativos, utilidadNeta, montoDiezmo, gananciaFinal, metaEquilibrio } =
    calcularCascadaGanancia({
      ingresoBruto,
      costoProductos: metricas.costoProductos,
      gastosMes: metricas.gastosMes,
    })

  const pasosPrevios = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto },
    { etiqueta: '10% gastos operativos (estimado)', valor: -gastosOperativos },
    { etiqueta: 'Costo de productos vendidos', valor: -metricas.costoProductos },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: -metricas.gastosMes },
  ]

  return (
    <div className="p-3 pb-6">
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
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando dashboard...</p>
      ) : (
        <>
          {/* Punto de equilibrio: barra tipo termómetro */}
          <div className="mt-4">
            <BarraTermometro filtro={filtro} ingresoBruto={ingresoBruto} meta={metaEquilibrio} />
          </div>

          {/* Tarjetas: orden personalizado en móvil */}
          <div className="mt-4 grid grid-cols-3 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta="Ingreso bruto"
              valor={formatearSoles(ingresoBruto)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta="Ingreso productos"
              valor={formatearSoles(metricas.ingresoProductos)}
              claseValor="text-amber"
            />
            <TarjetaResumen
              etiqueta="Ingreso servicios"
              valor={formatearSoles(metricas.ingresoServicios)}
              claseValor="text-blue"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta="Costo productos"
              valor={formatearSoles(metricas.costoProductos)}
              claseValor="text-red"
            />
            <TarjetaResumen
              etiqueta="Ganancia productos"
              valor={formatearSoles(gananciaProductos)}
              claseValor="text-green"
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:hidden">
            <TarjetaResumen
              etiqueta={ETIQUETA_GASTOS[filtro]}
              valor={formatearSoles(metricas.gastosMes)}
              claseValor="text-blue"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:hidden">
            <TarjetaResumen etiqueta="Ventas" valor={metricas.cantidadVentas} />
            <TarjetaResumen
              etiqueta="Productos vendidos"
              valor={`${metricas.productosVendidos} uds.`}
              claseValor="text-ink"
            />
            <TarjetaResumen etiqueta="Servicios realizados" valor={metricas.serviciosRealizados} />
          </div>

          {/* Tarjetas: tablet y desktop */}
          <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-3">
            <TarjetaResumen
              etiqueta="Ingreso bruto total"
              valor={formatearSoles(ingresoBruto)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta="Ingreso por productos"
              valor={formatearSoles(metricas.ingresoProductos)}
              claseValor="text-amber"
            />
            <TarjetaResumen
              etiqueta="Ingreso por servicios"
              valor={formatearSoles(metricas.ingresoServicios)}
              claseValor="text-blue"
            />
            <TarjetaResumen
              etiqueta="Costo de productos vendidos"
              valor={formatearSoles(metricas.costoProductos)}
              claseValor="text-red"
            />
            <TarjetaResumen
              etiqueta="Ganancia de productos"
              valor={formatearSoles(gananciaProductos)}
              claseValor="text-green"
            />
            <TarjetaResumen
              etiqueta={ETIQUETA_GASTOS[filtro]}
              valor={formatearSoles(metricas.gastosMes)}
              claseValor="text-blue"
            />
            <TarjetaResumen etiqueta="Cantidad de ventas" valor={metricas.cantidadVentas} />
            <TarjetaResumen
              etiqueta="Productos vendidos"
              valor={`${metricas.productosVendidos} uds.`}
              claseValor="text-ink"
            />
            <TarjetaResumen
              etiqueta="Servicios realizados"
              valor={metricas.serviciosRealizados}
            />
          </div>

          {/* Cascada de ganancia */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Cascada de ganancia</h2>
            <div className="mt-3 space-y-2">
              {pasosPrevios.map((paso) => (
                <div key={paso.etiqueta} className="flex items-center justify-between text-sm">
                  <span className="text-ink/60">{paso.etiqueta}</span>
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
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatearSoles(utilidadNeta)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-ink/60">10% diezmo</span>
                <span className="font-mono text-red">− {formatearSoles(montoDiezmo)}</span>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-semibold text-ink">Ganancia final</span>
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
        </>
      )}
    </div>
  )
}
