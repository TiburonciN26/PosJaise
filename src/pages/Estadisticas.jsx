import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

const FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]

const CLASE_METODO_PAGO = {
  Efectivo: 'bg-green',
  Tarjeta: 'bg-blue',
  Transferencia: 'bg-gray-300',
  Yape: 'bg-purple-300',
}

const RESUMEN_VACIO = { ingresoBruto: 0, gananciaFinal: 0, cantidadVentas: 0, ticketPromedio: 0, ventas: [] }

function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function formatearFechaCorta(fechaIso) {
  const fecha = new Date(`${fechaIso}T00:00:00`)
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' })
    .format(fecha)
    .replace('.', '')
}

function iniciarDia(fecha) {
  const copia = new Date(fecha)
  copia.setHours(0, 0, 0, 0)
  return copia
}

function sumarDias(fecha, dias) {
  const copia = new Date(fecha)
  copia.setDate(copia.getDate() + dias)
  return copia
}

function calcularRango(filtro, personalizado) {
  const hoy = iniciarDia(new Date())

  if (filtro === 'semana') {
    const diaSemana = hoy.getDay()
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1
    const lunes = sumarDias(hoy, -diasDesdeLunes)
    return { desde: lunes, hasta: sumarDias(lunes, 7) }
  }

  if (filtro === 'mes') {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const inicioMesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
    return { desde: inicioMes, hasta: inicioMesSiguiente }
  }

  if (filtro === 'personalizado') {
    const desde = personalizado.desde ? iniciarDia(new Date(`${personalizado.desde}T00:00:00`)) : hoy
    const hastaBase = personalizado.hasta
      ? iniciarDia(new Date(`${personalizado.hasta}T00:00:00`))
      : hoy
    return { desde, hasta: sumarDias(hastaBase, 1) }
  }

  // 'hoy'
  return { desde: hoy, hasta: sumarDias(hoy, 1) }
}

function calcularRangoAnterior(filtro, rangoActual) {
  if (filtro === 'mes') {
    const inicioMesAnterior = new Date(
      rangoActual.desde.getFullYear(),
      rangoActual.desde.getMonth() - 1,
      1,
    )
    return { desde: inicioMesAnterior, hasta: rangoActual.desde }
  }

  const duracionMs = rangoActual.hasta.getTime() - rangoActual.desde.getTime()
  return {
    desde: new Date(rangoActual.desde.getTime() - duracionMs),
    hasta: rangoActual.desde,
  }
}

// Misma cascada de ganancia que el Dashboard: -10% gastos operativos (sobre
// el ingreso bruto), -costo de productos, -gastos reales del mes (si aplica)
// = utilidad neta, -10% diezmo (sobre la utilidad neta) = ganancia final.
function calcularGananciaFinal(ingresoBruto, costoProductos, gastosMes, incluirGastos) {
  const gastosOperativos = ingresoBruto * 0.1
  const saldoTrasOperativos = ingresoBruto - gastosOperativos
  const saldoTrasCosto = saldoTrasOperativos - costoProductos
  const gastosReales = incluirGastos ? gastosMes : 0
  const utilidadNeta = saldoTrasCosto - gastosReales
  const diezmo = utilidadNeta * 0.1
  return utilidadNeta - diezmo
}

async function resumenPeriodo(desde, hasta, incluirGastos) {
  const { data: ventas } = await supabase
    .from('ventas')
    .select('id, fecha, total, metodo_pago')
    .eq('estado', 'ACTIVA')
    .gte('fecha', desde.toISOString())
    .lt('fecha', hasta.toISOString())

  const ventasActivas = ventas ?? []
  const ids = ventasActivas.map((v) => v.id)

  let costoProductos = 0
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from('venta_items')
      .select('cantidad, producto_id')
      .in('venta_id', ids)
      .eq('tipo', 'PRODUCTO')

    const idsProductos = [...new Set((items ?? []).map((i) => i.producto_id).filter(Boolean))]
    if (idsProductos.length > 0) {
      const { data: productosData } = await supabase
        .from('productos_vista')
        .select('id, costo')
        .in('id', idsProductos)
      const costoPorProducto = new Map((productosData ?? []).map((p) => [p.id, p.costo]))
      costoProductos = (items ?? []).reduce(
        (acc, i) => acc + (costoPorProducto.get(i.producto_id) ?? 0) * i.cantidad,
        0,
      )
    }
  }

  let gastosMes = 0
  if (incluirGastos) {
    const { data: gastosData } = await supabase
      .from('gastos')
      .select('monto')
      .eq('mes', desde.getMonth() + 1)
      .eq('anio', desde.getFullYear())
    gastosMes = (gastosData ?? []).reduce((acc, g) => acc + g.monto, 0)
  }

  const ingresoBruto = ventasActivas.reduce((acc, v) => acc + v.total, 0)
  const cantidadVentas = ventasActivas.length
  const gananciaFinal = calcularGananciaFinal(ingresoBruto, costoProductos, gastosMes, incluirGastos)
  const ticketPromedio = cantidadVentas > 0 ? ingresoBruto / cantidadVentas : 0

  return { ingresoBruto, gananciaFinal, cantidadVentas, ticketPromedio, ventas: ventasActivas }
}

function nombreUsuario(registro) {
  const usuarios = registro?.usuarios
  if (!usuarios) return 'Sin nombre'
  return Array.isArray(usuarios) ? (usuarios[0]?.nombre_completo ?? 'Sin nombre') : (usuarios.nombre_completo ?? 'Sin nombre')
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
      <p className="text-xs text-ink/50">{etiqueta}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink sm:text-xl">
        {esMoneda ? formatearSoles(valor) : valor}
      </p>
      {delta != null ? (
        <div className={`mt-0.5 flex items-center gap-1 text-xs ${subio ? 'text-green' : 'text-red'}`}>
          {subio ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span className="font-mono">{Math.abs(delta).toFixed(0)}%</span>
          <span className="text-ink/40">vs. período anterior</span>
        </div>
      ) : (
        <p className="mt-0.5 text-xs text-ink/40">Sin datos del período anterior</p>
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
              <span className="mt-1 font-mono text-[9px] text-ink/40">
                {formatearFechaCorta(dia.fecha)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Estadisticas() {
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

  async function cargarDatos() {
    setCargando(true)
    setError(null)

    try {
      const rangoActual = calcularRango(filtro, personalizado)
      const rangoAnterior = calcularRangoAnterior(filtro, rangoActual)
      const incluirGastos = filtro === 'mes'

      const [resumenActual, resumenAnterior] = await Promise.all([
        resumenPeriodo(rangoActual.desde, rangoActual.hasta, incluirGastos),
        resumenPeriodo(rangoAnterior.desde, rangoAnterior.hasta, incluirGastos),
      ])

      setActual(resumenActual)
      setAnterior(resumenAnterior)

      const idsVentas = resumenActual.ventas.map((v) => v.id)

      // Tendencia diaria (siempre, aunque sea un solo día)
      const mapaDias = new Map()
      for (
        let cursor = new Date(rangoActual.desde);
        cursor < rangoActual.hasta;
        cursor = sumarDias(cursor, 1)
      ) {
        mapaDias.set(formatearFechaISO(cursor), 0)
      }
      for (const venta of resumenActual.ventas) {
        const clave = formatearFechaISO(new Date(venta.fecha))
        mapaDias.set(clave, (mapaDias.get(clave) ?? 0) + venta.total)
      }
      setTendencia([...mapaDias.entries()].map(([fecha, monto]) => ({ fecha, monto })))

      // Métodos de pago
      const mapaMetodos = new Map()
      for (const venta of resumenActual.ventas) {
        const m = mapaMetodos.get(venta.metodo_pago) ?? {
          metodo: venta.metodo_pago,
          cantidad: 0,
          monto: 0,
        }
        m.cantidad += 1
        m.monto += venta.total
        mapaMetodos.set(venta.metodo_pago, m)
      }
      setMetodosPago([...mapaMetodos.values()].sort((a, b) => b.monto - a.monto))

      // Rankings de productos y servicios (desde las líneas de venta)
      if (idsVentas.length > 0) {
        const { data: items } = await supabase
          .from('venta_items')
          .select('tipo, nombre, cantidad, subtotal')
          .in('venta_id', idsVentas)

        const mapaProductos = new Map()
        const mapaServicios = new Map()
        for (const item of items ?? []) {
          const mapa = item.tipo === 'PRODUCTO' ? mapaProductos : mapaServicios
          const fila = mapa.get(item.nombre) ?? { nombre: item.nombre, cantidad: 0, ingreso: 0 }
          fila.cantidad += item.cantidad
          fila.ingreso += item.subtotal
          mapa.set(item.nombre, fila)
        }
        setTopProductos([...mapaProductos.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5))
        setTopServicios([...mapaServicios.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5))
      } else {
        setTopProductos([])
        setTopServicios([])
      }

      // Rendimiento por asistente (desde registro_servicios, como en Mi Panel)
      const { data: registros } = await supabase
        .from('registro_servicios')
        .select('usuario_id, precio, pago_asistente, estado, fecha, usuarios(nombre_completo)')
        .gte('fecha', rangoActual.desde.toISOString())
        .lt('fecha', rangoActual.hasta.toISOString())
        .neq('estado', 'CANCELADO')

      const mapaAsistentes = new Map()
      for (const r of registros ?? []) {
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
      setPorAsistente([...mapaAsistentes.values()].sort((a, b) => b.monto - a.monto))
    } catch {
      setError('No se pudo cargar las estadísticas.')
    }

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [filtro, personalizado.desde, personalizado.hasta])

  const maximoProductos = Math.max(...topProductos.map((p) => p.cantidad), 1)
  const maximoServicios = Math.max(...topServicios.map((s) => s.cantidad), 1)
  const maximoAsistente = Math.max(...porAsistente.map((a) => a.monto), 1)
  const totalMetodos = metodosPago.reduce((acc, m) => acc + m.monto, 0)

  return (
    <div className="p-3 pb-6">
      {/* Filtros de fecha: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 bg-bg px-3 py-2">
        <div className="grid grid-cols-4 gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`min-w-0 overflow-visible whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${
                filtro === f.id
                  ? 'bg-purple-300 font-semibold text-bg'
                  : 'border border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtro === 'personalizado' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-ink/50">Desde</label>
            <input
              type="date"
              value={personalizado.desde}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
              }
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink/50">Hasta</label>
            <input
              type="date"
              value={personalizado.hasta}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
              }
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando estadísticas...</p>
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
              <p className="mt-4 text-center font-mono text-sm text-ink/40">
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
                <p className="mt-4 text-center font-mono text-sm text-ink/40">Sin datos.</p>
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
                <p className="mt-4 text-center font-mono text-sm text-ink/40">Sin datos.</p>
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
              <p className="mt-4 text-center font-mono text-sm text-ink/40">
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
              <p className="mt-4 text-center font-mono text-sm text-ink/40">Sin datos.</p>
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
