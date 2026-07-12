import { useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import {
  anioMesEnLima,
  calcularRango,
  formatearFechaISO,
  iniciarMesLima,
  parsearFechaISOLima,
  sumarDias,
} from '../lib/fechas.js'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { calcularCascadaGanancia, calcularGastosProrrateados } from '../lib/finanzas.js'
import FiltrosFecha from '../components/FiltrosFecha.jsx'

const CLASE_METODO_PAGO = {
  Efectivo: 'bg-green',
  Tarjeta: 'bg-blue',
  Transferencia: 'bg-gray-300',
  Yape: 'bg-purple-300',
}

const RESUMEN_VACIO = {
  ingresoBruto: 0,
  gananciaFinal: 0,
  cantidadVentas: 0,
  ticketPromedio: 0,
  tendencia: [],
  topProductos: [],
  topServicios: [],
  metodosPago: [],
}

function formatearFechaCorta(fechaIso) {
  const fecha = parsearFechaISOLima(fechaIso)
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'America/Lima' })
    .format(fecha)
    .replace('.', '')
}

function calcularRangoAnterior(filtro, rangoActual) {
  if (filtro === 'mes') {
    const { anio, mes } = anioMesEnLima(rangoActual.desde)
    const inicioMesAnterior = mes === 0 ? iniciarMesLima(anio - 1, 11) : iniciarMesLima(anio, mes - 1)
    return { desde: inicioMesAnterior, hasta: rangoActual.desde }
  }

  const duracionMs = rangoActual.hasta.getTime() - rangoActual.desde.getTime()
  return {
    desde: new Date(rangoActual.desde.getTime() - duracionMs),
    hasta: rangoActual.desde,
  }
}

// M3 de la 2ª auditoría: antes traía todas las ventas del período con
// venta_items embebidos (dos veces: actual + anterior) solo para sumar y
// agrupar en el navegador. resumen_estadisticas() hace esas sumas/GROUP BY
// en Postgres y devuelve ya agregado — nunca las filas crudas.
async function resumenPeriodo(desde, hasta, filtro) {
  const { data, error } = await supabase.rpc('resumen_estadisticas', {
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  })
  if (error) throw error

  const fila = data?.[0]
  const ingresoBruto = fila?.ingreso_bruto ?? 0
  const cantidadVentas = fila?.cantidad_ventas ?? 0
  const costoProductos = fila?.costo_productos ?? 0

  const { anio, mes } = anioMesEnLima(desde)
  const { data: gastosData } = await supabase
    .from('gastos')
    .select('monto')
    .eq('mes', mes + 1)
    .eq('anio', anio)
  const gastosMesTotal = sumarMontos(gastosData ?? [], (g) => g.monto)
  const gastosMes = calcularGastosProrrateados({ filtro, gastosMesTotal, anio, mes, desde, hasta })

  const { gananciaFinal } = calcularCascadaGanancia({ ingresoBruto, costoProductos, gastosMes })
  const ticketPromedio = cantidadVentas > 0 ? redondear2(ingresoBruto / cantidadVentas) : 0

  return {
    ingresoBruto,
    gananciaFinal,
    cantidadVentas,
    ticketPromedio,
    tendencia: fila?.tendencia ?? [],
    topProductos: fila?.top_productos ?? [],
    topServicios: fila?.top_servicios ?? [],
    metodosPago: fila?.metodos_pago ?? [],
  }
}

function nombreUsuario(registro) {
  const usuarios = registro?.usuarios
  if (!usuarios) return 'Sin nombre'
  return Array.isArray(usuarios) ? (usuarios[0]?.nombre_completo ?? 'Sin nombre') : (usuarios.nombre_completo ?? 'Sin nombre')
}

function rolUsuario(registro) {
  const usuarios = registro?.usuarios
  if (!usuarios) return null
  return Array.isArray(usuarios) ? (usuarios[0]?.rol ?? null) : (usuarios.rol ?? null)
}

function variacion(actual, anterior) {
  if (anterior === 0) return null
  return ((actual - anterior) / Math.abs(anterior)) * 100
}

function TarjetaComparativa({ etiqueta, valor, anterior, esMoneda = true }) {
  const delta = variacion(valor, anterior)
  const subio = delta != null && delta >= 0

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <p className="text-xs text-ink/60">{etiqueta}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink sm:text-xl">
        {esMoneda ? formatearSoles(valor) : valor}
      </p>
      {delta != null ? (
        <div className={`mt-0.5 flex items-center gap-1 text-xs ${subio ? 'text-green' : 'text-red'}`}>
          {subio ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span className="font-mono">{Math.abs(delta).toFixed(0)}%</span>
          <span className="text-ink/60">vs. período anterior</span>
        </div>
      ) : (
        <p className="mt-0.5 text-xs text-ink/60">Sin datos del período anterior</p>
      )}
    </div>
  )
}

function BarraHorizontal({ etiqueta, valor, maximo, detalle, color = 'bg-purple-300' }) {
  const ancho = maximo > 0 ? Math.max((valor / maximo) * 100, 4) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-ink">{etiqueta}</span>
        <span className="shrink-0 font-mono text-xs text-ink/60">{detalle}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${ancho}%` }} />
      </div>
    </div>
  )
}

function GraficoTendencia({ dias }) {
  const [activo, setActivo] = useState(null)
  const maximo = Math.max(...dias.map((d) => d.monto), 1)

  return (
    <div className="overflow-x-auto">
      <div className="flex h-32 min-w-max items-end gap-1.5 px-1">
        {dias.map((dia, indice) => {
          const alturaPct = Math.max((dia.monto / maximo) * 100, dia.monto > 0 ? 3 : 0)
          return (
            <div
              key={dia.fecha}
              className="relative flex h-full w-6 shrink-0 flex-col items-center justify-end"
              onMouseEnter={() => setActivo(indice)}
              onMouseLeave={() => setActivo(null)}
              onTouchStart={() => setActivo(indice)}
              onTouchEnd={() => setActivo(null)}
              onTouchCancel={() => setActivo(null)}
            >
              {activo === indice && (
                <div className="absolute -top-7 z-10 whitespace-nowrap rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[10px] text-ink shadow-lg">
                  {formatearSoles(dia.monto)}
                </div>
              )}
              <div
                className={`w-full rounded-t transition-colors ${
                  activo === indice ? 'bg-purple-300' : 'bg-purple-300/60'
                }`}
                style={{ height: `${alturaPct}%` }}
              />
              <span className="mt-1 font-mono text-[9px] text-ink/60">
                {formatearFechaCorta(dia.fecha)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Estadisticas({ activo = true }) {
  const [filtro, setFiltro] = useState('mes')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [actual, setActual] = useState(RESUMEN_VACIO)
  const [anterior, setAnterior] = useState(RESUMEN_VACIO)
  const [tendencia, setTendencia] = useState([])
  const [topProductos, setTopProductos] = useState([])
  const [topServicios, setTopServicios] = useState([])
  const [porAsistente, setPorAsistente] = useState([])
  const [metodosPago, setMetodosPago] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const primeraCargaHecha = useRef(false)

  async function cargarDatos(vigente, silencioso) {
    if (!silencioso) setCargando(true)
    setError(null)

    try {
      const rangoActual = calcularRango(filtro, personalizado)
      const rangoAnterior = calcularRangoAnterior(filtro, rangoActual)

      const [resumenActual, resumenAnterior] = await Promise.all([
        resumenPeriodo(rangoActual.desde, rangoActual.hasta, filtro),
        resumenPeriodo(rangoAnterior.desde, rangoAnterior.hasta, filtro),
      ])
      if (!vigente.actual) return

      setActual(resumenActual)
      setAnterior(resumenAnterior)

      // Tendencia diaria (siempre, aunque sea un solo día): resumen_estadisticas
      // solo devuelve los días con ventas, así que los días vacíos del rango
      // se rellenan con 0 acá antes de superponer los datos reales.
      const mapaDias = new Map()
      for (
        let cursor = new Date(rangoActual.desde);
        cursor < rangoActual.hasta;
        cursor = sumarDias(cursor, 1)
      ) {
        mapaDias.set(formatearFechaISO(cursor), 0)
      }
      for (const dia of resumenActual.tendencia) {
        mapaDias.set(dia.fecha, redondear2(dia.monto))
      }
      setTendencia([...mapaDias.entries()].map(([fecha, monto]) => ({ fecha, monto })))

      // Métodos de pago y rankings de productos/servicios ya vienen agregados
      // y ordenados desde resumen_estadisticas (top 5 por cantidad).
      setMetodosPago(
        resumenActual.metodosPago
          .map((m) => ({ ...m, monto: redondear2(m.monto) }))
          .sort((a, b) => b.monto - a.monto),
      )
      setTopProductos(resumenActual.topProductos.map((p) => ({ ...p, ingreso: redondear2(p.ingreso) })))
      setTopServicios(resumenActual.topServicios.map((s) => ({ ...s, ingreso: redondear2(s.ingreso) })))

      // Rendimiento por asistente (desde registro_servicios, como en Mi Panel).
      // Se pide también el rol del usuario dueño del registro para excluir
      // al admin: si el admin registra/edita una atención bajo su propio
      // usuario, no es una "asistente" y mezclarlo en el ranking confunde.
      const { data: registros } = await supabase
        .from('registro_servicios')
        .select('usuario_id, precio, pago_asistente, estado, fecha, usuarios(nombre_completo, rol)')
        .gte('fecha', rangoActual.desde.toISOString())
        .lt('fecha', rangoActual.hasta.toISOString())
        .neq('estado', 'CANCELADO')
      if (!vigente.actual) return

      const mapaAsistentes = new Map()
      for (const r of registros ?? []) {
        if (rolUsuario(r) !== 'ASISTENTE') continue
        const fila = mapaAsistentes.get(r.usuario_id) ?? {
          nombre: nombreUsuario(r),
          servicios: 0,
          monto: 0,
          comision: 0,
        }
        fila.servicios += 1
        fila.monto += r.precio ?? 0
        fila.comision += r.pago_asistente ?? 0
        mapaAsistentes.set(r.usuario_id, fila)
      }
      setPorAsistente(
        [...mapaAsistentes.values()]
          .map((a) => ({ ...a, monto: redondear2(a.monto), comision: redondear2(a.comision) }))
          .sort((a, b) => b.monto - a.monto),
      )
    } catch {
      setError('No se pudo cargar las estadísticas.')
    }

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

  const maximoProductos = Math.max(...topProductos.map((p) => p.cantidad), 1)
  const maximoServicios = Math.max(...topServicios.map((s) => s.cantidad), 1)
  const maximoAsistente = Math.max(...porAsistente.map((a) => a.monto), 1)
  const totalMetodos = sumarMontos(metodosPago, (m) => m.monto)

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
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando estadísticas...</p>
      ) : (
        <>
          {/* 1. KPIs comparativos */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TarjetaComparativa
              etiqueta="Ingreso bruto"
              valor={actual.ingresoBruto}
              anterior={anterior.ingresoBruto}
            />
            <TarjetaComparativa
              etiqueta="Ganancia final"
              valor={actual.gananciaFinal}
              anterior={anterior.gananciaFinal}
            />
            <TarjetaComparativa
              etiqueta="Cantidad de ventas"
              valor={actual.cantidadVentas}
              anterior={anterior.cantidadVentas}
              esMoneda={false}
            />
            <TarjetaComparativa
              etiqueta="Ticket promedio"
              valor={actual.ticketPromedio}
              anterior={anterior.ticketPromedio}
            />
          </div>

          {/* 2. Tendencia de ventas */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Tendencia de ventas</h2>
            {tendencia.length === 0 || tendencia.every((d) => d.monto === 0) ? (
              <p className="mt-4 text-center font-mono text-sm text-ink/60">
                No hay ventas en este período.
              </p>
            ) : (
              <div className="mt-4">
                <GraficoTendencia dias={tendencia} />
              </div>
            )}
          </div>

          {/* 3. Rankings */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">Productos más vendidos</h2>
              {topProductos.length === 0 ? (
                <p className="mt-4 text-center font-mono text-sm text-ink/60">Sin datos.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {topProductos.map((p) => (
                    <BarraHorizontal
                      key={p.nombre}
                      etiqueta={p.nombre}
                      valor={p.cantidad}
                      maximo={maximoProductos}
                      detalle={`${p.cantidad} uds. · ${formatearSoles(p.ingreso)}`}
                      color="bg-purple-300"
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">Servicios más realizados</h2>
              {topServicios.length === 0 ? (
                <p className="mt-4 text-center font-mono text-sm text-ink/60">Sin datos.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {topServicios.map((s) => (
                    <BarraHorizontal
                      key={s.nombre}
                      etiqueta={s.nombre}
                      valor={s.cantidad}
                      maximo={maximoServicios}
                      detalle={`${s.cantidad} · ${formatearSoles(s.ingreso)}`}
                      color="bg-blue"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 4. Rendimiento por asistente */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Rendimiento por asistente</h2>
            {porAsistente.length === 0 ? (
              <p className="mt-4 text-center font-mono text-sm text-ink/60">
                No hay atenciones registradas en este período.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {porAsistente.map((a) => (
                  <BarraHorizontal
                    key={a.nombre}
                    etiqueta={a.nombre}
                    valor={a.monto}
                    maximo={maximoAsistente}
                    detalle={`${formatearSoles(a.monto)} · ${a.servicios} serv. · com. ${formatearSoles(a.comision)}`}
                    color="bg-purple-300"
                  />
                ))}
              </div>
            )}
          </div>

          {/* 5. Métodos de pago */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Métodos de pago</h2>
            {metodosPago.length === 0 ? (
              <p className="mt-4 text-center font-mono text-sm text-ink/60">Sin datos.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {metodosPago.map((m) => (
                  <BarraHorizontal
                    key={m.metodo}
                    etiqueta={m.metodo}
                    valor={m.monto}
                    maximo={totalMetodos}
                    detalle={`${formatearSoles(m.monto)} (${totalMetodos > 0 ? Math.round((m.monto / totalMetodos) * 100) : 0}%)`}
                    color={CLASE_METODO_PAGO[m.metodo] ?? 'bg-purple-300'}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
