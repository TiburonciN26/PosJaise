import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { anioMesEnLima, calcularRango, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { calcularCascadaGanancia, calcularGastosProrrateados } from '../lib/finanzas.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import { EsqueletoResumen } from '../components/Esqueleto.jsx'

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

const ETIQUETA_COBERTURA = {
  hoy: 'Gastos diarios cubiertos',
  semana: 'Gastos semanales cubiertos',
  mes: 'Gastos del mes cubiertos',
  personalizado: 'Gastos del período cubiertos',
}

const VERDE = '#3ecf6a'

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
function TextoBrillante({ activo, color, destello = '#f7b3ca', className = '', claseColorInactiva = '', children }) {
  if (!activo) {
    return <span className={`${className} ${claseColorInactiva}`}>{children}</span>
  }
  return (
    <span
      className={`${className} animate-brillo-texto bg-clip-text text-transparent`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${color} 30%, ${destello} 50%, ${color} 70%)`,
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
    <div
      className="relative isolate overflow-hidden rounded-lg border border-purple-300 bg-surface px-4 pb-[11px] pt-[11px]"
      style={
        llegoAlTope
          ? {
              boxShadow:
                '0 0 40px rgba(237,139,172,0.28), inset 0 0 0 1px rgba(255,225,235,0.35), inset 0 -4px 14px rgba(237,139,172,0.12)',
            }
          : undefined
      }
    >
      {llegoAlTope && (
        <>
          {/* Efectos de brillo estáticos (sin movimiento ni puntos) sobre el
              fondo normal: halo rosa, borde luminoso, iridiscencia suave, líneas
              finas y reflejo fijo. Solo aparece al superar el 100% de gastos cubiertos. */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.14]"
            style={{
              background:
                'linear-gradient(120deg,#ffb3d9,#b3e5ff 25%,#d4ffb3 45%,#fff0b3 60%,#d9b3ff 80%,#b3fff6)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'repeating-linear-gradient(90deg,rgba(255,225,235,0.05) 0 1px,transparent 1px 4px)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(circle at 70% 40%,rgba(237,139,172,0.22),rgba(237,139,172,0) 55%)',
            }}
          />
        </>
      )}

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
          color="#ffffff"
          className="text-sm font-semibold"
          claseColorInactiva="text-white"
        >
          Punto de equilibrio
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-white">
          {superado && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <span>
          <TextoBrillante
            activo={llegoAlTope}
            color={superado ? VERDE : '#ffffff'}
            claseColorInactiva={superado ? 'text-green' : 'text-white'}
          >
            {ingresoBruto.toFixed(2)}
          </TextoBrillante>
          <TextoBrillante activo={llegoAlTope} color="#ffffff" claseColorInactiva="text-white">
            {' - '}
            {meta.toFixed(2)}
          </TextoBrillante>
          </span>
        </span>
      </div>

      <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-purple-300 transition-[width] duration-500"
          style={{ width: `${anchoRelleno}%` }}
        />
        <Brillo activo={llegoAlTope} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <TextoBrillante activo={llegoAlTope} color="#ffffff" claseColorInactiva="text-white" className="text-xs">
          {ETIQUETA_COBERTURA[filtro]}
        </TextoBrillante>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-white">
          {porcentaje > 100 && <ArrowUp className="h-3 w-3 animate-elevar-flecha text-green" />}
          <span>
          <TextoBrillante
            activo={llegoAlTope}
            color={porcentaje > 100 ? VERDE : '#ffffff'}
            claseColorInactiva={porcentaje > 100 ? 'text-green' : 'text-white'}
          >
            {Math.round(porcentaje)}%
          </TextoBrillante>
          <TextoBrillante activo={llegoAlTope} color="#ffffff" claseColorInactiva="text-white">
            {' - 100%'}
          </TextoBrillante>
          </span>
        </span>
      </div>
    </div>
  )
}

export default function Dashboard({ activo = true }) {
  const [filtro, setFiltro] = useState('mes')
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
  // QA-031: ventas.total incluye el envío cobrado (se suma después del descuento);
  // antes se restaba de "Descuentos". Ahora el envío es una línea propia y el
  // neto sigue siendo sum(ventas.total): bruto − descuentos + envío cobrado.
  const ingresoNeto = redondear2(ingresoBruto - metricas.descuentos + metricas.envioCobrado)
  const gananciaProductos = metricas.ingresoProductos - metricas.costoProductos

  const { gastosOperativos, utilidadNeta, montoDiezmo, gananciaFinal, metaEquilibrio } =
    calcularCascadaGanancia({
      ingresoBruto: ingresoNeto,
      costoProductos: metricas.costoProductos,
      comisionesPagadas: metricas.comisionesPagadas,
      gastosMes: metricas.gastosMes,
    })

  const pasosPrevios = [
    { etiqueta: 'Ingreso bruto', valor: ingresoBruto },
    { etiqueta: 'Descuentos', valor: -metricas.descuentos },
    { etiqueta: 'Envío cobrado', valor: metricas.envioCobrado },
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
    { etiqueta: 'Envío cobrado', valor: metricas.envioCobrado, positivo: true, clase: 'text-green' },
    { etiqueta: 'Ingreso productos', valor: metricas.ingresoProductos, positivo: true, clase: 'text-amber' },
    { etiqueta: 'Ingreso servicios', valor: metricas.ingresoServicios, positivo: true, clase: 'text-blue' },
    { etiqueta: 'Gastos productos', valor: metricas.costoProductos, positivo: false, clase: 'text-red' },
    { etiqueta: 'Ganancia productos', valor: gananciaProductos, positivo: true, clase: 'text-green' },
    { etiqueta: 'Comisiones a pagar', valor: metricas.comisionesPagadas, positivo: false, clase: 'text-red' },
    { etiqueta: ETIQUETA_GASTOS[filtro], valor: metricas.gastosMes, positivo: false, clase: 'text-blue' },
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
          <div className="contents lg:order-1 lg:col-span-2 lg:flex lg:items-stretch lg:gap-4">
            <div className="order-1 min-w-0 lg:flex-1">
              <BarraTermometro filtro={filtro} ingresoBruto={ingresoNeto} meta={metaEquilibrio} />
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
                  <span className="mx-2 min-w-4 flex-1 translate-y-0.5 border-b border-dashed border-ink/25" />
                  <span className={`font-mono ${fila.clase}`}>
                    {fila.positivo ? '+' : '−'}
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
