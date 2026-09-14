import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { X, ShoppingCart, Check, User, Camera, Mic, Percent, Lock, Unlock } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import { useCarrito } from '../context/CarritoContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useEstadoNegocio } from '../context/EstadoNegocioContext.jsx'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import InputBusqueda from '../components/InputBusqueda.jsx'
import ModalBuscarAtencion from '../components/ModalBuscarAtencion.jsx'
import ModalBuscarCliente from '../components/ModalBuscarCliente.jsx'
import ModalCliente from '../components/ModalCliente.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

// El lector de códigos de barras (@zxing) pesa varios cientos de KB;
// se carga solo cuando se abre el escáner, no en el bundle principal.
const ModalEscanerCodigoBarras = lazy(() => import('../components/ModalEscanerCodigoBarras.jsx'))

// Debe coincidir con la duración de transición usada en FilaTicket (duration-300)
const DURACION_SALIDA = 300

// Deslizar (izquierda o derecha) una fila del carrito más de esto la
// elimina, igual que tocar el botón ✕ que reemplaza en táctil.
const UMBRAL_ARRASTRE_ELIMINAR = 90
// Movimiento mínimo antes de considerarlo un arrastre y no un tap sobre
// la fila (nombre/precio, no los controles con su propio onClick).
const UMBRAL_ARRASTRE_INICIO = 8

// Rutas con BASE_URL (no "/icons/..." a secas): en GitHub Pages la app vive
// bajo /PosJaise/ y Vite no reescribe strings dentro de JSX — con la ruta
// absoluta estos íconos daban 404 en producción (A1 de la 3ª auditoría).
const metodosPago = [
  {
    nombre: 'Efectivo',
    nombreCorto: 'Efect.',
    icono: `${import.meta.env.BASE_URL}icons/efectivo.svg`,
    clasesActivo: 'border-green bg-green/10 text-green',
  },
  {
    nombre: 'Tarjeta',
    nombreCorto: 'Tarjeta',
    icono: `${import.meta.env.BASE_URL}icons/targueta.svg`,
    clasesActivo: 'border-blue bg-blue/10 text-blue',
  },
  {
    nombre: 'Transferencia',
    nombreCorto: 'Transf.',
    icono: `${import.meta.env.BASE_URL}icons/transferencia.svg`,
    clasesActivo: 'border-gray-300 bg-gray-300/10 text-gray-300',
  },
  {
    nombre: 'Yape',
    nombreCorto: 'Yape',
    icono: `${import.meta.env.BASE_URL}icons/yape.svg`,
    clasesActivo: 'border-purple-300 bg-purple-300/10 text-purple-300',
  },
]

// Billetes más comunes en efectivo — cada botón FIJA el campo Recibido a
// ese valor (no lo suma), para el caso típico: el cliente paga con un
// solo billete y no hay que hacer la cuenta a mano.
const MONTOS_RAPIDOS_EFECTIVO = [10, 20, 50, 100]

// Comisión de Culqi (POS físico): 3.44% + IGV sobre el % (~4.0592% neto), o
// un mínimo de S/ 3.50 + IGV (S/ 4.13) si el % no llega a cubrirlo. Se
// calcula el monto inverso para que, después de la comisión, al negocio le
// quede exactamente el total de la venta — nunca asume la comisión del banco.
const TASA_COMISION_TARJETA = 0.040592
const COMISION_MINIMA_TARJETA = 4.13

function calcularMontoPosTarjeta(total) {
  const montoPorcentaje = total / (1 - TASA_COMISION_TARJETA)
  const montoFijo = total + COMISION_MINIMA_TARJETA
  return redondear2(Math.max(montoPorcentaje, montoFijo))
}

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
  esTactil,
  onCambiarCantidad,
  onQuitar,
}) {
  const subtotal = item.cantidad * item.precioUnitario
  const esProducto = item.tipo === 'PRODUCTO'
  const superaStock = esProducto && item.cantidad > stockDisponible
  const enElLimite = esProducto && item.cantidad >= stockDisponible

  // Deslizar para eliminar (reemplaza el botón ✕ en táctil, ver esTactil
  // más abajo): arrastreX sigue al dedo 1:1 mientras se arrastra, y se
  // usa también para el tinte rojo de fondo (progreso hacia el umbral).
  // touch-pan-y en el contenedor deja el scroll vertical de la lista
  // intacto — solo el gesto horizontal lo captura este handler.
  const [arrastreX, setArrastreX] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const inicioRef = useRef({ x: 0, iniciado: false, ignorar: false })

  function manejarPointerDown(evento) {
    if (!esTactil || saliendo) return
    // Empezar el gesto sobre +/-/precio no debe interpretarse como
    // swipe — esos controles ya tienen su propio onClick.
    const ignorar = Boolean(evento.target.closest('button, input'))
    inicioRef.current = { x: evento.clientX, iniciado: false, ignorar }
    if (!ignorar) evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }

  function manejarPointerMove(evento) {
    if (!esTactil || saliendo || inicioRef.current.ignorar || evento.buttons === 0) return
    const deltaX = evento.clientX - inicioRef.current.x

    if (!inicioRef.current.iniciado) {
      if (Math.abs(deltaX) < UMBRAL_ARRASTRE_INICIO) return
      inicioRef.current.iniciado = true
      setArrastrando(true)
    }

    setArrastreX(Math.max(-140, Math.min(140, deltaX)))
  }

  function soltar(evento) {
    evento.currentTarget.releasePointerCapture?.(evento.pointerId)
    if (!inicioRef.current.iniciado) return
    inicioRef.current.iniciado = false
    setArrastrando(false)

    if (Math.abs(arrastreX) >= UMBRAL_ARRASTRE_ELIMINAR) {
      setArrastreX(0)
      onQuitar(item.id)
    } else {
      setArrastreX(0)
    }
  }

  const progresoEliminar = Math.min(1, Math.abs(arrastreX) / UMBRAL_ARRASTRE_ELIMINAR)

  return (
    <div
      onPointerDown={manejarPointerDown}
      onPointerMove={manejarPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={
        saliendo
          ? undefined
          : {
              transform: arrastreX ? `translateX(${arrastreX}px)` : undefined,
              backgroundColor: `color-mix(in srgb, var(--color-red) ${Math.round(progresoEliminar * 85)}%, transparent)`,
              transition: arrastrando ? 'none' : undefined,
            }
      }
      className={`${esTactil ? 'grid-cols-[1fr_5rem_auto]' : 'grid-cols-[1fr_5rem_auto_1.5rem]'} touch-pan-y grid items-center gap-3 overflow-hidden px-3 py-2 transition-[transform_300ms_ease-in,opacity_150ms_ease-in_150ms,background-color_150ms_ease-out] ${
        saliendo ? 'pointer-events-none -translate-x-full opacity-0 animate-flash-rojo' : 'translate-x-0 opacity-100'
      } ${resaltada ? 'animate-flash-verde' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {item.tipo === 'SERVICIO' && (
            <span className="rounded border border-blue/40 bg-blue/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue">
              Servicio
            </span>
          )}
          <span className="truncate text-sm text-ink">{item.nombre}</span>
        </div>
        {item.tipo === 'SERVICIO' ? (
          <div className="mt-0.5">
            <span className="font-mono text-xs text-ink/60">
              S/ {item.precioUnitario.toFixed(1)}
            </span>
            {item.clienteNombre && (
              <p className="truncate text-[11px] text-ink/50">Para: {item.clienteNombre}</p>
            )}
          </div>
        ) : (
          <span className="font-mono text-xs text-ink/60">
            S/ {item.precioUnitario.toFixed(1)} c/u
          </span>
        )}
        {(superaStock || enElLimite) && (
          <p className="font-mono text-[11px] text-red">
            {superaStock ? 'Stock insuficiente' : `Stock máx: ${stockDisponible}`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5">
        {esProducto ? (
          <>
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
          </>
        ) : (
          <span className="w-4 text-center font-mono text-sm text-ink/60">1</span>
        )}
      </div>

      <span className="-ml-3 whitespace-nowrap text-right font-mono text-sm text-ink">
        {subtotal.toFixed(1)}
      </span>

      {!esTactil && (
        <button
          type="button"
          onClick={() => onQuitar(item.id)}
          aria-label="Quitar"
          className="text-ink/30 transition-colors hover:text-red"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default function Ventas({ activo = true }) {
  const { mostrarToast } = useToast()
  const { rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { cuentaTransferencia, cambiarCuentaTransferencia } = useEstadoNegocio()
  const {
    carrito,
    setCarrito,
    metodoPago,
    setMetodoPago,
    montoRecibido,
    setMontoRecibido,
    montoPosTarjeta,
    setMontoPosTarjeta,
    cliente,
    setCliente,
    tipoDescuento,
    setTipoDescuento,
    valorDescuento,
    setValorDescuento,
  } = useCarrito()
  const [busqueda, setBusqueda] = useState('')
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(-1)
  // Tocar el cabezal del carrito (móvil) empuja fuera de vista el panel de
  // total/pago/confirmar (fixed bottom-0) para que la lista de productos
  // aproveche toda la pantalla cuando el ticket tiene muchas filas. En sm+
  // el panel ya es estático (no fixed), así que esto no aplica ahí.
  const [carritoExpandido, setCarritoExpandido] = useState(false)
  // Filas del carrito: en táctil se eliminan deslizando (más espacio para
  // el nombre del producto), en mouse/trackpad se conserva el botón ✕.
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  // La cuenta de transferencia es un dato del negocio (fila singleton en
  // Supabase, no del carrito) — visible para cualquiera, pero editable
  // solo por el admin. "borrador" es lo que se ve/edita en el input;
  // se resetea al valor guardado cada vez que este cambia (otro admin lo
  // actualizó, o llegó por Realtime), y solo se sobrescribe en el server
  // al bloquear (mismo patrón que el % de comisión en Porcentajes.jsx).
  const [cuentaTransferenciaBloqueada, setCuentaTransferenciaBloqueada] = useState(true)
  const [borradorCuentaTransferencia, setBorradorCuentaTransferencia] = useState(cuentaTransferencia)
  useEffect(() => {
    setBorradorCuentaTransferencia(cuentaTransferencia)
    setCuentaTransferenciaBloqueada(true)
  }, [cuentaTransferencia])

  async function confirmarYBloquearCuentaTransferencia() {
    setCuentaTransferenciaBloqueada(true)
    if (borradorCuentaTransferencia === cuentaTransferencia) return
    try {
      await cambiarCuentaTransferencia(borradorCuentaTransferencia)
    } catch {
      setBorradorCuentaTransferencia(cuentaTransferencia)
      mostrarToast('No se pudo guardar la cuenta de transferencia.', 'error')
    }
  }

  const [filaFlash, setFilaFlash] = useState(null)
  const [idsSaliendo, setIdsSaliendo] = useState(() => new Set())
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [errorCobro, setErrorCobro] = useState(null)
  const [ventaConfirmada, setVentaConfirmada] = useState(null)
  const [ventaParaImprimir, setVentaParaImprimir] = useState(null)

  // setTimeout "sueltos" (fuera de un useEffect: quitar fila, cancelar
  // venta, cerrar sugerencias al perder foco) que si el componente se
  // desmonta antes de tiempo, quedan corriendo igual. Inofensivo en React
  // 18+ (el setState de un componente desmontado ya no hace nada), pero se
  // limpian igual — es la forma correcta de hacerlo.
  const temporizadoresRef = useRef(new Set())

  useEffect(() => {
    const temporizadores = temporizadoresRef.current
    return () => {
      temporizadores.forEach((id) => clearTimeout(id))
      temporizadores.clear()
    }
  }, [])

  function conTemporizador(fn, ms) {
    const id = setTimeout(() => {
      temporizadoresRef.current.delete(id)
      fn()
    }, ms)
    temporizadoresRef.current.add(id)
  }

  // El panel de total/pago/confirmar va anclado al fondo (position:fixed
  // bottom:0) SIN congelar su posición ni medir nada en JS.
  //
  // - Al abrir el teclado NO sube: index.html usa interactive-widget=
  //   resizes-visual, así el layout no se encoge y el panel se queda pegado
  //   al fondo físico; el teclado simplemente lo tapa (al buscar un producto,
  //   el buscador está arriba y el teclado tapa el panel de abajo, sin que
  //   este suba a tapar la pantalla).
  // - Como está anclado abajo y crece hacia arriba, cuando aparece el campo
  //   "Recibido" (método Efectivo) empuja el Total y los botones de método de
  //   pago hacia arriba, no manda Confirmar/Cancelar hacia abajo.
  // - Al rotar no hay nada congelado que quede desalineado; se re-acomoda solo.

  useCerrarConEscape(() => setConfirmandoCancelar(false), confirmandoCancelar)
  useCerrarConEscape(() => setVentaConfirmada(null), Boolean(ventaConfirmada))

  const panelCancelarRef = useRef(null)
  const panelConfirmadaRef = useRef(null)
  useModalA11y(panelCancelarRef, confirmandoCancelar)
  useModalA11y(panelConfirmadaRef, Boolean(ventaConfirmada))

  useEffect(() => {
    if (!ventaParaImprimir) return
    window.print()
  }, [ventaParaImprimir])

  const [catalogoProductos, setCatalogoProductos] = useState([])
  const [catalogoClientes, setCatalogoClientes] = useState([])
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)
  const [errorCatalogo, setErrorCatalogo] = useState(null)
  const [atencionesDisponibles, setAtencionesDisponibles] = useState([])
  const [cargandoAtenciones, setCargandoAtenciones] = useState(false)
  const [modalAtencionesAbierto, setModalAtencionesAbierto] = useState(false)
  const [modalClienteAbierto, setModalClienteAbierto] = useState(false)
  const [modalRegistroClienteAbierto, setModalRegistroClienteAbierto] = useState(false)
  const [nombreClienteNuevo, setNombreClienteNuevo] = useState('')
  const [modalEscanerAbierto, setModalEscanerAbierto] = useState(false)
  const primeraCargaCatalogoHecha = useRef(false)

  // M5 de la 2ª auditoría: decisión explícita, no por omisión — Ventas es
  // la única lista que NO pagina (a diferencia de Historial/Inventario/
  // Clientes/Auditoría, M1/M2). El escáner de código de barras y el buscador
  // de productos/servicios/clientes necesitan matchear en memoria sin ida y
  // vuelta al servidor por cada tecla o escaneo, y hoy el catálogo es chico.
  // Si productos + servicios + clientes llegan a varios miles de filas
  // combinadas, esto hay que revisarlo (ej. paginar clientes aparte, que es
  // el más numeroso y el menos usado en el flujo de venta en sí).
  async function cargarCatalogo(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargandoCatalogo(true)
    const [productosRes, clientesRes] = await Promise.all([
      supabase
        .from('productos_vista')
        .select('id, codigo_barras, nombre, categoria, precio, stock_actual')
        .eq('activo', true)
        .order('nombre'),
      supabase.from('clientes').select('id, nombre, telefono').order('nombre'),
    ])

    if (!vigente.actual) return

    if (productosRes.error) {
      setErrorCatalogo('No se pudo cargar el catálogo. Revisa tu conexión.')
    } else {
      setErrorCatalogo(null)
      setCatalogoProductos(productosRes.data ?? [])
      // B2 de la 3ª auditoría: antes un fallo acá quedaba en silencio (la
      // lista de clientes simplemente quedaba vacía). No bloquea la venta
      // como productos (cliente es opcional en el ticket), pero sí avisa —
      // si no, "no aparece ningún cliente" parece un catálogo vacío de
      // verdad, no un error de red.
      if (clientesRes.error) {
        mostrarToast('No se pudo cargar la lista de clientes.', 'error')
      } else {
        setCatalogoClientes(clientesRes.data ?? [])
      }
    }
    setCargandoCatalogo(false)
  }

  // Las atenciones pendientes (registradas en Mi Panel o al completar una
  // cita, todavía sin cobrar) — a diferencia de productos/clientes, esta
  // lista cambia seguido (cualquier asistente puede registrar/vender una en
  // cualquier momento) así que no se refresca sola en segundo plano, solo
  // en los momentos en que de verdad puede haber cambiado: al entrar a la
  // pestaña, al abrir el buscador, después de cobrar, y al sacar del
  // carrito una que se había agregado (vuelve a estar disponible).
  // carritoActual es opcional (por defecto el carrito del render actual) —
  // hace falta pasarlo explícito cuando se llama justo después de un
  // setCarrito(...), porque la variable "carrito" de este closure todavía
  // tiene el valor VIEJO hasta el próximo render (setCarrito no la muta al
  // toque), así que sin esto se filtraba con la lista de antes de sacar/
  // vaciar el carrito y el aviso no volvía a aparecer.
  async function cargarAtencionesDisponibles(carritoActual = carrito) {
    const { data, error } = await supabase
      .from('registro_servicios')
      .select('id, servicio_id, cliente_id, precio, fecha, servicios(nombre), clientes(nombre)')
      .eq('estado', 'ACTIVO')
      .is('venta_id', null)
      .order('fecha')

    if (error) return false

    // El servidor solo sabe qué atenciones ya se VENDIERON (venta_id
    // puesto al confirmar) — una que ya está en el carrito de este ticket,
    // pero todavía sin confirmar, sigue viniendo como "disponible" en la
    // consulta. Se descarta acá para no poder agregarla dos veces al mismo
    // ticket antes de cobrar (y para que el avisito del botón se apague
    // apenas ya no quede ninguna suelta).
    const idsEnCarrito = new Set(
      carritoActual.filter((item) => item.tipo === 'SERVICIO').map((item) => item.registroServicioId),
    )
    setAtencionesDisponibles((data ?? []).filter((atencion) => !idsEnCarrito.has(atencion.id)))
    return true
  }

  async function abrirBuscadorAtenciones() {
    setModalAtencionesAbierto(true)
    setCargandoAtenciones(true)
    const huboError = !(await cargarAtencionesDisponibles())
    setCargandoAtenciones(false)
    if (huboError) {
      mostrarToast('No se pudieron cargar las atenciones pendientes.', 'error')
    }
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

  useEffect(() => {
    if (!activo) return
    cargarAtencionesDisponibles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const subtotal = sumarMontos(carrito, (item) => item.cantidad * item.precioUnitario)
  const valorDescuentoNumero = parseFloat(valorDescuento) || 0
  const esDescuentoPorcentaje = tipoDescuento === 'porcentaje'
  const descuentoPctAplicado = esDescuentoPorcentaje
    ? Math.min(100, Math.max(0, valorDescuentoNumero))
    : 0
  const montoDescuento = esDescuentoPorcentaje
    ? redondear2(subtotal * (descuentoPctAplicado / 100))
    : redondear2(Math.min(Math.max(valorDescuentoNumero, 0), subtotal))
  const total = redondear2(subtotal - montoDescuento)
  const totalMostrado = useContadorAnimado(total)
  const recibidoNumerico = parseFloat(montoRecibido) || 0
  const vuelto = redondear2(recibidoNumerico - total)
  const montoPosTarjetaSugerido = calcularMontoPosTarjeta(total)
  const montoPosTarjetaNumerico = parseFloat(montoPosTarjeta) || 0

  // "Exacto" fija Recibido al total del momento — si después el total
  // cambia (cambiar de % a monto fijo reinterpreta el mismo número
  // tecleado, agregar/quitar del carrito, etc.) mientras Recibido seguía
  // calzando con el total viejo, se actualiza junto con él para que el
  // botón no se vea "desmarcado" de la nada. Si Recibido tiene cualquier
  // otro valor (uno tecleado a mano, o un monto rápido como 10/20/50/100),
  // no se toca — por eso el resto de botones de Efectivo no se ven
  // afectados por esto, solo Exacto.
  const totalAnteriorRef = useRef(total)
  useEffect(() => {
    if (montoRecibido === String(totalAnteriorRef.current) && total !== totalAnteriorRef.current) {
      setMontoRecibido(String(total))
    }
    totalAnteriorRef.current = total
  }, [total])

  // Mismo patrón que "Exacto" arriba: el monto a digitar en POS se
  // precalcula con la fórmula de Culqi, pero es editable a mano (el cajero
  // puede ajustarlo). Si el total cambia mientras el campo seguía calzando
  // con el último sugerido, se actualiza junto con él; si el cajero ya lo
  // editó a otro valor, no se toca.
  const sugeridoAnteriorRef = useRef(montoPosTarjetaSugerido)
  useEffect(() => {
    if (
      montoPosTarjeta === String(sugeridoAnteriorRef.current) &&
      montoPosTarjetaSugerido !== sugeridoAnteriorRef.current
    ) {
      setMontoPosTarjeta(String(montoPosTarjetaSugerido))
    }
    sugeridoAnteriorRef.current = montoPosTarjetaSugerido
  }, [montoPosTarjetaSugerido])

  function alternarTipoDescuento() {
    setTipoDescuento((anterior) => (anterior === 'porcentaje' ? 'monto' : 'porcentaje'))
  }

  // Tocar el método ya seleccionado lo desmarca (vuelve a null, oculta
  // Recibido/Vuelto). Al marcar Efectivo, si Recibido está vacío se fija en
  // "Exacto" por defecto — pero si ya había un monto/botón rápido elegido
  // antes (ej. "20"), se respeta: no se pisa solo por volver a marcar
  // Efectivo.
  function seleccionarMetodoPago(nombre) {
    if (metodoPago === nombre) {
      setMetodoPago(null)
      return
    }
    setMetodoPago(nombre)
    if (nombre === 'Efectivo' && !montoRecibido) {
      setMontoRecibido(String(total))
    }
    if (nombre === 'Tarjeta' && !montoPosTarjeta) {
      setMontoPosTarjeta(String(montoPosTarjetaSugerido))
    }
  }

  function actualizarDescuento(valor) {
    if (esDescuentoPorcentaje) {
      const soloDigitos = valor.replace(/[^0-9]/g, '').slice(0, 3)
      setValorDescuento(soloDigitos === '' ? '' : String(Math.min(100, parseInt(soloDigitos, 10))))
      return
    }
    // Monto fijo en soles: dígitos + un único punto decimal, sin tope de caracteres.
    const limpio = valor.replace(/[^0-9.]/g, '')
    const primerPunto = limpio.indexOf('.')
    setValorDescuento(
      primerPunto === -1
        ? limpio
        : limpio.slice(0, primerPunto + 1) + limpio.slice(primerPunto + 1).replace(/\./g, ''),
    )
  }

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
  // atencionesDisponibles ya excluye lo que está en el carrito (ver
  // cargarAtencionesDisponibles) — el avisito del botón es solo mirar si
  // queda algo suelto.
  const hayAtencionesPendientes = atencionesDisponibles.length > 0

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

  function agregarAtencion(atencion) {
    const nuevoId = crypto.randomUUID()
    setFilaFlash(nuevoId)
    setCarrito((anterior) => [
      ...anterior,
      {
        id: nuevoId,
        tipo: 'SERVICIO',
        registroServicioId: atencion.id,
        servicioId: atencion.servicio_id,
        nombre: atencion.servicios?.nombre ?? 'Servicio',
        clienteNombre: atencion.clientes?.nombre ?? null,
        cantidad: 1,
        precioUnitario: atencion.precio,
        // Se guarda el objeto tal cual vino del buscador — si se saca del
        // carrito, vuelve a "atenciones a cobrar" al instante con este
        // mismo objeto, sin esperar una ida y vuelta al servidor.
        atencionOriginal: atencion,
      },
    ])
    // La clienta de la venta se autocompleta con la de la PRIMERA atención
    // agregada (si todavía no hay ninguna elegida) — así se ahorra el paso
    // de volver a buscarla, que es el caso normal (la misma persona que se
    // hizo el servicio es quien paga). No pisa una clienta ya elegida a
    // mano: si agrega un segundo servicio de OTRA clienta al mismo ticket
    // (ej. hija que se atiende junto a su mamá, pero paga la mamá), el
    // campo se queda con la primera.
    if (!cliente && atencion.clientes?.nombre) {
      setCliente({ id: atencion.cliente_id ?? null, nombre: atencion.clientes.nombre })
    }
    // El modal se queda abierto (no se cierra acá) para poder agregar varias
    // atenciones seguidas del mismo ticket sin reabrir el buscador cada vez
    // — la fila agregada simplemente desaparece de la lista de abajo.
    // Se quita de la lista local (no solo del servidor al vender) para que
    // no se pueda agregar la misma atención dos veces al mismo ticket antes
    // de que se confirme la venta.
    setAtencionesDisponibles((anterior) => anterior.filter((a) => a.id !== atencion.id))
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

  function quitarItem(id) {
    const item = carrito.find((i) => i.id === id)

    // Restaurada al toque, sin ida al servidor — ya se tiene el objeto
    // completo guardado desde que se agregó (atencionOriginal), así el
    // avisito del botón no tiene que esperar una consulta de red.
    if (item?.tipo === 'SERVICIO' && item.atencionOriginal) {
      setAtencionesDisponibles((anterior) =>
        [...anterior, item.atencionOriginal].sort(
          (a, b) => new Date(a.fecha) - new Date(b.fecha),
        ),
      )
    }

    setIdsSaliendo((anterior) => new Set(anterior).add(id))
    conTemporizador(() => {
      setCarrito((anterior) => {
        const siguiente = anterior.filter((i) => i.id !== id)
        // Si el cliente actual venía de esta atención (autocompletado al
        // agregarla) y ya no queda ningún otro item suyo en el carrito, se
        // limpia también — no tiene sentido dejarlo puesto para una venta
        // que ya no tiene nada de esa clienta.
        if (
          item?.clienteNombre &&
          cliente?.nombre === item.clienteNombre &&
          !siguiente.some((i) => i.clienteNombre === item.clienteNombre)
        ) {
          setCliente(null)
        }
        return siguiente
      })
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
    conTemporizador(() => {
      setCarrito([])
      setMontoRecibido('')
      setMontoPosTarjeta('')
      setMetodoPago(null)
      setCliente(null)
      setValorDescuento('')
      setTipoDescuento('porcentaje')
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
      registro_servicio_id: item.tipo === 'SERVICIO' ? item.registroServicioId : null,
      nombre: item.nombre,
      cantidad: item.cantidad,
    }))

    const { data, error } = await supabase.rpc('confirmar_venta', {
      p_metodo_pago: metodoPago,
      p_monto_recibido: metodoPago === 'Efectivo' ? recibidoNumerico : null,
      p_items: items,
      p_cliente_id: cliente?.id ?? null,
      p_descuento_pct: esDescuentoPorcentaje ? descuentoPctAplicado : 0,
      p_descuento_monto: esDescuentoPorcentaje ? 0 : montoDescuento,
      p_monto_pos_tarjeta: metodoPago === 'Tarjeta' ? montoPosTarjetaNumerico : null,
    })

    setCobrando(false)

    if (error) {
      setErrorCobro(error.message)
      return
    }

    const venta = Array.isArray(data) ? data[0] : data
    setVentaConfirmada(venta)

    // B3 de la 4ª auditoría: se imprime con los items que devuelve el
    // servidor (venta.items — nombre/precio ya resueltos contra el
    // catálogo, lo que de verdad quedó guardado), no con el carrito local.
    // Si el precio de un producto cambió entre cargar el catálogo y
    // confirmar, el carrito seguía teniendo el valor viejo — antes eso
    // imprimía líneas que no cuadraban con el TOTAL (que sí venía del
    // servidor desde el C1 de la 3ª auditoría).
    setVentaParaImprimir({
      detalle: {
        codigo: venta.codigo,
        fecha: new Date().toISOString(),
        estado: 'ACTIVA',
        total: venta.total,
        descuento_pct: esDescuentoPorcentaje ? descuentoPctAplicado : 0,
        descuento_monto: esDescuentoPorcentaje ? 0 : montoDescuento,
        metodo_pago: metodoPago,
        monto_recibido: metodoPago === 'Efectivo' ? recibidoNumerico : null,
        monto_pos_tarjeta: metodoPago === 'Tarjeta' ? montoPosTarjetaNumerico : null,
        clientes: cliente ? { nombre: cliente.nombre } : null,
      },
      items: (venta.items ?? []).map((item, indice) => ({ id: indice, ...item })),
    })

    setCarrito([])
    setMontoRecibido('')
    setMontoPosTarjeta('')
    setValorDescuento('')
    setTipoDescuento('porcentaje')
    setMetodoPago(null)
    setCliente(null)
    cargarCatalogo()
    cargarAtencionesDisponibles([])
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
    <div className="animate-entrada-pestana flex h-full flex-col">
      {/* Buscador / escáner de código de barras + Agregar servicio */}
      <div className="border-b border-border bg-surface p-3">
        {/* lg: en monitores anchos, el buscador y la fila de cliente/servicio
            se centran en vez de estirarse de borde a borde (la franja de
            fondo sí sigue ocupando todo el ancho). */}
        <div className="lg:mx-auto lg:w-full lg:max-w-5xl">
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
            onBlur={() => conTemporizador(() => setMostrarSugerencias(false), 150)}
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
              className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2.5 text-ink/60 transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}

        </div>

        {mostrarSugerencias && sugerencias.length > 0 && (
          <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
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

        <CampoColapsable abierto={!carritoExpandido} margen>
          <div className="flex items-center gap-2 pt-1.5">
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
                  className="-m-2 shrink-0 p-2 text-purple-300/70 transition-colors hover:text-red"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={abrirBuscadorAtenciones}
              className={`relative shrink-0 whitespace-nowrap rounded-lg border border-dashed px-2 py-1.5 text-xs transition-colors ${
                hayServicioEnCarrito
                  ? 'border-blue/50 text-blue hover:bg-blue/10'
                  : 'border-border-strong text-ink/70 hover:border-blue/50 hover:text-blue'
              }`}
            >
              {hayAtencionesPendientes && (
                <span className="absolute -left-1 -top-1 z-10 h-2 w-2 rounded-full bg-blue" />
              )}
              + Agregar servicio
            </button>

            <button
              type="button"
              onClick={alternarTipoDescuento}
              aria-label={esDescuentoPorcentaje ? 'Descuento porcentual — cambiar a monto fijo' : 'Descuento por monto fijo — cambiar a porcentual'}
              title="Cambiar tipo de descuento"
              className={`flex shrink-0 items-center justify-center rounded-lg border border-dashed p-1.5 transition-colors ${
                valorDescuento
                  ? 'border-red/50 text-red'
                  : 'border-border-strong text-ink/70 hover:border-red hover:text-red'
              }`}
            >
              {esDescuentoPorcentaje ? (
                <Percent className="h-3.5 w-3.5" />
              ) : (
                <span className="w-3.5 text-center font-mono text-[11px] font-semibold leading-none">
                  S/
                </span>
              )}
            </button>

            <input
              type="search"
              inputMode={esDescuentoPorcentaje ? 'numeric' : 'decimal'}
              maxLength={esDescuentoPorcentaje ? 3 : undefined}
              autoComplete="new-password"
              value={valorDescuento}
              onChange={(evento) => actualizarDescuento(evento.target.value)}
              placeholder="0"
              aria-label={esDescuentoPorcentaje ? 'Porcentaje de descuento' : 'Monto de descuento'}
              className={`w-12 shrink-0 rounded-lg border px-1.5 py-1.5 text-center font-mono text-xs outline-none ${
                valorDescuento
                  ? 'border-red bg-red/10 text-red'
                  : 'border-border bg-surface-2 text-ink focus:border-red'
              }`}
            />
          </div>
        </CampoColapsable>

        {errorCatalogo && (
          <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {errorCatalogo}
          </p>
        )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 pt-0 sm:overflow-y-auto">
        <div className="flex h-full min-h-0 w-full flex-col gap-3 sm:h-auto lg:mx-auto lg:max-w-5xl lg:flex-row lg:items-start">
          {/* Columna de ticket (fija en móvil el espacio disponible; crece en desktop) */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Zona de ticket: en móvil ocupa el espacio libre (entre header y
                el bloque de pago fijo); en tablet/desktop mantiene el alto
                fijo de ~4 filas y media, igual que antes */}
            <div
              className={`-mx-3 flex min-h-0 flex-1 flex-col border-border bg-bg sm:mx-0 sm:rounded-lg sm:border-t sm:flex-none ${
                carritoExpandido ? 'border-t' : ''
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setCarritoExpandido((anterior) => !anterior)}
                onKeyDown={manejarActivacionTeclado(() => setCarritoExpandido((anterior) => !anterior))}
                aria-expanded={carritoExpandido}
                aria-label={carritoExpandido ? 'Contraer carrito' : 'Expandir carrito'}
                className={`${esTactil ? 'grid-cols-[1fr_5rem_auto]' : 'grid-cols-[1fr_5rem_auto_1.5rem]'} grid cursor-pointer gap-3 border-b border-border pr-2 pl-3 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink transition-colors hover:bg-surface-2/50`}
              >
                <span>Producto</span>
                <span className="text-center">Cantidad</span>
                <span className="-ml-3 text-right">Subtotal</span>
                {!esTactil && <span />}
              </div>

              <div
                className={`min-h-0 flex-1 divide-y divide-border overflow-y-auto sm:h-[300px] sm:flex-none sm:pb-0 ${
                  carritoExpandido ? 'pb-3' : 'pb-[22rem]'
                }`}
              >
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
                      esTactil={esTactil}
                      onCambiarCantidad={cambiarCantidad}
                      onQuitar={quitarItem}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Columna de totales, pago y acciones: anclada al fondo en móvil
              (fixed bottom-0, crece hacia arriba), en flujo normal desde sm+,
              barra lateral fija en desktop (lg+).
              max-h-[100dvh] + overflow-y-auto: en móvil con el teclado
              abierto, 100dvh ya es el alto del viewport encogido (sin el
              teclado), así que el panel nunca pasa de ese alto y, si el
              contenido no entra en pantallas muy chicas, se scrollea dentro
              del propio panel en vez de mandar los botones fuera de la vista. */}
          <div
            className={`fixed inset-x-0 bottom-0 z-20 max-h-[100dvh] w-full overflow-y-auto rounded-lg border border-border bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-in-out sm:static sm:z-auto sm:max-h-none sm:translate-y-0 sm:pb-3 sm:pointer-events-auto lg:w-[360px] lg:flex-none ${
              carritoExpandido ? 'translate-y-full pointer-events-none' : 'translate-y-0'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[19px] text-ink">Total</span>
              <span className="flex items-baseline gap-2">
                {montoDescuento > 0 && (
                  <span className="font-mono text-sm text-ink/40 line-through">
                    {formatearSoles(subtotal)}
                  </span>
                )}
                <span className="font-mono text-2xl font-semibold text-amber">
                  {formatearSoles(totalMostrado)}
                </span>
              </span>
            </div>

            {(montoDescuento > 0 || metodoPago === 'Efectivo') && (
              <div
                className={`mt-1 flex items-center text-sm ${
                  montoDescuento > 0 ? 'justify-between' : 'justify-end'
                }`}
              >
                {montoDescuento > 0 && (
                  <span className="text-red">
                    Descuento{esDescuentoPorcentaje ? ` (${descuentoPctAplicado}%)` : ''}:{' '}
                    <span className="font-mono">-{formatearSoles(montoDescuento)}</span>
                  </span>
                )}
                {metodoPago === 'Efectivo' && (
                  <span className={vuelto < 0 ? 'text-red' : 'text-green'}>
                    Vuelto: <span className="font-mono font-semibold">{formatearSoles(vuelto)}</span>
                  </span>
                )}
              </div>
            )}

            <div className="mt-3">
              <p className="mb-1.5 text-xs text-ink">Método de pago</p>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2">
                {metodosPago.map((metodo) => (
                  <button
                    key={metodo.nombre}
                    type="button"
                    onClick={() => seleccionarMetodoPago(metodo.nombre)}
                    className={`rounded-lg border px-1 py-2 text-[11px] transition-colors sm:px-2 sm:text-sm ${
                      metodoPago === metodo.nombre
                        ? metodo.clasesActivo
                        : 'border-border bg-surface-2 text-ink hover:border-border-strong'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {metodo.nombre === 'Tarjeta' ? (
                        <span className="shrink-0 text-sm leading-none">💳</span>
                      ) : (
                        <img src={metodo.icono} alt="" className="h-4 w-4 shrink-0" />
                      )}
                      <span className="sm:hidden">{metodo.nombreCorto}</span>
                      <span className="hidden sm:inline">{metodo.nombre}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <CampoColapsable abierto={metodoPago === 'Efectivo'} margen>
              <div>
                <label className="mb-1 block text-xs text-ink">Recibido</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="search"
                    inputMode="decimal"
                    autoComplete="new-password"
                    value={montoRecibido}
                    onChange={(evento) => setMontoRecibido(evento.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMontoRecibido(String(total))}
                      className={`shrink-0 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                        montoRecibido === String(total)
                          ? 'border-green bg-green/10 text-green'
                          : 'border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                      }`}
                    >
                      Exacto
                    </button>
                    {MONTOS_RAPIDOS_EFECTIVO.map((monto) => (
                      <button
                        key={monto}
                        type="button"
                        onClick={() => setMontoRecibido(String(monto))}
                        className={`shrink-0 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                          montoRecibido === String(monto)
                            ? 'border-green bg-green/10 text-green'
                            : 'border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                        }`}
                      >
                        {monto}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CampoColapsable>

            <CampoColapsable abierto={metodoPago === 'Tarjeta'} margen>
              <div>
                <label className="mb-1 block text-xs text-ink">💳 Digitar en POS</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="search"
                    inputMode="decimal"
                    autoComplete="new-password"
                    value={montoPosTarjeta}
                    onChange={(evento) => setMontoPosTarjeta(evento.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
                  />
                  <button
                    type="button"
                    onClick={() => setMontoPosTarjeta(String(montoPosTarjetaSugerido))}
                    className={`shrink-0 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                      montoPosTarjeta === String(montoPosTarjetaSugerido)
                        ? 'border-green bg-green/10 text-green'
                        : 'border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                    }`}
                  >
                    Sugerido
                  </button>
                </div>
              </div>
            </CampoColapsable>

            <CampoColapsable abierto={metodoPago === 'Transferencia'} margen>
              <div>
                <label className="mb-1 block text-xs text-ink">Cuenta para transferencias</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="search"
                    autoComplete="new-password"
                    value={borradorCuentaTransferencia}
                    disabled={!esAdmin || cuentaTransferenciaBloqueada}
                    onChange={(evento) => setBorradorCuentaTransferencia(evento.target.value)}
                    onBlur={() => {
                      if (!cuentaTransferenciaBloqueada) confirmarYBloquearCuentaTransferencia()
                    }}
                    onKeyDown={(evento) => {
                      if (evento.key === 'Enter') evento.target.blur()
                    }}
                    placeholder="N.° de cuenta / CCI"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber disabled:text-ink/60"
                  />
                  {esAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        cuentaTransferenciaBloqueada
                          ? setCuentaTransferenciaBloqueada(false)
                          : confirmarYBloquearCuentaTransferencia()
                      }
                      aria-label={cuentaTransferenciaBloqueada ? 'Desbloquear' : 'Bloquear y guardar'}
                      className="shrink-0 p-2 text-ink/60 transition-colors hover:text-amber"
                    >
                      {cuentaTransferenciaBloqueada ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        <Unlock className="h-4 w-4 text-amber" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </CampoColapsable>

            {errorCobro && (
              <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                {errorCobro}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={pedirCancelarVenta}
                disabled={cobrando}
                className={`flex-1 whitespace-nowrap rounded-lg border bg-transparent py-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                  carrito.length > 0
                    ? 'border-red text-red hover:bg-red/10'
                    : 'border-border-strong text-ink/60'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarVenta}
                disabled={!puedeCobrar || cobrando}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg py-3 text-base font-bold transition-colors sm:text-lg lg:text-base ${
                  puedeCobrar && !cobrando ? 'bg-green text-bg' : 'bg-surface-3 text-ink'
                }`}
              >
                <Check className="h-5 w-5" />
                {cobrando ? 'Cobrando...' : 'Confirmar venta'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {modalAtencionesAbierto && (
        <ModalBuscarAtencion
          atenciones={atencionesDisponibles}
          cargando={cargandoAtenciones}
          onSeleccionar={agregarAtencion}
          onCerrar={() => setModalAtencionesAbierto(false)}
        />
      )}

      {modalClienteAbierto && (
        <ModalBuscarCliente
          clientes={catalogoClientes}
          onSeleccionar={(clienteElegido) => {
            setCliente(clienteElegido)
            setModalClienteAbierto(false)
          }}
          onRegistrarNuevo={(nombre) => {
            setModalClienteAbierto(false)
            setNombreClienteNuevo(nombre)
            setModalRegistroClienteAbierto(true)
          }}
          onCerrar={() => setModalClienteAbierto(false)}
        />
      )}

      {modalRegistroClienteAbierto && (
        <ModalCliente
          nombreInicial={nombreClienteNuevo}
          onCerrar={() => setModalRegistroClienteAbierto(false)}
          onGuardado={(clienteCreado) => {
            setModalRegistroClienteAbierto(false)
            cargarCatalogo()
            if (clienteCreado) setCliente(clienteCreado)
            mostrarToast('Cliente creado.', 'exito')
          }}
        />
      )}

      {modalEscanerAbierto && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80">
              <p className="font-mono text-sm text-ink/60">Cargando cámara...</p>
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
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
          <div ref={panelConfirmadaRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
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
