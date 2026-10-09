import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { X, ShoppingCart, Check, User, Camera, Mic, Percent, Lock, Unlock, Ticket, Receipt, ScrollText } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import { useCarrito } from '../context/CarritoContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useEstadoNegocio } from '../context/EstadoNegocioContext.jsx'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import { interpretarCuponCaja } from '../lib/cupones.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import InputBusqueda from '../components/InputBusqueda.jsx'
import ModalBuscarAtencion from '../components/ModalBuscarAtencion.jsx'
import ModalBuscarCliente from '../components/ModalBuscarCliente.jsx'
import { contarAtenciones } from '../lib/buscarAtenciones.js'
import { useBusquedaProductosVenta } from '../hooks/useBusquedaProductosVenta.js'
import { buscarProductosVenta, productoPorCodigo, productosPorIds } from '../lib/buscarProductosVenta.js'
import ModalCliente from '../components/ModalCliente.jsx'
import TicketImprimible from '../components/TicketImprimible.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import ModalDatosComprobante from '../components/ModalDatosComprobante.jsx'
import { boletaRequiereDni, comprobanteCompleto } from '../lib/comprobante.js'

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

// Desglose de lo que se digita en el POS: venta + comisión (3.44% o mínimo
// S/ 3.50) + IGV 18% sobre la comisión = monto. Solo lectura: se deriva del
// monto escrito, que es el único campo editable.
function desglosarMontoTarjeta(monto) {
  const porPorcentaje = monto * 0.0344
  const esMinimo = porPorcentaje * 1.18 < COMISION_MINIMA_TARJETA
  const comision = esMinimo ? 3.5 : porPorcentaje
  const igv = esMinimo ? COMISION_MINIMA_TARJETA - 3.5 : porPorcentaje * 0.18
  return {
    monto,
    comision,
    igv,
    venta: monto - comision - igv,
    etiquetaComision: esMinimo ? 'mín.' : '3.44%',
  }
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
      className={`${esTactil ? 'grid-cols-[1fr_5rem_auto]' : 'grid-cols-[minmax(0,1fr)_5rem_5rem_1.5rem]'} touch-pan-y grid items-center gap-5 overflow-hidden px-(--separador-vertical) py-2 sm:px-6 transition-[transform_300ms_ease-in,opacity_150ms_ease-in_150ms,background-color_150ms_ease-out] ${
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
          (item.clienteNombre || item.atendidoPor) && (
            <div className="mt-0.5 text-[11px] leading-tight text-ink/50">
              {item.clienteNombre && <p className="truncate">Para: {item.clienteNombre}</p>}
              {item.atendidoPor && <p className="truncate">Hecho por: {item.atendidoPor}</p>}
            </div>
          )
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

      <span className="whitespace-nowrap text-right font-mono text-sm text-ink">
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
    codigoCupon,
    setCodigoCupon,
  } = useCarrito()
  const [cuponPreview, setCuponPreview] = useState(null)
  const [cuponError, setCuponError] = useState('')
  const [buscandoCupon, setBuscandoCupon] = useState(false)
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
  // Comprobante pedido para esta venta: null (sin comprobante) o
  // { tipo: 'BOLETA' | 'FACTURA', documento, nombre, direccion }. Por ahora solo
  // se anota y se valida; aún no viaja al servidor ni se emite a SUNAT.
  const [comprobante, setComprobante] = useState(null)
  const [modalComprobante, setModalComprobante] = useState(null) // 'BOLETA' | 'FACTURA' | null

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

  // Stock/precio ACTUAL de los productos del carrito, por ID (QA-047): ya no hay copia del catálogo.
  const [productosCarrito, setProductosCarrito] = useState({})
  const [errorCatalogo, setErrorCatalogo] = useState(null)
  // Cuántas atenciones pendientes hay fuera del carrito (solo el conteo, para el avisito del botón). La
  // lista la busca el modal en el servidor (QA-044); aquí ya no se descarga ni se pagina.
  const [pendientesFuera, setPendientesFuera] = useState(0)
  const [modalAtencionesAbierto, setModalAtencionesAbierto] = useState(false)
  const [modalClienteAbierto, setModalClienteAbierto] = useState(false)
  const [modalRegistroClienteAbierto, setModalRegistroClienteAbierto] = useState(false)
  const [nombreClienteNuevo, setNombreClienteNuevo] = useState('')
  const [modalEscanerAbierto, setModalEscanerAbierto] = useState(false)
  const buscandoCodigoRef = useRef(false)

  // QA-047: el catálogo de productos YA NO se descarga. Antes (M5 de la 2ª auditoría) se leía completo y sin
  // paginar para buscar y escanear en memoria; con más de 1000 productos activos el servidor cortaba la
  // respuesta y los posteriores por nombre eran invisibles al buscador y al escáner. Ahora el buscador
  // consulta el servidor (nombre), el código de barras se resuelve por consulta exacta y el stock de lo que
  // está en el carrito se pide por ID (refrescarProductosCarrito).
  async function refrescarProductosCarrito(ids) {
    if (ids.length === 0) return
    try {
      const filas = await productosPorIds(supabase, ids)
      setProductosCarrito((anterior) => {
        const siguiente = { ...anterior }
        for (const fila of filas) siguiente[fila.id] = fila
        return siguiente
      })
      setErrorCatalogo(null)
    } catch {
      setErrorCatalogo('No se pudo comprobar el stock de los productos. Revisa tu conexión.')
    }
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
  async function actualizarPendientes(idsCarrito) {
    try {
      setPendientesFuera(await contarAtenciones(supabase, { excluirIds: idsCarrito }))
    } catch {
      // Un fallo del conteo solo deja el avisito como estaba; el modal avisa su propio error al abrirse.
    }
  }

  function abrirBuscadorAtenciones() {
    setModalAtencionesAbierto(true)
  }

  // El stock del carrito se vuelve a pedir al entrar a la pestaña y cuando cambian los productos del carrito.
  const idsProductosCarrito = carrito.filter((item) => item.tipo === 'PRODUCTO').map((item) => item.productoId)
  const claveProductosCarrito = [...idsProductosCarrito].sort().join(',')
  useEffect(() => {
    if (!activo) return
    refrescarProductosCarrito(claveProductosCarrito ? claveProductosCarrito.split(',') : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, claveProductosCarrito])

  // El conteo se vuelve a pedir al entrar a la pestaña y cada vez que cambian las atenciones del carrito
  // (se agregó una, se sacó una o se cobró y el carrito quedó vacío).
  const idsServiciosCarrito = carrito
    .filter((item) => item.tipo === 'SERVICIO')
    .map((item) => item.registroServicioId)
  const claveServiciosCarrito = [...idsServiciosCarrito].sort().join(',')
  useEffect(() => {
    if (!activo) return
    actualizarPendientes(claveServiciosCarrito ? claveServiciosCarrito.split(',') : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, claveServiciosCarrito])

  // Si el escáner de cámara quedó abierto y el usuario cambia de pestaña
  // desde el menú (la página sigue montada, solo oculta), hay que cerrarlo:
  // si no, la cámara sigue encendida en segundo plano.
  useEffect(() => {
    if (!activo) setModalEscanerAbierto(false)
  }, [activo])

  const busquedaProductos = useBusquedaProductosVenta({ termino: busqueda })
  const sugerencias = busquedaProductos.resultados

  const subtotal = sumarMontos(carrito, (item) => item.cantidad * item.precioUnitario)
  const valorDescuentoNumero = parseFloat(valorDescuento) || 0
  const esDescuentoPorcentaje = tipoDescuento === 'porcentaje'
  const esCupon = tipoDescuento === 'cupon'
  const descuentoPctAplicado = esDescuentoPorcentaje
    ? Math.min(100, Math.max(0, valorDescuentoNumero))
    : 0
  // Bug real reportado (cupón de Fidelización, 20%): esto SIEMPRE trataba
  // cuponPreview.valor como monto fijo en soles, sin mirar tipoDescuento —
  // el "Total"/"Vuelto" que veía la cajera en pantalla no coincidía con lo
  // que confirmar_venta() termina cobrando de verdad en el servidor (que sí
  // ya distinguía % de monto fijo, ver 97_cupones_fidelizacion.sql). Mismo
  // cálculo que ya existía acá abajo para el descuento manual por %.
  const montoDescuento = esCupon
    ? cuponPreview?.tipoDescuento === 'PORCENTAJE'
      ? redondear2(subtotal * ((cuponPreview.valor ?? 0) / 100))
      : redondear2(Math.min(cuponPreview?.valor ?? 0, subtotal))
    : esDescuentoPorcentaje
      ? redondear2(subtotal * (descuentoPctAplicado / 100))
      : redondear2(Math.min(Math.max(valorDescuentoNumero, 0), subtotal))
  const total = redondear2(subtotal - montoDescuento)
  const totalMostrado = useContadorAnimado(total)
  const recibidoNumerico = parseFloat(montoRecibido) || 0
  const vuelto = redondear2(recibidoNumerico - total)
  const montoPosTarjetaSugerido = calcularMontoPosTarjeta(total)
  const desgloseTarjeta = desglosarMontoTarjeta(montoPosTarjetaSugerido)
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

  // Vista previa del cupón: no decide nada por sí sola (el canje real y
  // seguro pasa por confirmar_venta(), que vuelve a validar todo en el
  // servidor) — solo evita que la cajera confirme a ciegas un código
  // inválido o ya usado, y muestra de quién es el cupón antes de cobrar.
  useEffect(() => {
    if (!esCupon || codigoCupon.length !== 6) {
      setCuponPreview(null)
      setCuponError('')
      setBuscandoCupon(false)
      return undefined
    }

    let vigente = true
    // Una vista previa anterior (otro código) no puede seguir habilitando el cobro mientras se verifica este.
    setCuponPreview(null)
    setCuponError('')
    setBuscandoCupon(true)
    const temporizador = setTimeout(() => {
      supabase
        .from('cupones')
        // "clientes!cliente_id" desambigua: cupones tiene DOS FK a
        // clientes (cliente_id y referido_id) — sin el hint, PostgREST
        // no sabe cuál usar y el select entero falla (se veía como
        // "código no encontrado" aunque el cupón sí existiera).
        .select('valor, tipo_descuento, estado, vigente_hasta, clientes!cliente_id(nombre)')
        .eq('codigo', codigoCupon.toUpperCase())
        .maybeSingle()
        .then(({ data, error }) => {
          if (!vigente) return
          setBuscandoCupon(false)
          const resultado = interpretarCuponCaja({ data, error })
          setCuponPreview(resultado.preview)
          setCuponError(resultado.error)
        })
    }, 400)

    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [esCupon, codigoCupon])

  function alternarTipoDescuento() {
    setTipoDescuento((anterior) => {
      const siguiente = anterior === 'porcentaje' ? 'monto' : anterior === 'monto' ? 'cupon' : 'porcentaje'
      // Limpia el valor del modo que se deja — un código de cupón viejo
      // colgado ahí es más riesgoso que un número de descuento viejo (se
      // reenviaría a confirmar_venta si no se limpia).
      if (anterior === 'cupon') setCodigoCupon('')
      if (siguiente === 'cupon') setValorDescuento('')
      return siguiente
    })
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

  function actualizarCodigoCupon(valor) {
    setCodigoCupon(valor.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6))
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
    const producto = productosCarrito[productoId]
    return producto ? producto.stock_actual : Infinity
  }

  const haySobreStock = carrito.some(
    (item) => item.tipo === 'PRODUCTO' && item.cantidad > obtenerStockProducto(item.productoId),
  )
  const hayServicioEnCarrito = carrito.some((item) => item.tipo === 'SERVICIO')
  // pendientesFuera ya excluye lo que está en el carrito (ver actualizarPendientes): el avisito del botón
  // es solo mirar si queda algo suelto.
  const hayAtencionesPendientes = pendientesFuera > 0

  const puedeCobrar =
    carrito.length > 0 &&
    metodoPago !== null &&
    !haySobreStock &&
    (metodoPago !== 'Efectivo' || recibidoNumerico >= total) &&
    (!esCupon || codigoCupon === '' || Boolean(cuponPreview)) &&
    comprobanteCompleto(comprobante, total)

  // Boleta/Factura: tocar el botón activo lo quita (vuelve a "sin comprobante").
  // La boleta no pide datos salvo desde el umbral de DNI; la factura siempre.
  function elegirComprobante(tipo) {
    if (comprobante?.tipo === tipo) {
      setComprobante(null)
      return
    }
    if (tipo === 'BOLETA' && !boletaRequiereDni(total)) {
      setComprobante({ tipo, documento: '', nombre: '', direccion: '' })
      return
    }
    setModalComprobante(tipo)
  }

  useEffect(() => {
    if (!filaFlash) return undefined
    const temporizador = setTimeout(() => setFilaFlash(null), 450)
    return () => clearTimeout(temporizador)
  }, [filaFlash])

  function agregarProducto(producto) {
    setProductosCarrito((anterior) => ({ ...anterior, [producto.id]: producto }))
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
        atendidoPor: atencion.usuarios?.nombre_completo ?? null,
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
    // — la fila agregada desaparece al instante de la lista (el modal recibe los
    // ids del carrito como exclusión), así no se puede agregar dos veces antes de cobrar.
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
      setComprobante(null)
      setValorDescuento('')
      setCodigoCupon('')
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
      p_descuento_monto: esDescuentoPorcentaje || esCupon ? 0 : montoDescuento,
      p_monto_pos_tarjeta: metodoPago === 'Tarjeta' ? montoPosTarjetaNumerico : null,
      p_codigo_cupon: esCupon && codigoCupon ? codigoCupon : null,
    })

    setCobrando(false)

    if (error) {
      setErrorCobro(error.message)
      return
    }

    const venta = Array.isArray(data) ? data[0] : data
    setVentaConfirmada({ ...venta, comprobante })

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
    setCodigoCupon('')
    setTipoDescuento('porcentaje')
    setMetodoPago(null)
    setCliente(null)
    setComprobante(null)
    // El carrito queda vacío: el efecto de arriba vuelve a contar las pendientes.
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

    resolverEnter(busqueda.trim())
  }

  // Enter sin sugerencia activa: primero el código de barras EXACTO (el escáner de pistola escribe el código y
  // envía Enter), y si no es un código, la única coincidencia por nombre. Todo se consulta al servidor, no a
  // la lista de sugerencias (que puede ir un paso atrás de lo escrito). `buscandoCodigoRef` evita que un
  // doble Enter agregue dos veces el mismo producto.
  async function resolverEnter(texto) {
    if (!texto || buscandoCodigoRef.current) return
    buscandoCodigoRef.current = true
    try {
      const { producto, ambiguo } = await productoPorCodigo(supabase, texto)
      if (ambiguo) {
        mostrarToast('Ese código pertenece a más de un producto. Búscalo por nombre.', 'error')
        return
      }
      if (producto) {
        agregarProducto(producto)
        setBusqueda('')
        setMostrarSugerencias(false)
        return
      }
      const porNombre = await buscarProductosVenta(supabase, texto)
      if (porNombre.length === 1) seleccionarSugerencia(porNombre[0])
    } catch {
      mostrarToast('No se pudo consultar el producto. Inténtalo de nuevo.', 'error')
    } finally {
      buscandoCodigoRef.current = false
    }
  }

  return (
    <div className="animate-entrada-pestana flex h-full flex-col">
      {/* Buscador / escáner de código de barras + Agregar servicio */}
      <div className="border-b border-border bg-surface px-(--separador-vertical) pb-3 pt-(--separador-horizontal)">
        {/* lg: en monitores anchos, el buscador y la fila de cliente/servicio
            se centran en vez de estirarse de borde a borde (la franja de
            fondo sí sigue ocupando todo el ancho). */}
        <div className="lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
        <div className="relative flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink/60">
            <IconoBuscar />
          </span>
          <InputBusqueda
            value={busqueda}
            onChange={(evento) => {
              setBusqueda(evento.target.value)
              setMostrarSugerencias(true)
              setIndiceActivo(-1)
            }}
            onKeyDown={manejarKeyDown}
            onFocus={() => busqueda && setMostrarSugerencias(true)}
            onBlur={() => conTemporizador(() => setMostrarSugerencias(false), 150)}
            textoPlaceholder="Buscar producto o escanear código de barras..."
            animar={activo}
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

        {mostrarSugerencias && busqueda.trim() && (busquedaProductos.buscando || busquedaProductos.error || (busquedaProductos.listo && sugerencias.length === 0)) && (
          <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm shadow-lg">
            {busquedaProductos.buscando && <p className="text-ink/60">Buscando...</p>}
            {busquedaProductos.error && (
              <p className="text-red">
                No se pudo buscar productos.{' '}
                <button
                  type="button"
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={busquedaProductos.reintentar}
                  className="underline"
                >
                  Reintentar
                </button>
              </p>
            )}
            {busquedaProductos.listo && sugerencias.length === 0 && (
              <p className="text-ink/60">No hay productos que coincidan.</p>
            )}
          </div>
        )}

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
            className={`flex shrink-0 items-center justify-center rounded-lg p-2.5 transition-colors ${
              escuchando
                ? 'animate-pulse bg-red/10 text-red'
                : 'text-ink/70 hover:text-amber'
            }`}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setModalEscanerAbierto(true)}
          aria-label="Escanear código de barras con la cámara"
          className="flex shrink-0 items-center justify-center rounded-lg p-2.5 text-ink/70 transition-colors hover:text-amber"
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
              aria-label={
                esDescuentoPorcentaje
                  ? 'Descuento porcentual — cambiar a monto fijo'
                  : esCupon
                    ? 'Cupón — cambiar a porcentaje'
                    : 'Descuento por monto fijo — cambiar a cupón'
              }
              title="Cambiar tipo de descuento"
              className={`flex shrink-0 items-center justify-center rounded-lg border border-dashed p-1.5 transition-colors ${
                valorDescuento || codigoCupon
                  ? 'border-red/50 text-red'
                  : 'border-border-strong text-ink/70 hover:border-red hover:text-red'
              }`}
            >
              {esDescuentoPorcentaje ? (
                <Percent className="h-3.5 w-3.5" />
              ) : esCupon ? (
                <Ticket className="h-3.5 w-3.5" />
              ) : (
                <span className="w-3.5 text-center font-mono text-[11px] font-semibold leading-none">
                  S/
                </span>
              )}
            </button>

            {/* Contenedor con ancho animado: al abrir/cerrar el campo de código
                lo que está a su izquierda (cliente, servicio) se desplaza suave */}
            <div
              className={`shrink-0 transition-[width] duration-300 ease-in-out ${
                esCupon ? 'w-20' : 'w-12'
              }`}
            >
            {esCupon ? (
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                value={codigoCupon}
                onChange={(evento) => actualizarCodigoCupon(evento.target.value)}
                placeholder="CÓDIGO"
                aria-label="Código de cupón"
                className={`w-full rounded-lg border px-1.5 py-1.5 text-center font-mono text-xs uppercase tracking-widest outline-none focus-visible:outline-none! ${
                  codigoCupon
                    ? 'border-red bg-red/10 text-red'
                    : 'border-border bg-surface-2 text-ink'
                }`}
              />
            ) : (
              <input
                type="search"
                inputMode={esDescuentoPorcentaje ? 'numeric' : 'decimal'}
                maxLength={esDescuentoPorcentaje ? 3 : undefined}
                autoComplete="new-password"
                value={valorDescuento}
                onChange={(evento) => actualizarDescuento(evento.target.value)}
                placeholder="0"
                aria-label={esDescuentoPorcentaje ? 'Porcentaje de descuento' : 'Monto de descuento'}
                className={`w-full rounded-lg border px-1.5 py-1.5 text-center font-mono text-xs outline-none ${
                  valorDescuento
                    ? 'border-red bg-red/10 text-red'
                    : 'border-border bg-surface-2 text-ink focus:border-red'
                }`}
              />
            )}
            </div>
          </div>
        </CampoColapsable>

        {esCupon && codigoCupon.length === 6 && (
          <p
            className={`mt-1.5 text-xs ${
              cuponPreview ? 'text-green' : cuponError ? 'text-red' : 'text-ink/50'
            }`}
          >
            {buscandoCupon
              ? 'Buscando cupón...'
              : cuponPreview
                ? `Cupón de ${cuponPreview.clienteNombre ?? 'cliente'} — ${
                    cuponPreview.tipoDescuento === 'PORCENTAJE'
                      ? `${cuponPreview.valor}%`
                      : formatearSoles(cuponPreview.valor)
                  }`
                : cuponError}
          </p>
        )}

        {errorCatalogo && (
          <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {errorCatalogo}
          </p>
        )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-(--separador-vertical) pb-3 pt-0 sm:overflow-y-auto">
        <div className="flex h-full min-h-0 w-full flex-col gap-3 sm:h-auto lg:mx-auto lg:max-w-(--ancho-pestana) lg:flex-row lg:items-start">
          {/* Columna de ticket (fija en móvil el espacio disponible; crece en desktop) */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Zona de ticket: en móvil ocupa el espacio libre (entre header y
                el bloque de pago fijo); en tablet/desktop mantiene el alto
                fijo de ~4 filas y media, igual que antes */}
            <div
              className={`-mx-(--separador-vertical) flex min-h-0 flex-1 flex-col border-border bg-bg sm:mx-0 sm:rounded-lg sm:flex-none ${
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
                className={`${esTactil ? 'grid-cols-[1fr_5rem_auto]' : 'grid-cols-[minmax(0,1fr)_5rem_5rem_1.5rem]'} grid cursor-pointer gap-5 border-b border-border px-(--separador-vertical) py-2.5 sm:px-6 font-mono text-[11px] uppercase tracking-wider text-ink transition-colors hover:bg-surface-2/50`}
              >
                <span>Producto</span>
                <span className="translate-x-2 text-center">Cantidad</span>
                <span className="translate-x-2 text-right">Subtotal</span>
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
                    <p className="font-mono text-sm text-ink/30">El carrito está vacío</p>
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
            className={`fixed inset-x-0 bottom-0 z-20 max-h-[100dvh] w-full overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical) pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-in-out sm:static sm:z-auto sm:max-h-none sm:translate-y-0 sm:pb-3 sm:pointer-events-auto lg:mt-3 lg:w-[360px] lg:flex-none ${
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
                    {esCupon ? `Cupón ${codigoCupon}` : `Descuento${esDescuentoPorcentaje ? ` (${descuentoPctAplicado}%)` : ''}`}
                    :{' '}
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
                        <img
                          src={metodo.icono}
                          alt=""
                          className={`h-4 w-4 shrink-0 ${
                            metodo.nombre === 'Transferencia' ? 'opacity-80 brightness-0 invert' : ''
                          }`}
                        />
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
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-green focus-visible:outline-green!"
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
                <label className="mb-1 block text-xs text-ink">Digitar en POS</label>
                <div className="flex min-h-[38px] items-center justify-between gap-2 rounded-lg border border-green bg-surface-2 px-3 py-2 font-mono">
                  <span className="min-w-0 truncate text-[11px] text-ink/60">
                    {total.toFixed(2)} + {desgloseTarjeta.comision.toFixed(2)} com. +{' '}
                    {desgloseTarjeta.igv.toFixed(2)} IGV
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-green">
                    {formatearSoles(montoPosTarjetaSugerido)}
                  </span>
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

            <div className="mt-3">
              <p className="mb-1.5 text-xs text-ink">Comprobante</p>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                {[
                  { tipo: 'BOLETA', nombre: 'Boleta', Icono: Receipt },
                  { tipo: 'FACTURA', nombre: 'Factura', Icono: ScrollText },
                ].map((opcion) => (
                  <button
                    key={opcion.tipo}
                    type="button"
                    aria-pressed={comprobante?.tipo === opcion.tipo}
                    onClick={() => elegirComprobante(opcion.tipo)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] transition-colors sm:text-sm ${
                      comprobante?.tipo === opcion.tipo
                        ? 'border-amber bg-amber/10 text-amber'
                        : 'border-border bg-surface-2 text-ink hover:border-border-strong'
                    }`}
                  >
                    <opcion.Icono className="h-4 w-4 shrink-0" />
                    {opcion.nombre}
                  </button>
                ))}
              </div>
              {comprobante && (
                <p className="mt-1.5 text-[11px] text-ink/60">
                  {comprobante.documento
                    ? `${comprobante.tipo === 'FACTURA' ? 'RUC' : 'DNI'} ${comprobante.documento}${
                        comprobante.nombre ? ` · ${comprobante.nombre}` : ''
                      }`
                    : boletaRequiereDni(total) || comprobante.tipo === 'FACTURA'
                      ? 'Sin datos del comprador.'
                      : ''}
                  {!comprobanteCompleto(comprobante, total) && (
                    <span className="text-amber"> Faltan datos. </span>
                  )}{' '}
                  {(comprobante.tipo === 'FACTURA' || boletaRequiereDni(total)) && (
                    <button
                      type="button"
                      onClick={() => setModalComprobante(comprobante.tipo)}
                      className="underline hover:text-amber"
                    >
                      {comprobanteCompleto(comprobante, total) ? 'Editar' : 'Completar'}
                    </button>
                  )}
                </p>
              )}
            </div>

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
          excluirIds={idsServiciosCarrito}
          onSeleccionar={agregarAtencion}
          onCerrar={() => setModalAtencionesAbierto(false)}
        />
      )}

      {modalClienteAbierto && (
        <ModalBuscarCliente
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
          bajoHeader
          nombreInicial={nombreClienteNuevo}
          onCerrar={() => setModalRegistroClienteAbierto(false)}
          onGuardado={(clienteCreado) => {
            setModalRegistroClienteAbierto(false)
            if (clienteCreado) setCliente(clienteCreado)
            mostrarToast('Cliente creado.', 'exito')
          }}
        />
      )}

      {modalEscanerAbierto && (
        <Suspense
          fallback={
            <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/80">
              <p className="font-mono text-sm text-ink/60">Cargando cámara...</p>
            </div>
          }
        >
          <ModalEscanerCodigoBarras
            buscarPorCodigo={(codigo) => productoPorCodigo(supabase, codigo)}
            onProductoEncontrado={agregarProducto}
            onCerrar={() => setModalEscanerAbierto(false)}
          />
        </Suspense>
      )}

      {modalComprobante && (
        <ModalDatosComprobante
          tipo={modalComprobante}
          inicial={comprobante?.tipo === modalComprobante ? comprobante : null}
          total={total}
          dniObligatorio={modalComprobante === 'BOLETA' && boletaRequiereDni(total)}
          onGuardar={(datos) => {
            setComprobante(datos)
            setModalComprobante(null)
          }}
          onCerrar={() => setModalComprobante(null)}
        />
      )}

      {confirmandoCancelar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
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
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelConfirmadaRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario) text-center">
            <p className="text-3xl text-green">✓</p>
            <h2 className="mt-2 text-base font-semibold text-ink">Venta confirmada</h2>
            <p className="mt-1 font-mono text-sm text-ink/60">
              {ventaConfirmada.codigo} · {formatearSoles(ventaConfirmada.total)}
            </p>
            {ventaConfirmada.comprobante && (
              <p className="mt-2 text-xs text-amber">
                {ventaConfirmada.comprobante.tipo === 'FACTURA' ? 'Factura' : 'Boleta'} pedida: aún no se emite a SUNAT
                (falta conectar el proveedor).
              </p>
            )}
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
