import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { X, ShoppingCart, Check, User, Camera, Mic } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import { useCarrito } from '../context/CarritoContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { formatearSoles } from '../lib/moneda.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import InputBusqueda from '../components/InputBusqueda.jsx'
import ModalBuscarServicio from '../components/ModalBuscarServicio.jsx'
import ModalBuscarCliente from '../components/ModalBuscarCliente.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

// El lector de códigos de barras (@zxing) pesa varios cientos de KB;
// se carga solo cuando se abre el escáner, no en el bundle principal.
const ModalEscanerCodigoBarras = lazy(() => import('../components/ModalEscanerCodigoBarras.jsx'))

// Debe coincidir con la duración de transición usada en FilaTicket (duration-300)
const DURACION_SALIDA = 300

const metodosPago = [
  {
    nombre: 'Efectivo',
    nombreCorto: 'Efect.',
    icono: '/icons/efectivo.svg',
    clasesActivo: 'border-green bg-green/10 text-green',
  },
  {
    nombre: 'Tarjeta',
    nombreCorto: 'Tarjeta',
    icono: '/icons/targueta.svg',
    clasesActivo: 'border-blue bg-blue/10 text-blue',
  },
  {
    nombre: 'Transferencia',
    nombreCorto: 'Transf.',
    icono: '/icons/transferencia.svg',
    clasesActivo: 'border-gray-300 bg-gray-300/10 text-gray-300',
  },
  {
    nombre: 'Yape',
    nombreCorto: 'Yape',
    icono: '/icons/yape.svg',
    clasesActivo: 'border-purple-300 bg-purple-300/10 text-purple-300',
  },
]

function useContadorAnimado(valorObjetivo, duracionMs = 350) {
  const [valorMostrado, setValorMostrado] = useState(valorObjetivo)
  const valorAnteriorRef = useRef(valorObjetivo)

  useEffect(() => {
    const inicio = valorAnteriorRef.current
    const fin = valorObjetivo

    if (inicio === fin) return undefined

    const prefiereMovimientoReducido = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (prefiereMovimientoReducido) {
      valorAnteriorRef.current = fin
      setValorMostrado(fin)
      return undefined
    }

    const inicioTiempo = performance.now()
    let frame

    function animar(ahora) {
      const progreso = Math.min((ahora - inicioTiempo) / duracionMs, 1)
      setValorMostrado(inicio + (fin - inicio) * progreso)
      if (progreso < 1) {
        frame = requestAnimationFrame(animar)
      } else {
        valorAnteriorRef.current = fin
      }
    }

    frame = requestAnimationFrame(animar)
    return () => cancelAnimationFrame(frame)
  }, [valorObjetivo, duracionMs])

  return valorMostrado
}

function FilaTicket({
  item,
  stockDisponible,
  resaltada,
  saliendo,
  onCambiarCantidad,
  onCambiarPrecio,
  onQuitar,
}) {
  const subtotal = item.cantidad * item.precioUnitario
  const esProducto = item.tipo === 'PRODUCTO'
  const superaStock = esProducto && item.cantidad > stockDisponible
  const enElLimite = esProducto && item.cantidad >= stockDisponible

  return (
    <div
      className={`grid grid-cols-[1fr_5rem_4rem_1.5rem] items-center gap-3 overflow-hidden px-3 py-2.5 transition-[transform_300ms_ease-in,opacity_150ms_ease-in_150ms] ${
        saliendo ? 'pointer-events-none -translate-x-full opacity-0 animate-flash-rojo' : 'translate-x-0 opacity-100'
      } ${resaltada ? 'animate-flash-verde' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {item.tipo === 'SERVICIO' && (
            <span className="rounded border border-blue/40 bg-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-blue">
              Servicio
            </span>
          )}
          <span className="truncate text-sm text-ink">{item.nombre}</span>
        </div>
        {item.tipo === 'SERVICIO' ? (
          <div className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink/60">
            <span>S/</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={item.precioUnitario}
              onChange={(evento) => onCambiarPrecio(item.id, parseFloat(evento.target.value) || 0)}
              className="w-14 rounded border border-border-strong bg-surface-2 px-1 py-0.5 text-ink outline-none focus:border-amber"
            />
            <span>c/u</span>
          </div>
        ) : (
          <span className="font-mono text-xs text-ink/60">
            {formatearSoles(item.precioUnitario)} c/u
          </span>
        )}
        {(superaStock || enElLimite) && (
          <p className={`font-mono text-[10px] ${superaStock ? 'text-red' : 'text-amber'}`}>
            {superaStock ? 'Stock insuficiente' : `Stock máx: ${stockDisponible}`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5">
        {item.cantidad > 1 && (
          <button
            type="button"
            onClick={() => onCambiarCantidad(item.id, -1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-border-strong text-ink/70 transition-colors hover:border-amber hover:text-amber"
          >
            −
          </button>
        )}
        <span className="w-4 text-center font-mono text-sm text-ink">{item.cantidad}</span>
        <button
          type="button"
          onClick={() => onCambiarCantidad(item.id, 1)}
          disabled={enElLimite}
          className="flex h-6 w-6 items-center justify-center rounded border border-border-strong text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:pointer-events-none disabled:opacity-30"
        >
          +
        </button>
      </div>

      <span className="whitespace-nowrap text-right font-mono text-sm text-ink">
        {subtotal.toFixed(2)}
      </span>

      <button
        type="button"
        onClick={() => onQuitar(item.id)}
        aria-label="Quitar"
        className="text-ink/30 transition-colors hover:text-red"
      >
        ✕
      </button>
    </div>
  )
}

export default function Ventas({ activo = true }) {
  const { mostrarToast } = useToast()
  const {
    carrito,
    setCarrito,
    metodoPago,
    setMetodoPago,
    montoRecibido,
    setMontoRecibido,
    cliente,
    setCliente,
  } = useCarrito()
  const [busqueda, setBusqueda] = useState('')
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(-1)
  const [filaFlash, setFilaFlash] = useState(null)
  const [idsSaliendo, setIdsSaliendo] = useState(() => new Set())
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [errorCobro, setErrorCobro] = useState(null)
  const [ventaConfirmada, setVentaConfirmada] = useState(null)
  const [ventaParaImprimir, setVentaParaImprimir] = useState(null)

  // Posición del panel de total/pago/confirmar congelada al montar (antes de
  // que se pueda abrir el teclado). Al abrir el teclado del buscador, el
  // navegador encoge el viewport y un position:fixed con bottom:0 "sigue" ese
  // borde inferior móvil, subiendo y tapando los resultados de búsqueda. Acá
  // fijamos el panel con un "top" en píxeles (el borde superior de la
  // pantalla nunca se mueve por el teclado), así se queda abajo en su lugar
  // y, si el teclado la tapa, que la tape — no debe reacomodarse.
  const refPanelTicket = useRef(null)
  const [topPanelTicket, setTopPanelTicket] = useState(null)
  const [esMovil, setEsMovil] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : true,
  )

  useEffect(() => {
    // Re-medir en resize/orientationchange (rotar el teléfono, split-screen)
    // para que el panel no quede mal posicionado hasta cambiar de pestaña —
    // pero no mientras hay un input enfocado, porque abrir el teclado
    // también dispara "resize" y ahí sí queremos que el top quede congelado
    // (ese es justamente el motivo de fijarlo, ver comentario de arriba).
    function remedirTop() {
      const activo = document.activeElement
      const hayInputEnfocado =
        activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')
      if (hayInputEnfocado) return
      if (refPanelTicket.current) {
        setTopPanelTicket(refPanelTicket.current.getBoundingClientRect().top)
      }
    }

    remedirTop()

    const mediaMovil = window.matchMedia('(max-width: 639px)')
    const actualizarEsMovil = () => setEsMovil(mediaMovil.matches)
    actualizarEsMovil()
    mediaMovil.addEventListener('change', actualizarEsMovil)

    window.addEventListener('resize', remedirTop)
    window.addEventListener('orientationchange', remedirTop)

    return () => {
      mediaMovil.removeEventListener('change', actualizarEsMovil)
      window.removeEventListener('resize', remedirTop)
      window.removeEventListener('orientationchange', remedirTop)
    }
  }, [])

  useCerrarConEscape(() => setConfirmandoCancelar(false), confirmandoCancelar)
  useCerrarConEscape(() => setVentaConfirmada(null), Boolean(ventaConfirmada))

  useEffect(() => {
    if (!ventaParaImprimir) return
    window.print()
  }, [ventaParaImprimir])

  const [catalogoProductos, setCatalogoProductos] = useState([])
  const [catalogoServicios, setCatalogoServicios] = useState([])
  const [catalogoClientes, setCatalogoClientes] = useState([])
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)
  const [errorCatalogo, setErrorCatalogo] = useState(null)
  const [modalServiciosAbierto, setModalServiciosAbierto] = useState(false)
  const [modalClienteAbierto, setModalClienteAbierto] = useState(false)
  const [modalEscanerAbierto, setModalEscanerAbierto] = useState(false)
  const primeraCargaCatalogoHecha = useRef(false)

  async function cargarCatalogo(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargandoCatalogo(true)
    const [productosRes, serviciosRes, clientesRes] = await Promise.all([
      supabase
        .from('productos_vista')
        .select('id, codigo_barras, nombre, categoria, precio, stock_actual')
        .eq('activo', true)
        .order('nombre'),
      supabase
        .from('servicios')
        .select('id, nombre, precio, categoria, duracion_min')
        .eq('activo', true)
        .order('nombre'),
      supabase.from('clientes').select('id, nombre, telefono').order('nombre'),
    ])

    if (!vigente.actual) return

    if (productosRes.error || serviciosRes.error) {
      setErrorCatalogo('No se pudo cargar el catálogo. Revisa tu conexión.')
    } else {
      setErrorCatalogo(null)
      setCatalogoProductos(productosRes.data ?? [])
      setCatalogoServicios(serviciosRes.data ?? [])
      setCatalogoClientes(clientesRes.data ?? [])
    }
    setCargandoCatalogo(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaCatalogoHecha.current
    primeraCargaCatalogoHecha.current = true
    cargarCatalogo(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo])

  // Si el escáner de cámara quedó abierto y el usuario cambia de pestaña
  // desde el menú (la página sigue montada, solo oculta), hay que cerrarlo:
  // si no, la cámara sigue encendida en segundo plano.
  useEffect(() => {
    if (!activo) setModalEscanerAbierto(false)
  }, [activo])

  const sugerencias =
    busqueda.trim().length > 0
      ? catalogoProductos.filter((producto) =>
          producto.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
        )
      : []

  const total = carrito.reduce(
    (acumulado, item) => acumulado + item.cantidad * item.precioUnitario,
    0,
  )
  const totalMostrado = useContadorAnimado(total)
  const recibidoNumerico = parseFloat(montoRecibido) || 0
  const vuelto = recibidoNumerico - total

  const {
    soportado: vozSoportada,
    escuchando,
    alternar: alternarVoz,
    onErrorRef: onErrorVozRef,
  } = useReconocimientoVoz((texto) => {
    setBusqueda(texto)
    setMostrarSugerencias(true)
    setIndiceActivo(-1)
  })

  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  function obtenerStockProducto(productoId) {
    const producto = catalogoProductos.find((p) => p.id === productoId)
    return producto ? producto.stock_actual : Infinity
  }

  const haySobreStock = carrito.some(
    (item) => item.tipo === 'PRODUCTO' && item.cantidad > obtenerStockProducto(item.productoId),
  )
  const hayServicioEnCarrito = carrito.some((item) => item.tipo === 'SERVICIO')

  const puedeCobrar =
    carrito.length > 0 &&
    metodoPago !== null &&
    !haySobreStock &&
    (metodoPago !== 'Efectivo' || recibidoNumerico >= total)

  useEffect(() => {
    if (!filaFlash) return undefined
    const temporizador = setTimeout(() => setFilaFlash(null), 450)
    return () => clearTimeout(temporizador)
  }, [filaFlash])

  function agregarProducto(producto) {
    const existente = carrito.find(
      (item) => item.tipo === 'PRODUCTO' && item.productoId === producto.id,
    )

    if (existente) {
      setFilaFlash(existente.id)
      setCarrito((anterior) =>
        anterior.map((item) =>
          item.id === existente.id
            ? { ...item, cantidad: Math.min(item.cantidad + 1, producto.stock_actual) }
            : item,
        ),
      )
      return
    }

    const nuevoId = crypto.randomUUID()
    setFilaFlash(nuevoId)
    setCarrito((anterior) => [
      ...anterior,
      {
        id: nuevoId,
        tipo: 'PRODUCTO',
        productoId: producto.id,
        nombre: producto.nombre,
        cantidad: 1,
        precioUnitario: producto.precio,
      },
    ])
  }

  function agregarServicio(servicio) {
    const nuevoId = crypto.randomUUID()
    setFilaFlash(nuevoId)
    setCarrito((anterior) => [
      ...anterior,
      {
        id: nuevoId,
        tipo: 'SERVICIO',
        servicioId: servicio.id,
        nombre: servicio.nombre,
        cantidad: 1,
        precioUnitario: servicio.precio,
      },
    ])
    setModalServiciosAbierto(false)
  }

  function cambiarCantidad(id, delta) {
    setCarrito((anterior) =>
      anterior.map((item) => {
        if (item.id !== id) return item
        let siguienteCantidad = item.cantidad + delta
        if (item.tipo === 'PRODUCTO') {
          siguienteCantidad = Math.min(siguienteCantidad, obtenerStockProducto(item.productoId))
        }
        return { ...item, cantidad: Math.max(1, siguienteCantidad) }
      }),
    )
  }

  function cambiarPrecioServicio(id, nuevoPrecio) {
    setCarrito((anterior) =>
      anterior.map((item) =>
        item.id === id && item.tipo === 'SERVICIO'
          ? { ...item, precioUnitario: Math.max(0, nuevoPrecio) }
          : item,
      ),
    )
  }

  function quitarItem(id) {
    setIdsSaliendo((anterior) => new Set(anterior).add(id))
    setTimeout(() => {
      setCarrito((anterior) => anterior.filter((item) => item.id !== id))
      setIdsSaliendo((anterior) => {
        const siguiente = new Set(anterior)
        siguiente.delete(id)
        return siguiente
      })
    }, DURACION_SALIDA)
  }

  function pedirCancelarVenta() {
    if (carrito.length === 0) return
    setConfirmandoCancelar(true)
  }

  function confirmarCancelarVenta() {
    setConfirmandoCancelar(false)
    setIdsSaliendo(new Set(carrito.map((item) => item.id)))
    setTimeout(() => {
      setCarrito([])
      setMontoRecibido('')
      setMetodoPago(null)
      setCliente(null)
      setIdsSaliendo(new Set())
    }, DURACION_SALIDA)
  }

  async function confirmarVenta() {
    if (!puedeCobrar || cobrando) return

    setCobrando(true)
    setErrorCobro(null)

    const items = carrito.map((item) => ({
      tipo: item.tipo,
      producto_id: item.tipo === 'PRODUCTO' ? item.productoId : null,
      servicio_id: item.tipo === 'SERVICIO' ? item.servicioId : null,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
    }))

    const { data, error } = await supabase.rpc('confirmar_venta', {
      p_metodo_pago: metodoPago,
      p_monto_recibido: metodoPago === 'Efectivo' ? recibidoNumerico : null,
      p_items: items,
      p_cliente_id: cliente?.id ?? null,
    })

    setCobrando(false)

    if (error) {
      setErrorCobro(error.message)
      return
    }

    const venta = Array.isArray(data) ? data[0] : data
    setVentaConfirmada(venta)

    setVentaParaImprimir({
      detalle: {
        codigo: venta.codigo,
        fecha: new Date().toISOString(),
        estado: 'ACTIVA',
        total: venta.total,
        metodo_pago: metodoPago,
        monto_recibido: metodoPago === 'Efectivo' ? recibidoNumerico : null,
        clientes: cliente ? { nombre: cliente.nombre } : null,
      },
      items: carrito.map((item) => ({
        id: item.id,
        tipo: item.tipo,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precioUnitario,
        subtotal: item.cantidad * item.precioUnitario,
      })),
    })

    setCarrito([])
    setMontoRecibido('')
    setMetodoPago(null)
    setCliente(null)
    cargarCatalogo()
  }

  function seleccionarSugerencia(producto) {
    agregarProducto(producto)
    setBusqueda('')
    setMostrarSugerencias(false)
    setIndiceActivo(-1)
  }

  function manejarKeyDown(evento) {
    if (evento.key === 'Escape') {
      setBusqueda('')
      setMostrarSugerencias(false)
      setIndiceActivo(-1)
      return
    }

    if (evento.key === 'ArrowDown') {
      if (sugerencias.length === 0) return
      evento.preventDefault()
      setMostrarSugerencias(true)
      setIndiceActivo((indice) => (indice + 1) % sugerencias.length)
      return
    }

    if (evento.key === 'ArrowUp') {
      if (sugerencias.length === 0) return
      evento.preventDefault()
      setMostrarSugerencias(true)
      setIndiceActivo((indice) => (indice - 1 + sugerencias.length) % sugerencias.length)
      return
    }

    if (evento.key !== 'Enter') return

    if (indiceActivo >= 0 && sugerencias[indiceActivo]) {
      seleccionarSugerencia(sugerencias[indiceActivo])
      return
    }

    const porCodigo = catalogoProductos.find(
      (producto) => producto.codigo_barras === busqueda.trim(),
    )
    if (porCodigo) {
      agregarProducto(porCodigo)
      setBusqueda('')
      setMostrarSugerencias(false)
      return
    }

    if (sugerencias.length === 1) {
      seleccionarSugerencia(sugerencias[0])
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Buscador / escáner de código de barras + Agregar servicio */}
      <div className="border-b border-border bg-surface p-3">
        <div className="relative flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink/60">
            <IconoBuscar />
          </span>
          <InputBusqueda
            value={busqueda}
            disabled={cargandoCatalogo}
            onChange={(evento) => {
              setBusqueda(evento.target.value)
              setMostrarSugerencias(true)
              setIndiceActivo(-1)
            }}
            onKeyDown={manejarKeyDown}
            onFocus={() => busqueda && setMostrarSugerencias(true)}
            onBlur={() => setTimeout(() => setMostrarSugerencias(false), 150)}
            textoPlaceholder={
              cargandoCatalogo ? 'Cargando catálogo...' : 'Buscar producto o escanear código de barras...'
            }
            animar={activo && !cargandoCatalogo}
            className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-[41px] font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 focus:border-amber disabled:opacity-60"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => {
                setBusqueda('')
                setMostrarSugerencias(false)
                setIndiceActivo(-1)
              }}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}

        </div>

        {mostrarSugerencias && sugerencias.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
            {sugerencias.map((producto, indice) => (
              <button
                key={producto.id}
                type="button"
                onMouseDown={(evento) => evento.preventDefault()}
                onMouseEnter={() => setIndiceActivo(indice)}
                onClick={() => seleccionarSugerencia(producto)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                  indice === indiceActivo ? 'bg-amber/15 text-amber' : 'text-ink hover:bg-surface-3'
                }`}
              >
                <span className="truncate">{producto.nombre}</span>
                <span className="flex shrink-0 items-center gap-2 font-mono">
                  <span className="text-xs text-ink/60">Stock: {producto.stock_actual}</span>
                  <span className="text-amber">{formatearSoles(producto.precio)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

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

        <button
          type="button"
          onClick={() => setModalEscanerAbierto(true)}
          aria-label="Escanear código de barras con la cámara"
          className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong p-2.5 text-ink/70 transition-colors hover:border-amber hover:text-amber"
        >
          <Camera className="h-4 w-4" />
        </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
              cliente
                ? 'border-purple-300 bg-purple-300/10 text-purple-300'
                : 'border-dashed border-border-strong text-ink/70'
            }`}
          >
            <button
              type="button"
              onClick={() => setModalClienteAbierto(true)}
              className="flex min-w-0 flex-1 items-center gap-1.5 transition-colors hover:text-amber"
            >
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {cliente ? cliente.nombre : 'Cliente: (ninguno)'}
              </span>
            </button>
            {cliente && (
              <button
                type="button"
                onClick={() => setCliente(null)}
                aria-label="Quitar cliente"
                className="shrink-0 text-purple-300/70 transition-colors hover:text-red"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setModalServiciosAbierto(true)}
            className={`shrink-0 whitespace-nowrap rounded-lg border border-dashed px-2 py-1.5 text-xs transition-colors ${
              hayServicioEnCarrito
                ? 'border-blue/50 text-blue hover:bg-blue/10'
                : 'border-border-strong text-ink/70 hover:border-blue/50 hover:text-blue'
            }`}
          >
            + Agregar servicio
          </button>
          <button
            type="button"
            className="shrink-0 whitespace-nowrap rounded-lg border border-dashed border-border-strong px-1.5 py-1.5 text-xs text-ink/60"
          >
            + Añadir cupón
          </button>
        </div>

        {errorCatalogo && (
          <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {errorCatalogo}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:overflow-y-auto">
        <div className="flex h-full min-h-0 w-full flex-col gap-3 sm:h-auto lg:flex-row lg:items-start">
          {/* Columna de ticket (fija en móvil el espacio disponible; crece en desktop) */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Zona de ticket: en móvil ocupa el espacio libre (entre header y
                el bloque de pago fijo); en tablet/desktop mantiene el alto
                fijo de ~4 filas y media, igual que antes */}
            <div className="-mx-3 flex min-h-0 flex-1 flex-col border-t border-border bg-bg sm:mx-0 sm:rounded-lg sm:flex-none">
              <div className="grid grid-cols-[1fr_5rem_4rem_1.5rem] gap-3 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white">
                <span>Producto</span>
                <span className="text-center">Cantidad</span>
                <span className="text-right">Subtotal</span>
                <span />
              </div>

              <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto pb-[22rem] sm:h-[300px] sm:flex-none sm:pb-0">
                {carrito.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                    <ShoppingCart className="h-10 w-10 text-ink/20" />
                    <p className="font-mono text-sm text-ink/30">La cuenta está vacía</p>
                  </div>
                ) : (
                  carrito.map((item) => (
                    <FilaTicket
                      key={item.id}
                      item={item}
                      stockDisponible={
                        item.tipo === 'PRODUCTO' ? obtenerStockProducto(item.productoId) : Infinity
                      }
                      resaltada={item.id === filaFlash}
                      saliendo={idsSaliendo.has(item.id)}
                      onCambiarCantidad={cambiarCantidad}
                      onCambiarPrecio={cambiarPrecioServicio}
                      onQuitar={quitarItem}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Columna de totales, pago y acciones:
              fija abajo (sticky) en móvil, en flujo normal desde sm+,
              barra lateral fija en desktop (lg+) */}
          <div
            ref={refPanelTicket}
            className="fixed inset-x-0 bottom-0 z-20 w-full rounded-lg border border-border bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:z-auto sm:pb-3 lg:w-[340px] lg:flex-none"
            style={esMovil && topPanelTicket != null ? { top: `${topPanelTicket}px`, bottom: 'auto' } : undefined}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[19px] text-white">Total</span>
              <span className="font-mono text-2xl font-semibold text-amber">
                {formatearSoles(totalMostrado)}
              </span>
            </div>

            <CampoColapsable abierto={metodoPago === 'Efectivo'} margen>
              <div
                className={`flex items-center justify-between pt-1.5 text-sm ${
                  vuelto < 0 ? 'text-red' : 'text-green'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true">↩</span>
                  Vuelto
                </span>
                <span className="font-mono font-semibold">{formatearSoles(vuelto)}</span>
              </div>
            </CampoColapsable>

            <div className="mt-3">
              <p className="mb-1.5 text-xs text-white">Método de pago</p>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2">
                {metodosPago.map((metodo) => (
                  <button
                    key={metodo.nombre}
                    type="button"
                    onClick={() => {
                      setMetodoPago(metodo.nombre)
                      if (metodo.nombre !== 'Efectivo') setMontoRecibido('')
                    }}
                    className={`rounded-lg border px-1 py-2 text-[11px] transition-colors sm:px-2 sm:text-sm ${
                      metodoPago === metodo.nombre
                        ? metodo.clasesActivo
                        : 'border-border bg-surface-2 text-white hover:border-border-strong'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1">
                      <img src={metodo.icono} alt="" className="h-4 w-4 shrink-0" />
                      <span className="sm:hidden">{metodo.nombreCorto}</span>
                      <span className="hidden sm:inline">{metodo.nombre}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <CampoColapsable abierto={metodoPago === 'Efectivo'} margen>
              <div>
                <label className="mb-1 block text-xs text-white">Recibido</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={montoRecibido}
                  onChange={(evento) => setMontoRecibido(evento.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
                />
              </div>
            </CampoColapsable>

            {errorCobro && (
              <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                {errorCobro}
              </p>
            )}

            <button
              type="button"
              onClick={confirmarVenta}
              disabled={!puedeCobrar || cobrando}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-3 text-lg font-bold transition-colors ${
                puedeCobrar && !cobrando ? 'bg-green text-bg' : 'bg-surface-3 text-white'
              }`}
            >
              <Check className="h-5 w-5" />
              {cobrando ? 'Cobrando...' : 'Confirmar venta'}
            </button>
            <button
              type="button"
              onClick={pedirCancelarVenta}
              disabled={cobrando}
              className="mt-3 w-full rounded-lg border border-red bg-transparent py-3 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
            >
              Cancelar venta
            </button>
          </div>
        </div>
      </div>

      {modalServiciosAbierto && (
        <ModalBuscarServicio
          servicios={catalogoServicios}
          onSeleccionar={agregarServicio}
          onCerrar={() => setModalServiciosAbierto(false)}
        />
      )}

      {modalClienteAbierto && (
        <ModalBuscarCliente
          clientes={catalogoClientes}
          onSeleccionar={(clienteElegido) => {
            setCliente(clienteElegido)
            setModalClienteAbierto(false)
          }}
          onCerrar={() => setModalClienteAbierto(false)}
        />
      )}

      {modalEscanerAbierto && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80">
              <p className="font-mono text-sm text-ink/50">Cargando cámara...</p>
            </div>
          }
        >
          <ModalEscanerCodigoBarras
            productos={catalogoProductos}
            onProductoEncontrado={agregarProducto}
            onCerrar={() => setModalEscanerAbierto(false)}
          />
        </Suspense>
      )}

      {confirmandoCancelar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Cancelar esta venta?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Se va a vaciar el ticket completo. Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoCancelar(false)}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelarVenta}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
              >
                Sí, cancelar venta
              </button>
            </div>
          </div>
        </div>
      )}

      {ventaConfirmada && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
            <p className="text-3xl text-green">✓</p>
            <h2 className="mt-2 text-base font-semibold text-ink">Venta confirmada</h2>
            <p className="mt-1 font-mono text-sm text-ink/60">
              {ventaConfirmada.codigo} · {formatearSoles(ventaConfirmada.total)}
            </p>
            <button
              type="button"
              onClick={() => setVentaConfirmada(null)}
              className="mt-4 w-full rounded-lg bg-amber py-2.5 text-sm font-semibold text-bg"
            >
              Nueva venta
            </button>
          </div>
        </div>
      )}

      {ventaParaImprimir && (
        <TicketImprimible detalle={ventaParaImprimir.detalle} items={ventaParaImprimir.items} />
      )}
    </div>
  )
}
