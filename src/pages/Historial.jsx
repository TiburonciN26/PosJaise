import { Fragment, useEffect, useRef, useState } from 'react'
import { ArrowBigDown, Download, Filter } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { calcularRango, formatearFechaISO, sumarDias } from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { aCSV, descargarArchivo } from '../lib/csv.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

const OPCIONES_ORDEN = [
  { id: 'fecha-desc', label: 'Más recientes primero' },
  { id: 'fecha-asc', label: 'Más antiguas primero' },
  { id: 'total-desc', label: 'Monto mayor' },
  { id: 'total-asc', label: 'Monto menor' },
]

const OPCIONES_METODO = [
  { id: 'todos', label: 'Todos los métodos' },
  { id: 'Efectivo', label: 'Efectivo' },
  { id: 'Tarjeta', label: 'Tarjeta' },
  { id: 'Transferencia', label: 'Transferencia' },
  { id: 'Yape', label: 'Yape' },
]

const TAMANO_PAGINA = 50

const SELECT_VENTAS =
  'id, codigo, fecha, estado, total, metodo_pago, clientes(nombre), venta_items(tipo, cantidad)'

// Select propio para exportarCSV(): la lista paginada no necesita
// monto_recibido/vendedor_id ni los detalles de cada item, pero el CSV sí
// declara esas columnas — reutilizar SELECT_VENTAS ahí las dejaba vacías sin
// ningún error visible (C1 de la 2ª auditoría). "id"/"cliente_id" no hacen
// falta: el código ya identifica la venta y el cliente va embebido por nombre.
const SELECT_VENTAS_EXPORT =
  'codigo, fecha, estado, total, metodo_pago, monto_recibido, vendedor_id, clientes(nombre), venta_items(tipo, nombre, cantidad, precio_unitario, subtotal)'

const RESUMEN_VACIO = { cantidadVentas: 0, totalRecaudado: 0, productosVendidos: 0 }

function filtrarPorMetodo(ventas, metodo) {
  return metodo === 'todos' ? ventas : ventas.filter((venta) => venta.metodo_pago === metodo)
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

function formatearFechaHora(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
}

function nombreClienteDeVenta(venta) {
  const clientes = venta?.clientes
  if (!clientes) return ''
  return Array.isArray(clientes) ? (clientes[0]?.nombre ?? '') : (clientes.nombre ?? '')
}

function DetalleVenta({ estado, onImprimir, onIniciarAnular, onCancelarAnular, onConfirmarAnular }) {
  const { cargando, error, detalle, items, vendedorNombre, confirmandoAnular, anulando } = estado

  if (cargando) {
    return <p className="py-4 text-center font-mono text-sm text-ink/60">Cargando detalle...</p>
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
      <p className="text-xs text-ink/60">
        Vendedor: <span className="text-ink/80">{vendedorNombre ?? '—'}</span>
      </p>
      {nombreCliente && (
        <p className="mt-0.5 text-xs text-ink/60">
          Cliente: <span className="text-ink/80">{nombreCliente}</span>
        </p>
      )}

      {/* Items */}
      <div className="mt-3 rounded-lg border border-border bg-bg">
        <div className="grid grid-cols-[1fr_3rem_4.5rem] gap-2 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink/60">
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
                <span className="font-mono text-[10px] text-ink/60">
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

export default function Historial({ activo = true }) {
  const { rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()

  const [filtro, setFiltro] = useState('hoy')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [ventas, setVentas] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('fecha-desc')
  const [filtroMetodo, setFiltroMetodo] = useState('todos')

  const [abiertos, setAbiertos] = useState(() => new Set())
  const [detalles, setDetalles] = useState({})
  const [ventaParaImprimir, setVentaParaImprimir] = useState(null)
  const [exportando, setExportando] = useState(false)
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: cargarMasVentas no llevaba el mismo guard
  // `vigente` que ya usa la carga inicial — si cambiabas de filtro/búsqueda
  // mientras la página siguiente viajaba, esa respuesta vieja se appendeaba
  // igual sobre la lista ya reemplazada por el filtro nuevo, mezclando
  // ventas de dos períodos. Este ref guarda el token vigente actual (el
  // mismo que crea el efecto de carga) para que cargarMasVentas pueda
  // descartar una respuesta que llegó tarde.
  const vigenteRef = useRef({ actual: true })

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
  // Debounced: filtroActivo decide si se pagina o se trae el período
  // completo (ver comentario abajo), así que el primer carácter no puede
  // disparar ese refetch pesado de inmediato — solo tras una pausa al
  // escribir (mismo patrón que Inventario/Clientes). El filtrado en pantalla
  // de `ventasFiltradas` sigue usando `busqueda` sin debounce: se siente
  // instantáneo sobre lo que ya está cargado mientras se espera el refetch.
  const busquedaDebounced = useDebounce(busqueda, 300)
  // Con búsqueda de texto o filtro por método activos, paginar rompería el
  // resultado (podría "no encontrar" algo que existe más adelante, sin
  // cargar). En esos casos se trae todo el período (ya acotado por la fecha)
  // en vez de paginar; si no hay ningún filtro activo, sí se pagina de verdad.
  const filtroActivo = Boolean(busquedaDebounced.trim()) || filtroMetodo !== 'todos'

  async function cargarVentas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    let consultaVentas = supabase
      .from('ventas')
      .select(SELECT_VENTAS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (!filtroActivo) {
      consultaVentas = consultaVentas.range(0, TAMANO_PAGINA - 1)
    }

    const [ventasRes, resumenRes] = await Promise.all([
      consultaVentas,
      supabase.rpc('resumen_historial', {
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
      }),
    ])

    if (!vigente.actual) return

    if (ventasRes.error) {
      setError('No se pudo cargar el historial.')
      setVentas([])
      setCargando(false)
      return
    }

    setError(null)
    setVentas(ventasRes.data ?? [])
    setHayMas(!filtroActivo && (ventasRes.data ?? []).length === TAMANO_PAGINA)

    const filaResumen = resumenRes.data?.[0]
    setResumen(
      filaResumen
        ? {
            cantidadVentas: filaResumen.cantidad_ventas ?? 0,
            totalRecaudado: filaResumen.total_recaudado ?? 0,
            productosVendidos: filaResumen.productos_vendidos ?? 0,
          }
        : RESUMEN_VACIO,
    )

    setCargando(false)
  }

  async function cargarMasVentas() {
    if (cargandoMas || !hayMas || filtroActivo) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data, error: errorMas } = await supabase
      .from('ventas')
      .select(SELECT_VENTAS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })
      .range(ventas.length, ventas.length + TAMANO_PAGINA - 1)

    setCargandoMas(false)
    // El filtro/búsqueda pudo cambiar mientras esta página viajaba — una
    // respuesta que llega tarde de un período/filtro que ya no está activo
    // se descarta en vez de appendearse sobre la lista ya reemplazada.
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más ventas.', 'error')
      return
    }

    setVentas((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  // A diferencia de cargarVentas/cargarMasVentas (paginadas), acá siempre se
  // trae el período completo sin .range() — un export parcial sin avisar
  // sería peor que el problema que esto intenta resolver (M7 de la auditoría).
  async function exportarCSV() {
    if (exportando) return
    setExportando(true)
    const { desde, hasta } = calcularRango(filtroEfectivo, personalizado)

    const { data, error: errorExport } = await supabase
      .from('ventas')
      .select(SELECT_VENTAS_EXPORT)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (errorExport) {
      setExportando(false)
      mostrarToast('No se pudo exportar el historial.', 'error')
      return
    }

    const ventasExport = data ?? []

    // vendedor_id no viene embebido (mismo motivo que cargarDetalleVenta):
    // se resuelve aparte para no dejar un UUID en crudo en el CSV.
    const idsVendedores = [...new Set(ventasExport.map((v) => v.vendedor_id).filter(Boolean))]
    let nombrePorVendedor = new Map()
    if (idsVendedores.length > 0) {
      const { data: usuariosData } = await supabase
        .from('usuarios')
        .select('id, nombre_completo')
        .in('id', idsVendedores)
      nombrePorVendedor = new Map((usuariosData ?? []).map((u) => [u.id, u.nombre_completo]))
    }

    setExportando(false)

    // Un solo archivo, una fila por producto/servicio vendido (los datos de
    // la venta se repiten en cada fila) — antes eran 2 archivos separados
    // (ventas.csv + venta_items.csv), y el segundo download quedaba
    // bloqueado por el navegador salvo que el usuario aprobara "descargas
    // múltiples" (M6 de la 2ª auditoría).
    const filas = ventasExport.flatMap((venta) =>
      (venta.venta_items ?? []).map((item) => ({
        codigo: venta.codigo,
        fecha: venta.fecha,
        estado: venta.estado,
        metodo_pago: venta.metodo_pago,
        monto_recibido: venta.monto_recibido,
        vendedor: nombrePorVendedor.get(venta.vendedor_id) ?? '',
        cliente: nombreClienteDeVenta(venta),
        total_venta: venta.total,
        tipo_item: item.tipo,
        producto_servicio: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal_item: item.subtotal,
      })),
    )

    const sufijo = `${formatearFechaISO(desde)}_a_${formatearFechaISO(sumarDias(hasta, -1))}`
    descargarArchivo(
      `ventas_${sufijo}.csv`,
      aCSV(filas, [
        'codigo',
        'fecha',
        'estado',
        'metodo_pago',
        'monto_recibido',
        'vendedor',
        'cliente',
        'total_venta',
        'tipo_item',
        'producto_servicio',
        'cantidad',
        'precio_unitario',
        'subtotal_item',
      ]),
    )
    mostrarToast(`Exportadas ${ventasExport.length} ventas (${filas.length} filas).`, 'exito')
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarVentas(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, filtroEfectivo, personalizado.desde, personalizado.hasta, filtroActivo])

  const ventasFiltradas = busqueda.trim()
    ? ventas.filter((venta) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          venta.codigo.toLowerCase().includes(texto) ||
          nombreClienteDeVenta(venta).toLowerCase().includes(texto)
        )
      })
    : ventas
  const ventasOrdenadas = ordenarVentas(filtrarPorMetodo(ventasFiltradas, filtroMetodo), orden)

  return (
    <div className="p-3 pb-6">
      {/* Buscador + orden: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por código o cliente..."
          tema="amber"
        />
        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" />
        <SelectorOrden
          opciones={OPCIONES_METODO}
          valor={filtroMetodo}
          onCambiar={setFiltroMetodo}
          tema="amber"
          icono={Filter}
          ariaLabel="Filtrar por método de pago"
        />

        {esAdmin && (
          <button
            type="button"
            onClick={exportarCSV}
            disabled={exportando}
            aria-label="Exportar CSV del período"
            title="Exportar CSV del período"
            className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong p-2.5 text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Resumen del período: viene de una función SQL (resumen_historial),
          no del array cargado — así sigue exacto aunque la lista de abajo
          esté paginada */}
      <div className="grid grid-cols-3 gap-3">
        <TarjetaResumen
          etiqueta="Ventas realizadas"
          valor={resumen.cantidadVentas}
          compacto
          padding="p-2"
        />
        <TarjetaResumen
          etiqueta="Total recaudado"
          valor={resumen.totalRecaudado.toFixed(2)}
          claseValor="text-green"
          compacto
          apilarCompacto
          padding="p-2"
        />
        <TarjetaResumen
          etiqueta="Productos vendidos"
          valor={resumen.productosVendidos}
          claseValor="text-purple-300"
          compacto
          padding="p-2"
        />
      </div>

      {/* Filtros de fecha */}
      <div className="mt-4">
        {esAdmin ? (
          <FiltrosFecha
            filtro={filtro}
            onCambiarFiltro={setFiltro}
            personalizado={personalizado}
            onCambiarPersonalizado={setPersonalizado}
            tema="amber"
          />
        ) : (
          <p className="font-mono text-xs text-ink/60">Mostrando ventas de hoy</p>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando historial...</p>
      ) : ventasOrdenadas.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          {busqueda.trim() ? 'No se encontraron ventas.' : 'No hay ventas en este período.'}
        </p>
      ) : (
        <>
          {/* Lista: solo móvil */}
          <div className="mt-4 -mx-3 border-t border-border lg:hidden">
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
                    onKeyDown={manejarActivacionTeclado(() => alternarAbierto(venta.id))}
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
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
                      <span className="truncate font-mono text-xs text-ink/60">
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
                        className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>

                  <CampoColapsable abierto={abierto}>
                    {/* Solo se monta el detalle de filas que se abrieron
                        alguna vez — no las 50 de la página, evita duplicar
                        nodos DOM (tabla de items + botones) por cada fila
                        que nadie llegó a expandir. */}
                    {(abierto || detalles[venta.id]) && (
                      <DetalleVenta
                        estado={infoDetalle}
                        onImprimir={() => imprimirVenta(venta.id)}
                        onIniciarAnular={() => iniciarAnular(venta.id)}
                        onCancelarAnular={() => cancelarAnular(venta.id)}
                        onConfirmarAnular={() => confirmarAnular(venta.id)}
                      />
                    )}
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/60">
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
                  const cantidadItems = (venta.venta_items ?? []).length
                  const abierto = abiertos.has(venta.id)
                  const infoDetalle = detalles[venta.id] ?? { cargando: false }

                  return (
                    <Fragment key={venta.id}>
                      <tr
                        onClick={() => alternarAbierto(venta.id)}
                        onKeyDown={manejarActivacionTeclado(() => alternarAbierto(venta.id))}
                        role="button"
                        tabIndex={0}
                        aria-expanded={abierto}
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
                            className={`ml-auto h-4 w-4 text-ink/60 transition-transform duration-300 ${
                              abierto ? 'rotate-180' : ''
                            }`}
                          />
                        </td>
                      </tr>
                      <tr className="bg-surface">
                        <td colSpan={7} className="p-0">
                          <CampoColapsable abierto={abierto}>
                            {(abierto || detalles[venta.id]) && (
                              <DetalleVenta
                                estado={infoDetalle}
                                onImprimir={() => imprimirVenta(venta.id)}
                                onIniciarAnular={() => iniciarAnular(venta.id)}
                                onCancelarAnular={() => cancelarAnular(venta.id)}
                                onConfirmarAnular={() => confirmarAnular(venta.id)}
                              />
                            )}
                          </CampoColapsable>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasVentas}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}

      <TicketImprimible
        detalle={ventaParaImprimir?.detalle ?? null}
        items={ventaParaImprimir?.items ?? []}
      />
    </div>
  )
}
