import { Fragment, useEffect, useState } from 'react'
import { ArrowBigDown, Mic, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useTextoEscritura } from '../hooks/useTextoEscritura.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import IconoBuscar from '../components/IconoBuscar.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'

const FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]

const OPCIONES_ORDEN = [
  { id: 'fecha-desc', label: 'Más recientes primero' },
  { id: 'fecha-asc', label: 'Más antiguas primero' },
  { id: 'total-desc', label: 'Monto mayor ' },
  { id: 'total-asc', label: 'Monto menor ' },
  { id: 'metodo-efectivo', label: ' Efectivo', separador: true },
  { id: 'metodo-tarjeta', label: ' Tarjeta' },
  { id: 'metodo-transferencia', label: ' Transferencia' },
  { id: 'metodo-yape', label: ' Yape' },
]

const METODO_POR_ID_ORDEN = {
  'metodo-efectivo': 'Efectivo',
  'metodo-tarjeta': 'Tarjeta',
  'metodo-transferencia': 'Transferencia',
  'metodo-yape': 'Yape',
}

function filtrarPorMetodo(ventas, orden) {
  const metodo = METODO_POR_ID_ORDEN[orden]
  return metodo ? ventas.filter((venta) => venta.metodo_pago === metodo) : ventas
}

function ordenarVentas(ventas, orden) {
  const ordenadas = [...ventas]
  switch (orden) {
    case 'fecha-asc':
      return ordenadas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    case 'total-desc':
      return ordenadas.sort((a, b) => b.total - a.total)
    case 'total-asc':
      return ordenadas.sort((a, b) => a.total - b.total)
    default:
      return ordenadas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
  }
}

const CLASE_METODO_PAGO_PILL = {
  Efectivo: 'border border-green/40 bg-green/15 text-green',
  Tarjeta: 'border border-blue/40 bg-blue/15 text-blue',
  Transferencia: 'border border-gray-300/40 bg-gray-300/15 text-gray-300',
  Yape: 'border border-purple-300/40 bg-purple-300/15 text-purple-300',
}

function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function formatearFechaHora(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
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

function nombreClienteDeVenta(venta) {
  const clientes = venta?.clientes
  if (!clientes) return ''
  return Array.isArray(clientes) ? (clientes[0]?.nombre ?? '') : (clientes.nombre ?? '')
}

function CampoColapsable({ abierto, children }) {
  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

function DetalleVenta({ estado, onImprimir, onIniciarAnular, onCancelarAnular, onConfirmarAnular }) {
  const { cargando, error, detalle, items, vendedorNombre, confirmandoAnular, anulando } = estado

  if (cargando) {
    return <p className="py-4 text-center font-mono text-sm text-ink/40">Cargando detalle...</p>
  }

  if (error) {
    return (
      <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
        {error}
      </p>
    )
  }

  if (!detalle) return null

  const anulada = detalle.estado === 'ANULADA'
  const vuelto = detalle.monto_recibido != null ? detalle.monto_recibido - detalle.total : null

  const nombreCliente = nombreClienteDeVenta(detalle)

  return (
    <div className="px-[17px] pb-[17px] pt-[5px]">
      <p className="text-xs text-ink/50">
        Vendedor: <span className="text-ink/80">{vendedorNombre ?? '—'}</span>
      </p>
      {nombreCliente && (
        <p className="mt-0.5 text-xs text-ink/50">
          Cliente: <span className="text-ink/80">{nombreCliente}</span>
        </p>
      )}

      {/* Items */}
      <div className="mt-3 rounded-lg border border-border bg-bg">
        <div className="grid grid-cols-[1fr_3rem_4.5rem] gap-2 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink/40">
          <span>Producto</span>
          <span className="text-center">Cant.</span>
          <span className="text-right">Subtotal</span>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_3rem_4.5rem] items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {item.tipo === 'SERVICIO' && (
                    <span className="rounded border border-blue/40 bg-blue/10 px-1 py-0.5 font-mono text-[9px] text-blue">
                      Servicio
                    </span>
                  )}
                  <span className="truncate text-sm text-ink">{item.nombre}</span>
                </div>
                <span className="font-mono text-[10px] text-ink/40">
                  {formatearSoles(item.precio_unitario)} c/u
                </span>
              </div>
              <span className="text-center font-mono text-sm text-ink">{item.cantidad}</span>
              <span className="text-right font-mono text-sm text-ink">
                {formatearSoles(item.subtotal)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Pago */}
      {detalle.monto_recibido != null && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink/60">Recibido</span>
            <span className="font-mono text-ink">{formatearSoles(detalle.monto_recibido)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink/60">Vuelto</span>
            <span className="font-mono text-green">{formatearSoles(vuelto)}</span>
          </div>
        </div>
      )}

      {!confirmandoAnular ? (
        <div className="mt-4 flex gap-2">
          {!anulada && (
            <button
              type="button"
              onClick={onIniciarAnular}
              className="flex-1 rounded-lg border border-red bg-transparent py-2.5 text-sm font-semibold text-red transition-colors hover:bg-red/10"
            >
              Anular venta
            </button>
          )}
          <button
            type="button"
            onClick={onImprimir}
            className="flex-1 rounded-lg border border-border-strong py-2.5 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Reimprimir ticket
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-red/40 bg-red/5 p-3">
          <p className="text-sm text-ink">
            ¿Seguro que quieres anular la venta{' '}
            <span className="font-mono text-red">{detalle.codigo}</span>? Esto devolverá el stock
            de los productos.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onCancelarAnular}
              disabled={anulando}
              className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={onConfirmarAnular}
              disabled={anulando}
              className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {anulando ? 'Anulando...' : 'Sí, anular'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Historial() {
  const { rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()

  const [filtro, setFiltro] = useState('hoy')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [ventas, setVentas] = useState([])
  const [itemsPorVenta, setItemsPorVenta] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('fecha-desc')

  const [abiertos, setAbiertos] = useState(() => new Set())
  const [detalles, setDetalles] = useState({})
  const [ventaParaImprimir, setVentaParaImprimir] = useState(null)

  async function cargarDetalleVenta(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { cargando: true, error: null, detalle: null, items: [], vendedorNombre: null },
    }))

    const [ventaRes, itemsRes] = await Promise.all([
      supabase
        .from('ventas')
        .select(
          'id, codigo, fecha, estado, total, metodo_pago, monto_recibido, vendedor_id, clientes(nombre)',
        )
        .eq('id', ventaId)
        .single(),
      supabase
        .from('venta_items')
        .select('id, tipo, nombre, cantidad, precio_unitario, subtotal')
        .eq('venta_id', ventaId)
        .order('id'),
    ])

    if (ventaRes.error || itemsRes.error) {
      setDetalles((anterior) => ({
        ...anterior,
        [ventaId]: {
          ...anterior[ventaId],
          cargando: false,
          error: 'No se pudo cargar el detalle de la venta.',
        },
      }))
      return
    }

    let vendedorNombre = null
    if (ventaRes.data?.vendedor_id) {
      const { data: usuarioData } = await supabase
        .from('usuarios')
        .select('nombre_completo')
        .eq('id', ventaRes.data.vendedor_id)
        .maybeSingle()
      vendedorNombre = usuarioData?.nombre_completo ?? null
    }

    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: {
        cargando: false,
        error: null,
        detalle: ventaRes.data,
        items: itemsRes.data ?? [],
        vendedorNombre,
        confirmandoAnular: false,
        anulando: false,
      },
    }))
  }

  function alternarAbierto(ventaId) {
    const yaAbierto = abiertos.has(ventaId)
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (yaAbierto) siguiente.delete(ventaId)
      else siguiente.add(ventaId)
      return siguiente
    })
    if (!yaAbierto && !detalles[ventaId]) {
      cargarDetalleVenta(ventaId)
    }
  }

  function imprimirVenta(ventaId) {
    const info = detalles[ventaId]
    if (!info?.detalle) return
    setVentaParaImprimir({ detalle: info.detalle, items: info.items })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print())
    })
  }

  function iniciarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], confirmandoAnular: true },
    }))
  }

  function cancelarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], confirmandoAnular: false },
    }))
  }

  async function confirmarAnular(ventaId) {
    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: { ...anterior[ventaId], anulando: true },
    }))

    const { error: errorAnular } = await supabase.rpc('anular_venta', { p_venta_id: ventaId })

    if (errorAnular) {
      setDetalles((anterior) => ({
        ...anterior,
        [ventaId]: { ...anterior[ventaId], anulando: false },
      }))
      mostrarToast(errorAnular.message, 'error')
      return
    }

    setDetalles((anterior) => ({
      ...anterior,
      [ventaId]: {
        ...anterior[ventaId],
        anulando: false,
        confirmandoAnular: false,
        detalle: { ...anterior[ventaId].detalle, estado: 'ANULADA' },
      },
    }))
    mostrarToast('Venta anulada. Se devolvió el stock.', 'exito')
    cargarVentas()
  }

  const filtroEfectivo = esAdmin ? filtro : 'hoy'

  async function cargarVentas() {
    setCargando(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data: ventasData, error: errorVentas } = await supabase
      .from('ventas')
      .select('id, codigo, fecha, estado, total, metodo_pago, clientes(nombre)')
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (errorVentas) {
      setError('No se pudo cargar el historial.')
      setVentas([])
      setItemsPorVenta({})
      setCargando(false)
      return
    }

    setError(null)
    setVentas(ventasData ?? [])

    const idsVentas = (ventasData ?? []).map((venta) => venta.id)
    if (idsVentas.length === 0) {
      setItemsPorVenta({})
      setCargando(false)
      return
    }

    const { data: itemsData, error: errorItems } = await supabase
      .from('venta_items')
      .select('venta_id, tipo, cantidad')
      .in('venta_id', idsVentas)

    const mapa = {}
    if (!errorItems) {
      for (const item of itemsData ?? []) {
        if (!mapa[item.venta_id]) mapa[item.venta_id] = []
        mapa[item.venta_id].push(item)
      }
    }
    setItemsPorVenta(mapa)
    setCargando(false)
  }

  useEffect(() => {
    cargarVentas()
  }, [filtroEfectivo, personalizado.desde, personalizado.hasta])

  const ventasActivas = ventas.filter((venta) => venta.estado === 'ACTIVA')
  const totalRecaudado = ventasActivas.reduce((acumulado, venta) => acumulado + venta.total, 0)
  const productosVendidos = ventasActivas.reduce((acumulado, venta) => {
    const items = itemsPorVenta[venta.id] ?? []
    const cantidadProductos = items
      .filter((item) => item.tipo === 'PRODUCTO')
      .reduce((acc, item) => acc + item.cantidad, 0)
    return acumulado + cantidadProductos
  }, 0)

  const ventasFiltradas = busqueda.trim()
    ? ventas.filter((venta) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          venta.codigo.toLowerCase().includes(texto) ||
          nombreClienteDeVenta(venta).toLowerCase().includes(texto)
        )
      })
    : ventas
  const ventasOrdenadas = ordenarVentas(filtrarPorMetodo(ventasFiltradas, orden), orden)

  const placeholderBuscador = useTextoEscritura('Buscar por código o cliente...')
  const { soportado: vozSoportada, escuchando, alternar: alternarVoz, onErrorRef: onErrorVozRef } =
    useReconocimientoVoz((texto) => setBusqueda(texto))
  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  return (
    <div className="p-3 pb-6">
      {/* Buscador + orden: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40">
            <IconoBuscar />
          </span>
          <input
            type="text"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') setBusqueda('')
            }}
            placeholder={placeholderBuscador}
            className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/40 focus:border-amber"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {vozSoportada && (
          <button
            type="button"
            onClick={alternarVoz}
            aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
            className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
              escuchando
                ? 'animate-pulse border-red bg-red/10 text-red'
                : 'border-dashed border-border-strong text-ink/70 hover:border-amber hover:text-amber'
            }`}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" />
      </div>

      {/* Resumen del período */}
      <div className="grid grid-cols-3 gap-3">
        <TarjetaResumen
          etiqueta="Ventas realizadas"
          valor={ventasActivas.length}
          compacto
          padding="p-2"
        />
        <TarjetaResumen
          etiqueta="Total recaudado"
          valor={totalRecaudado.toFixed(2)}
          claseValor="text-green"
          compacto
          apilarCompacto
          padding="p-2"
        />
        <TarjetaResumen
          etiqueta="Productos vendidos"
          valor={productosVendidos}
          claseValor="text-purple-300"
          compacto
          padding="p-2"
        />
      </div>

      {/* Filtros de fecha */}
      <div className="mt-4">
        {esAdmin ? (
          <div className="grid grid-cols-4 gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`min-w-0 overflow-visible whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors sm:px-3 sm:text-sm ${
                  filtro === f.id
                    ? 'bg-amber font-semibold text-bg'
                    : 'border border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-ink/50">Mostrando ventas de hoy</p>
        )}

        {esAdmin && filtro === 'personalizado' && (
          <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
            <label className="shrink-0 text-xs text-ink/50">Desde</label>
            <input
              type="date"
              value={personalizado.desde}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
              }
              className="min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
            <label className="shrink-0 text-xs text-ink/50">Hasta</label>
            <input
              type="date"
              value={personalizado.hasta}
              onChange={(evento) =>
                setPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
              }
              className="min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando historial...</p>
      ) : ventasOrdenadas.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">
          {busqueda.trim() ? 'No se encontraron ventas.' : 'No hay ventas en este período.'}
        </p>
      ) : (
        <>
          {/* Lista: solo móvil */}
          <div className="mt-4 -mx-3 border-t border-border md:hidden">
            {ventasOrdenadas.map((venta, indice) => {
              const anulada = venta.estado === 'ANULADA'
              const esUltimo = indice === ventasOrdenadas.length - 1
              const abierto = abiertos.has(venta.id)
              const infoDetalle = detalles[venta.id] ?? { cargando: false }

              return (
                <div
                  key={venta.id}
                  className={
                    anulada ? 'm-2 rounded-lg border border-red/40 bg-red/5' : !esUltimo ? 'border-b border-border' : ''
                  }
                >
                  <div
                    onClick={() => alternarAbierto(venta.id)}
                    className="flex cursor-pointer items-center justify-between gap-2 px-3 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 font-mono text-sm font-semibold ${
                          anulada ? 'text-red' : 'text-amber'
                        }`}
                      >
                        {venta.codigo}
                      </span>
                      {anulada && (
                        <span className="shrink-0 rounded-full bg-red/15 px-2 py-0.5 text-[10px] font-medium text-red">
                          Anulada
                        </span>
                      )}
                      <span className="truncate font-mono text-xs text-ink/40">
                        {formatearFechaHora(venta.fecha)}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`font-mono text-sm font-semibold ${
                          anulada ? 'text-red line-through' : 'text-green'
                        }`}
                      >
                        {formatearSoles(venta.total)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          CLASE_METODO_PAGO_PILL[venta.metodo_pago] ?? 'bg-surface-2 text-ink/60'
                        }`}
                      >
                        {venta.metodo_pago}
                      </span>
                      <ArrowBigDown
                        className={`h-4 w-4 shrink-0 text-ink/40 transition-transform duration-300 ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>

                  <CampoColapsable abierto={abierto}>
                    <DetalleVenta
                      estado={infoDetalle}
                      onImprimir={() => imprimirVenta(venta.id)}
                      onIniciarAnular={() => iniciarAnular(venta.id)}
                      onCancelarAnular={() => cancelarAnular(venta.id)}
                      onConfirmarAnular={() => confirmarAnular(venta.id)}
                    />
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/40">
                  <th className="px-3 py-2 font-normal">Código</th>
                  <th className="px-3 py-2 font-normal">Fecha</th>
                  <th className="px-3 py-2 font-normal">Método</th>
                  <th className="px-3 py-2 text-right font-normal">Items</th>
                  <th className="px-3 py-2 text-right font-normal">Total</th>
                  <th className="px-3 py-2 text-right font-normal">Estado</th>
                  <th className="px-3 py-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ventasOrdenadas.map((venta) => {
                  const anulada = venta.estado === 'ANULADA'
                  const cantidadItems = (itemsPorVenta[venta.id] ?? []).length
                  const abierto = abiertos.has(venta.id)
                  const infoDetalle = detalles[venta.id] ?? { cargando: false }

                  return (
                    <Fragment key={venta.id}>
                      <tr
                        onClick={() => alternarAbierto(venta.id)}
                        className={`cursor-pointer bg-surface transition-colors hover:bg-surface-2 ${
                          anulada ? 'opacity-70' : ''
                        }`}
                      >
                        <td
                          className={`px-3 py-2.5 font-mono ${
                            anulada ? 'text-red line-through' : 'text-amber'
                          }`}
                        >
                          {venta.codigo}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-ink/60">
                          {formatearFechaHora(venta.fecha)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              CLASE_METODO_PAGO_PILL[venta.metodo_pago] ?? 'bg-surface-2 text-ink/60'
                            }`}
                          >
                            {venta.metodo_pago}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink/60">
                          {cantidadItems}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-semibold ${
                            anulada ? 'text-red line-through' : 'text-green'
                          }`}
                        >
                          {formatearSoles(venta.total)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {anulada ? (
                            <span className="rounded-full bg-red/15 px-2 py-0.5 text-xs font-medium text-red">
                              Anulada
                            </span>
                          ) : (
                            <span className="rounded-full bg-green/15 px-2 py-0.5 text-xs font-medium text-green">
                              Activa
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <ArrowBigDown
                            className={`ml-auto h-4 w-4 text-ink/40 transition-transform duration-300 ${
                              abierto ? 'rotate-180' : ''
                            }`}
                          />
                        </td>
                      </tr>
                      <tr className="bg-surface">
                        <td colSpan={7} className="p-0">
                          <CampoColapsable abierto={abierto}>
                            <DetalleVenta
                              estado={infoDetalle}
                              onImprimir={() => imprimirVenta(venta.id)}
                              onIniciarAnular={() => iniciarAnular(venta.id)}
                              onCancelarAnular={() => cancelarAnular(venta.id)}
                              onConfirmarAnular={() => confirmarAnular(venta.id)}
                            />
                          </CampoColapsable>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <TicketImprimible
        detalle={ventaParaImprimir?.detalle ?? null}
        items={ventaParaImprimir?.items ?? []}
      />
    </div>
  )
}
