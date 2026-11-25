import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  UserPlus,
  Eye,
  EyeOff,
  Search,
  CheckCheck,
  X,
  UserX,
  Pencil,
  Trash2,
  Cake,
  MessageCircle,
  Ticket,
  Percent,
  Gift,
  Coins,
  RotateCcw,
  Timer,
  Calendar,
  Clock,
  Globe,
  Palette,
  UserMinus,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  CalendarClock,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import {
  aLima,
  sumarDias,
  diaSemanaLima,
  aInputDatetimeLima,
  iniciarMesLima,
  anioMesEnLima,
} from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import { ETIQUETA_ROL } from '../lib/personal.js'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonCerrarModal from '../components/BotonCerrarModal.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalCita from '../components/ModalCita.jsx'
import ModalCliente from '../components/ModalCliente.jsx'
import { mensajeCumpleanos } from '../lib/saludoCumpleanos.js'
import { arrastraSesiones, etiquetaSesion, sesionesFuturasPendientes } from '../lib/sesionesCita.js'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'
import ModalColoresCitas from '../components/ModalColoresCitas.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import { colorDeCita, estiloTarjetaCita } from '../lib/coloresCitas.js'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'
import { useCitasSinComision, useServiciosConComision } from '../hooks/useServiciosConComision.js'
import { coincideBusquedaCita } from '../lib/busquedaCitas.js'
import { mensajeRecordatorioCita } from '../lib/recordatorioCita.js'
import { textoInasistencias } from '../lib/inasistencias.js'
import { useInasistenciasClienta } from '../hooks/useInasistenciasClienta.js'

const DIAS_CORTOS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const ESTADOS = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  COMPLETADA: { label: 'Completada', clase: 'border-green/50 bg-green/15 text-green' },
  CANCELADA: { label: 'Cancelada', clase: 'border-red/50 bg-red/15 text-red' },
  NO_ASISTIO: { label: 'No asistió', clase: 'border-red/50 bg-red/15 text-red' },
}

function claveDia(fecha) {
  const l = aLima(fecha)
  return `${l.getUTCFullYear()}-${l.getUTCMonth()}-${l.getUTCDate()}`
}

// Clave de cumpleaños: solo mes-día (sin año, porque se repite cada año).
function claveMesDia(mes, dia) {
  return `${mes}-${dia}`
}

// cumpleanos llega como "YYYY-MM-DD" (columna date, sin hora) — se parsea
// como texto en vez de con `new Date(...)` para no arrastrar ningún
// corrimiento de zona horaria.
function claveCumpleanos(cumpleanosIso) {
  const [, mesStr, diaStr] = cumpleanosIso.split('-')
  return claveMesDia(parseInt(mesStr, 10) - 1, parseInt(diaStr, 10))
}

function numeroWhatsapp(telefono) {
  const digitos = telefono.replace(/\D/g, '')
  return digitos.length === 9 ? `51${digitos}` : digitos
}

// Tarjeta con el mismo efecto de brillo en bucle que ya usa la tarjeta de
// punto de equilibrio en Dashboard (fondo con destello diagonal), en
// dorado en vez de rosa, para destacar al cliente que cumple años ese día
// — más un segundo brillo intercalado que ilumina solo el borde, a la
// mitad del hueco que deja el brillo principal. Al tocarla se despliegan
// acciones rápidas: WhatsApp funciona de verdad (si el cliente tiene
// teléfono); cupón/descuento/servicio gratis/puntos son solo una vista
// previa de cómo quedarían — todavía no hacen nada.
function TarjetaCumpleanos({ cliente }) {
  const [abierta, setAbierta] = useState(false)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setAbierta((anterior) => !anterior)}
      onKeyDown={manejarActivacionTeclado(() => setAbierta((anterior) => !anterior))}
      aria-expanded={abierta}
      className="relative isolate cursor-pointer overflow-hidden rounded-lg border border-amber/30 bg-surface p-3"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 w-1/2 animate-brillo-tarjeta"
        style={{
          backgroundImage: 'linear-gradient(100deg, transparent, rgba(245,166,35,0.18), transparent)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 rounded-lg border border-amber animate-brillo-borde-tarjeta" />

      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-amber">{cliente.nombre} 🎉</p>
        <Cake className="h-5 w-5 shrink-0 text-amber" />
      </div>

      <CampoColapsable abierto={abierta} margen>
        <div className="flex flex-wrap gap-2 pt-1">
          {cliente.telefono ? (
            <a
              href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}?text=${encodeURIComponent(mensajeCumpleanos(cliente.nombre))}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(evento) => evento.stopPropagation()}
              className="flex items-center gap-1.5 rounded-lg border border-green/50 bg-green/10 px-2.5 py-1.5 text-xs font-medium text-green"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          ) : (
            <span className="flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-ink/40">
              <MessageCircle className="h-3.5 w-3.5" /> Sin número
            </span>
          )}

          {/* Vista previa — todavía no implementados */}
          <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 text-xs text-ink/40">
            <Ticket className="h-3.5 w-3.5" /> Cupón
          </span>
          <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 text-xs text-ink/40">
            <Percent className="h-3.5 w-3.5" /> Descuento
          </span>
          <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 text-xs text-ink/40">
            <Gift className="h-3.5 w-3.5" /> Servicio gratis
          </span>
          <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 text-xs text-ink/40">
            <Coins className="h-3.5 w-3.5" /> Puntos
          </span>
        </div>
      </CampoColapsable>
    </div>
  )
}

function formatearHora(fechaIso) {
  const l = aLima(new Date(fechaIso))
  const h = l.getUTCHours()
  const m = String(l.getUTCMinutes()).padStart(2, '0')
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${h < 12 ? 'a.m.' : 'p.m.'}`
}

function formatearFechaCorta(fechaIso) {
  const l = aLima(new Date(fechaIso))
  return `${l.getUTCDate()} de ${MESES[l.getUTCMonth()]}`
}

const SELECT_CITAS =
  'id, cliente_id, cliente_nombre_referencia, asistente_id, creado_por, creado_por_cliente_web_id, ' +
  'fecha_hora, estado, nota, adelanto, adelanto_metodo, descuento, serie_id, sesion_numero, sesiones_total, estado_cambiado_por, estado_cambiado_web, ' +
  // telefono: botón de WhatsApp junto al nombre en el detalle de la cita (solo si la clienta tiene número).
  'clientes(nombre, telefono), asistentes(nombres_completos, usuario_id), ' +
  // registro_servicio_id: la atención de Mis atenciones nacida al completar la cita (para asignarle la clienta desde el detalle).
  'cita_servicios(id, servicio_id, registro_servicio_id, duracion_min, precio, servicios(nombre, precio))'

// Antes, sin asistente asignado, se mostraba el nombre de quien agendó la
// cita — pero eso hacía parecer que esa persona era la asistente (y el
// botón Completar solo aparece para quien de verdad está en asistente_id),
// una confusión reportada en pruebas reales. Ahora sin asistente_id se
// muestra "Asistente pendiente" siempre, sin importar quién la creó.
function nombreAsistenteDe(cita) {
  return cita.asistentes?.nombres_completos ?? 'Asistente pendiente'
}

// Cliente real (tabla clientes) o, si se usó "sin guardar", el nombre de
// referencia que se escribió a mano.
function nombreClienteDe(cita) {
  return cita.clientes?.nombre ?? cita.cliente_nombre_referencia ?? 'Cliente'
}

// "Corte, Tinte" o "Corte +2 más" si hay más de 2 — evita que el nombre
// de la fila del calendario/lista se desborde con citas de varios servicios.
function resumenServiciosDe(cita) {
  const nombres = (cita.cita_servicios ?? []).map((cs) => cs.servicios?.nombre ?? 'Servicio eliminado')
  if (nombres.length === 0) return 'Servicio'
  if (nombres.length <= 2) return nombres.join(', ')
  return `${nombres.slice(0, 2).join(', ')} +${nombres.length - 2} más`
}

function duracionTotalDe(cita) {
  return (cita.cita_servicios ?? []).reduce((total, cs) => total + (cs.duracion_min ?? 0), 0)
}

// Solo mientras la cita sigue activa (pendiente) — una cancelada
// o no-asistió sin asistente ya no necesita resolverse.
function tieneAsistentePendiente(cita) {
  return !cita.asistente_id && cita.estado === 'PENDIENTE'
}

// Cita agendada con la clienta solo como nombre de referencia (sin ficha en Clientes): la administradora debe registrarla
// (o asignar una existente) editando la cita. Una cancelada o «no asistió» ya no necesita resolverse.
function tieneClientaPendiente(cita) {
  return !cita.cliente_id && cita.estado !== 'CANCELADA' && cita.estado !== 'NO_ASISTIO'
}

function tieneAdelanto(cita) {
  return cita.adelanto != null && Number(cita.adelanto) > 0
}

// creado_por_cliente_web_id solo se llena cuando agendar_cita_web() (la
// Web) crea la cita — nunca lo pisa el POS (ModalCita.jsx no lo toca) —
// así que es el indicador confiable de "esto lo agendó el cliente solo".
function esCitaWeb(cita) {
  return Boolean(cita.creado_por_cliente_web_id)
}

// Mismo estilo que la cápsula "Cliente Web" de Clientes.jsx — misma idea,
// distinto lugar (acá va sobre CITAS, no sobre la ficha del cliente).
function CapsulaClienteWeb() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber/15 px-1.5 py-0.5 text-[10px] font-medium text-amber">
      <Globe className="h-2.5 w-2.5" />
      Cliente Web
    </span>
  )
}

// Avisa a quien ve la cita (sobre todo a la administradora) que la clienta aún no está registrada: falta crearla en Clientes o
// elegir una existente editando la cita. Rojo, como los demás avisos de «falta algo».
function CapsulaSinCliente() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
      <UserX className="h-2.5 w-2.5" />
      Sin cliente
    </span>
  )
}

// La cita sigue activa y no tiene asistente asignada (antes era un punto rojo en la esquina de la tarjeta): así no se puede completar
// hasta que alguien se la asigne. Misma forma que las demás cápsulas de la fila.
function CapsulaSinAsistente() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
      <UserMinus className="h-2.5 w-2.5" />
      Sin asistente
    </span>
  )
}

// Algún servicio de la cita no tiene % de comisión para su asistente (no se podrá completar sin anotarla como pendiente).
// Mismo tamaño y forma que las demás cápsulas de la fila.
function CapsulaSinComision() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
      <Percent className="h-2.5 w-2.5" />
      Sin comisión
    </span>
  )
}

// Diferencia a simple vista las citas con adelanto/abono ya dejado por el
// cliente — misma forma de cápsula que CapsulaClienteWeb, en verde.
// Cita que es una sesión de un tratamiento (migración 20261125000001): rosada, con «Sesión 2 de 3».
function CapsulaSesion({ cita }) {
  const etiqueta = etiquetaSesion(cita)
  if (!etiqueta) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pink-400/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-400">
      <CalendarClock className="h-2.5 w-2.5" />
      {etiqueta}
    </span>
  )
}

// Cita con descuento acordado (plata que no va a entrar; Ventas lo aplica solo al cobrar): cápsula roja, como el adelanto pero en rojo.
function tieneDescuento(cita) {
  return cita.descuento != null && Number(cita.descuento) > 0
}

function CapsulaDescuento() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
      <Percent className="h-2.5 w-2.5" />
      Descuento
    </span>
  )
}

function CapsulaAdelanto() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green/15 px-1.5 py-0.5 text-[10px] font-medium text-green">
      <Coins className="h-2.5 w-2.5" />
      Adelanto
    </span>
  )
}

export default function Citas({ activo = true }) {
  const { usuario, rol } = useAuth()
  const { mostrarToast } = useToast()

  const [fechaCursor, setFechaCursor] = useEstadoVista('/citas:fechaCursor', () => new Date())
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => new Date())
  const [asistentes, setAsistentes] = useState([])
  const [asistenteFiltro, setAsistenteFiltro] = useState('todas')
  const [nombresUsuarios, setNombresUsuarios] = useState(new Map())
  // Color de cada tarjeta según el rol de quien agendó (ver lib/coloresCitas.js).
  const [rolPorUsuario, setRolPorUsuario] = useState(new Map())
  const [coloresCitas, setColoresCitas] = useState({})
  const [modalColores, setModalColores] = useState(false)
  const [ocultarCanceladas, setOcultarCanceladas] = useState(true)
  const [clientesCumpleanos, setClientesCumpleanos] = useState([])
  const [citas, setCitas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [modalCita, setModalCita] = useState(null) // null | 'nuevo' | cita
  // «Agendar otra igual»: cita completada de la que se copian clienta, asistente y servicios para una cita nueva.
  const [citaPlantilla, setCitaPlantilla] = useState(null)
  const [citaSeleccionada, setCitaSeleccionada] = useState(null)
  const [citaACompletar, setCitaACompletar] = useState(null)
  const [citaAEliminar, setCitaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [citaAReactivar, setCitaAReactivar] = useState(null)
  const [citaACancelar, setCitaACancelar] = useState(null)
  // «No asistió» sobre la sesión 1 de un tratamiento: pide confirmar porque cancela las sesiones siguientes.
  const [citaANoAsistio, setCitaANoAsistio] = useState(null)
  const listaDiaRef = useRef(null)
  // Cita completada sin clienta registrada a la que la administradora está creando la ficha desde el detalle.
  const [citaAAsignarCliente, setCitaAAsignarCliente] = useState(null)
  const navigate = useNavigate()

  const [mesAbierto, setMesAbierto] = useState(false)
  // El botón vive dentro de un contenedor que anima su ancho para la
  // búsqueda expandible (overflow-x:hidden) — eso, por una regla del propio
  // CSS, fuerza overflow-y a "auto" también y recorta cualquier desplegable
  // que intente salirse verticalmente. Por eso el menú de meses se dibuja
  // en un portal (fuera de ese contenedor), posicionado a mano con las
  // coordenadas del botón.
  const [posicionMes, setPosicionMes] = useState(null)
  const botonMesRef = useRef(null)
  const [busquedaAbierta, setBusquedaAbierta] = useState(false)
  const [busquedaCitas, setBusquedaCitas] = useState('')
  // Resultados de la búsqueda: citas de una ventana de 3 meses (ver rangoBusqueda); null = aún sin cargar.
  const [citasBusqueda, setCitasBusqueda] = useState(null)

  const [filtroAbierto, setFiltroAbierto] = useState(false)
  const [posicionFiltro, setPosicionFiltro] = useState(null)
  const botonFiltroRef = useRef(null)

  const panelDetalleRef = useRef(null)
  const panelEliminarRef = useRef(null)
  const panelReactivarRef = useRef(null)
  const panelCancelarRef = useRef(null)
  const panelNoAsistioRef = useRef(null)
  const inputBusquedaRef = useRef(null)
  useCerrarConEscape(() => setCitaSeleccionada(null), Boolean(citaSeleccionada))
  useModalA11y(panelDetalleRef, Boolean(citaSeleccionada))
  useCerrarConEscape(() => setCitaAEliminar(null), Boolean(citaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(citaAEliminar))
  useCerrarConEscape(() => setCitaAReactivar(null), Boolean(citaAReactivar))
  useModalA11y(panelReactivarRef, Boolean(citaAReactivar))
  useCerrarConEscape(() => setCitaACancelar(null), Boolean(citaACancelar))
  useModalA11y(panelCancelarRef, Boolean(citaACancelar))
  useCerrarConEscape(() => setCitaANoAsistio(null), Boolean(citaANoAsistio))
  useModalA11y(panelNoAsistioRef, Boolean(citaANoAsistio))
  useCerrarConEscape(() => setMesAbierto(false), mesAbierto, { trabajoPendiente: false })
  useCerrarConEscape(() => setFiltroAbierto(false), filtroAbierto, { trabajoPendiente: false })

  function alternarMes() {
    if (mesAbierto) {
      setMesAbierto(false)
      return
    }
    const rect = botonMesRef.current?.getBoundingClientRect()
    if (rect) setPosicionMes({ top: rect.bottom + 4, left: rect.left })
    setMesAbierto(true)
  }

  function seleccionarMes(indiceMes) {
    setFechaCursor(iniciarMesLima(anioCursor, indiceMes))
    setDiaSeleccionado(null)
    setMesAbierto(false)
  }

  function alternarFiltro() {
    if (filtroAbierto) {
      setFiltroAbierto(false)
      return
    }
    const rect = botonFiltroRef.current?.getBoundingClientRect()
    if (rect) setPosicionFiltro({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setFiltroAbierto(true)
  }

  function seleccionarFiltro(valor) {
    setAsistenteFiltro(valor)
    setFiltroAbierto(false)
  }

  // En móvil el input se monta al abrir la búsqueda; en PC está siempre
  // montado, así que el foco se pide aquí en vez de con autoFocus.
  useEffect(() => {
    if (busquedaAbierta) inputBusquedaRef.current?.focus()
  }, [busquedaAbierta])

  function cerrarBusqueda() {
    setBusquedaAbierta(false)
    setBusquedaCitas('')
  }

  function irMesAnterior() {
    setFechaCursor(iniciarMesLima(anioCursor, mesCursor - 1))
    setDiaSeleccionado(null)
  }

  function irMesSiguiente() {
    setFechaCursor(iniciarMesLima(anioCursor, mesCursor + 1))
    setDiaSeleccionado(null)
  }

  // Deslizar la grilla mensual para pasar de mes — solo con el dedo (no con
  // mouse, que ya tiene el selector de mes). Izquierda→derecha retrocede un
  // mes, derecha→izquierda avanza uno. touch-pan-y en el contenedor deja el
  // scroll vertical de la página intacto, pero un gesto diagonal (como el
  // que se hace al scrollear) igual dispara un deltaX grande — por eso acá
  // además se exige que el movimiento sea más horizontal que vertical antes
  // de cambiar de mes (mismo patrón base que el swipe-to-delete del carrito
  // de Ventas, con el chequeo de dominancia agregado).
  const UMBRAL_SWIPE_MES = 50
  const inicioSwipeMesRef = useRef({ x: 0, y: 0, activo: false })

  function manejarSwipeMesInicio(evento) {
    if (evento.pointerType !== 'touch') return
    inicioSwipeMesRef.current = { x: evento.clientX, y: evento.clientY, activo: true }
  }

  function manejarSwipeMesFin(evento) {
    if (!inicioSwipeMesRef.current.activo) return
    inicioSwipeMesRef.current.activo = false
    const deltaX = evento.clientX - inicioSwipeMesRef.current.x
    const deltaY = evento.clientY - inicioSwipeMesRef.current.y
    if (Math.abs(deltaX) < UMBRAL_SWIPE_MES) return
    if (Math.abs(deltaX) < Math.abs(deltaY)) return
    if (deltaX > 0) irMesAnterior()
    else irMesSiguiente()
  }

  // Rango del mes visible (para traer todas las citas del mes de una vez,
  // sin importar qué día esté seleccionado abajo).
  const { anio: anioCursor, mes: mesCursor } = anioMesEnLima(fechaCursor)
  const rango = useMemo(() => {
    const desde = iniciarMesLima(anioCursor, mesCursor)
    const hasta = iniciarMesLima(anioCursor, mesCursor + 1)
    return { desde, hasta }
  }, [anioCursor, mesCursor])

  // Búsqueda: solo dentro de una ventana de 3 meses alrededor del mes ACTUAL (el de hoy, no el que se está viendo): un mes antes,
  // el actual y un mes después, para que la vista no se vuelva lenta. Se descarga UNA vez al empezar a escribir (no por cada
  // tecla) y se filtra en el navegador; navegar por el calendario no la cambia.
  const { anio: anioVentana, mes: mesVentana } = anioMesEnLima(new Date())
  const rangoBusqueda = useMemo(
    () => ({ desde: iniciarMesLima(anioVentana, mesVentana - 1), hasta: iniciarMesLima(anioVentana, mesVentana + 2) }),
    [anioVentana, mesVentana],
  )
  const hayBusqueda = busquedaCitas.trim() !== ''
  // Recarga silenciosa de la búsqueda abierta (la usan el tiempo real y las acciones que ya recargan el mes).
  const refrescarBusquedaRef = useRef(() => {})

  async function cargarCitasBusqueda(vigente) {
    let consulta = supabase
      .from('citas')
      .select(SELECT_CITAS)
      .gte('fecha_hora', rangoBusqueda.desde.toISOString())
      .lt('fecha_hora', rangoBusqueda.hasta.toISOString())
      .order('fecha_hora')
    if (asistenteFiltro !== 'todas') consulta = consulta.eq('asistente_id', asistenteFiltro)
    const { data, error: errorBusqueda } = await consulta
    if (!vigente.actual) return
    if (errorBusqueda) {
      mostrarToast('No se pudo buscar en las citas.', 'error')
      setCitasBusqueda([])
    } else {
      setCitasBusqueda(data ?? [])
    }
  }
  refrescarBusquedaRef.current = () => {
    if (hayBusqueda) cargarCitasBusqueda({ actual: true })
  }

  useEffect(() => {
    if (!hayBusqueda) {
      setCitasBusqueda(null)
      return undefined
    }
    if (!activo) return undefined
    const vigente = { actual: true }
    cargarCitasBusqueda(vigente)
    return () => {
      vigente.actual = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, hayBusqueda, rangoBusqueda.desde.getTime(), asistenteFiltro])

  // Celdas de la grilla: empieza en el domingo de la semana del día 1, y
  // se extiende en múltiplos de 7 hasta cubrir el mes completo (mismo
  // criterio que cualquier calendario mensual estándar).
  const diasGrilla = useMemo(() => {
    const primerDiaMes = rango.desde
    const diaSemanaPrimerDia = diaSemanaLima(primerDiaMes)
    const inicioGrilla = sumarDias(primerDiaMes, -diaSemanaPrimerDia)
    const diasHastaFinMes = Math.round((rango.hasta.getTime() - inicioGrilla.getTime()) / 86400000)
    const totalCeldas = Math.ceil(diasHastaFinMes / 7) * 7
    return Array.from({ length: totalCeldas }, (_, i) => sumarDias(inicioGrilla, i))
  }, [rango])

  useEffect(() => {
    supabase
      .from('asistentes')
      .select('id, nombres_completos')
      .eq('activo', true)
      .order('nombres_completos')
      .then(({ data }) => setAsistentes(data ?? []))
  }, [])

  // Nombre de quien agendó cada cita ("Agendado por") y respaldo de
  // "Asistente" cuando no hay asistente_id — el embed usuarios(...) de
  // PostgREST respeta la RLS de usuarios (solo la propia cuenta o un admin
  // puede leer la fila de otra persona), así que cualquier otro rol veía
  // ese nombre vacío. Se resuelve aparte con una función security definer
  // que solo expone id + nombre_completo.
  useEffect(() => {
    supabase
      .rpc('usuarios_para_citas')
      .then(({ data }) => setNombresUsuarios(new Map((data ?? []).map((u) => [u.id, u.nombre_completo]))))
  }, [])

  // Si alguna de las dos falla, las tarjetas simplemente quedan sin color (como antes): no bloquea la agenda.
  useEffect(() => {
    supabase
      .rpc('autores_citas_rol')
      .then(({ data }) => setRolPorUsuario(new Map((data ?? []).map((u) => [u.id, u.rol]))))
    supabase
      .from('colores_citas_rol')
      .select('clave, color')
      .then(({ data }) => setColoresCitas(Object.fromEntries((data ?? []).map((c) => [c.clave, c.color]))))
  }, [])

  // Cumpleaños: se cargan una sola vez (no dependen del mes que se esté
  // viendo — el mismo listado sirve para calcular en qué día cae cada uno
  // sin importar a qué mes se navegue).
  useEffect(() => {
    supabase
      .from('clientes')
      .select('id, nombre, telefono, cumpleanos')
      .not('cumpleanos', 'is', null)
      .then(({ data }) => setClientesCumpleanos(data ?? []))
  }, [])

  const cumpleanosPorDia = useMemo(() => {
    const mapa = new Map()
    for (const cliente of clientesCumpleanos) {
      const clave = claveCumpleanos(cliente.cumpleanos)
      if (!mapa.has(clave)) mapa.set(clave, [])
      mapa.get(clave).push(cliente)
    }
    return mapa
  }, [clientesCumpleanos])

  // silencioso: recarga en segundo plano SIN desmontar la grilla — el
  // "Cargando..." de pantalla completa solo aparece en la primera carga.
  // Antes, cada acción (cambiar estado, eliminar, guardar) ponía
  // cargando=true y toda la vista parpadeaba; ahora las acciones actualizan
  // el estado local y las recargas reales entran en silencio.
  // `vigente` descarta respuestas tardías de un mes/filtro que ya no está
  // activo (mismo guard que Historial/Mis atenciones).
  async function cargarCitas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    let consulta = supabase
      .from('citas')
      .select(SELECT_CITAS)
      .gte('fecha_hora', rango.desde.toISOString())
      .lt('fecha_hora', rango.hasta.toISOString())
      .order('fecha_hora')

    if (asistenteFiltro !== 'todas') {
      consulta = consulta.eq('asistente_id', asistenteFiltro)
    }

    const { data, error: errorConsulta } = await consulta

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudieron cargar las citas.')
    } else {
      setError(null)
      setCitas(data ?? [])
    }
    setCargando(false)
  }

  const primeraCargaHecha = useRef(false)
  const vigenteRef = useRef({ actual: true })

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    // Al volver a la pestaña (o cambiar mes/filtro con datos ya en
    // pantalla) se recarga en silencio: la grilla queda visible y las
    // celdas solo actualizan sus puntos cuando llegan los datos nuevos.
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarCitas(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, rango.desde.getTime(), rango.hasta.getTime(), asistenteFiltro, rol])

  // Tiempo real: cualquier cambio en citas (agendada, editada, cancelada,
  // completada, eliminada — desde este dispositivo o cualquier otro) dispara
  // una recarga silenciosa, igual que al volver a la pestaña. No hace falta
  // mirar el payload del evento: cargarCitas ya trae los datos completos
  // (con los joins) y vigenteRef descarta la respuesta si mientras tanto se
  // cambió de mes/filtro.
  useEffect(() => {
    if (!activo) return undefined

    const canal = supabase
      .channel('citas-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'citas' },
        () => {
          cargarCitas(vigenteRef.current, true)
          refrescarBusquedaRef.current()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, rango.desde.getTime(), rango.hasta.getTime(), asistenteFiltro, rol])

  function irHoy() {
    const hoy = new Date()
    setFechaCursor(hoy)
    setDiaSeleccionado(hoy)
  }

  // Evita doble disparo si se toca dos veces rápido la misma acción antes
  // de que el servidor responda (los botones no tienen estado "guardando").
  const cambiandoEstadoRef = useRef(false)

  async function cambiarEstado(cita, nuevoEstado) {
    if (cambiandoEstadoRef.current) return
    cambiandoEstadoRef.current = true

    const { error: errorCambio } = await supabase
      .from('citas')
      .update({ estado: nuevoEstado })
      .eq('id', cita.id)

    cambiandoEstadoRef.current = false

    if (errorCambio) {
      mostrarToast('No se pudo actualizar la cita.', 'error')
      return
    }

    const mensajes = {
      CANCELADA: 'Cita cancelada.',
      NO_ASISTIO: 'Cita marcada como no asistió.',
      PENDIENTE: 'Cita reactivada.',
    }
    mostrarToast(mensajes[nuevoEstado] ?? 'Cita actualizada.', 'info')
    setCitaSeleccionada(null)
    // El servidor solo cambió `estado` de UNA fila — se refleja igual en el
    // array local, sin refetch del mes completo (que hacía parpadear toda
    // la pantalla). El resto de los datos de la cita no cambió.
    // Quién hizo el cambio lo guarda el servidor (trigger); aquí se refleja lo mismo para que el detalle lo muestre sin recargar.
    const registraAutor = nuevoEstado === 'CANCELADA' || nuevoEstado === 'NO_ASISTIO'
    const aplicarEstado = (anteriores) =>
      anteriores.map((c) =>
        c.id === cita.id
          ? { ...c, estado: nuevoEstado, estado_cambiado_por: registraAutor ? usuario?.id ?? null : null, estado_cambiado_web: false }
          : c,
      )
    setCitas(aplicarEstado)
    setCitasBusqueda((anteriores) => (anteriores ? aplicarEstado(anteriores) : anteriores))
    // Cancelar, marcar «no asistió» o reactivar la 1.ª sesión de un tratamiento arrastra a las demás en el servidor: se recarga para verlas igual.
    if (arrastraSesiones(cita)) {
      cargarCitas(vigenteRef.current, true)
      refrescarBusquedaRef.current()
    }
  }

  async function confirmarReactivar() {
    if (!citaAReactivar) return
    setCitaAReactivar(null)
    await cambiarEstado(citaAReactivar, 'PENDIENTE')
  }

  async function confirmarNoAsistio() {
    if (!citaANoAsistio) return
    setCitaANoAsistio(null)
    await cambiarEstado(citaANoAsistio, 'NO_ASISTIO')
  }

  async function confirmarCancelar() {
    if (!citaACancelar) return
    setCitaACancelar(null)
    await cambiarEstado(citaACancelar, 'CANCELADA')
  }

  async function confirmarEliminar() {
    if (!citaAEliminar) return
    setEliminando(true)
    const { error: errorEliminar } = await supabase.from('citas').delete().eq('id', citaAEliminar.id)
    setEliminando(false)
    setCitaAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la cita.', 'error')
      return
    }
    mostrarToast('Cita eliminada.', 'exito')
    setCitaSeleccionada(null)
    // Se saca del array local — sin refetch del mes (misma razón que en
    // cambiarEstado: el servidor no tiene nada más que contarnos).
    setCitas((anteriores) => anteriores.filter((c) => c.id !== citaAEliminar.id))
    setCitasBusqueda((anteriores) => (anteriores ? anteriores.filter((c) => c.id !== citaAEliminar.id) : anteriores))
  }

  // La consulta ya viene con .order('fecha_hora') y el agrupado preserva
  // ese orden — por eso ni la lista del día ni la búsqueda vuelven a
  // ordenar (antes hacían .slice().sort() con new Date() por ítem en cada
  // render, trabajo repetido para llegar al mismo orden).
  const citasVisibles = useMemo(
    () => (ocultarCanceladas ? citas.filter((c) => c.estado !== 'CANCELADA') : citas),
    [citas, ocultarCanceladas],
  )

  const citasPorDia = useMemo(() => {
    const mapa = new Map()
    for (const cita of citasVisibles) {
      const clave = claveDia(new Date(cita.fecha_hora))
      if (!mapa.has(clave)) mapa.set(clave, [])
      mapa.get(clave).push(cita)
    }
    return mapa
  }, [citasVisibles])

  // Una sola vez por render, no por cada una de las ~35 celdas de la grilla.
  const claveHoy = claveDia(new Date())
  const claveSeleccionada = diaSeleccionado ? claveDia(diaSeleccionado) : null
  const { anio: anioHoy, mes: mesHoy } = anioMesEnLima(new Date())
  const esMesActual = anioCursor === anioHoy && mesCursor === mesHoy

  const citasDelDiaSeleccionado = diaSeleccionado
    ? (citasPorDia.get(claveDia(diaSeleccionado)) ?? [])
    : []

  // Sesiones de tratamientos del mes visible (franja rosada) y «Ver cita»: selecciona el día de esa sesión.
  const sesionesDelMes = useMemo(() => sesionesFuturasPendientes(citasVisibles), [citasVisibles])
  function verDiaDeCita(cita) {
    const clave = claveDia(new Date(cita.fecha_hora))
    const dia = diasGrilla.find((d) => claveDia(d) === clave)
    if (!dia) return
    setDiaSeleccionado(dia)
    // En móvil la lista del día queda debajo del calendario: se baja hasta ella.
    requestAnimationFrame(() => listaDiaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  const cumpleanosDelDiaSeleccionado = diaSeleccionado
    ? (cumpleanosPorDia.get(claveMesDia(aLima(diaSeleccionado).getUTCMonth(), aLima(diaSeleccionado).getUTCDate())) ?? [])
    : []

  // Busca solo dentro de las citas ya cargadas del mes visible (sin ida
  // extra al servidor) — por nombre de cliente o de servicio.
  const citasFiltradas = citasBusqueda
    ? citasBusqueda.filter(
        (cita) => (!ocultarCanceladas || cita.estado !== 'CANCELADA') && coincideBusquedaCita(cita, busquedaCitas),
      )
    : []
  // «octubre 2026 a diciembre 2026»: lo que realmente se está buscando.
  const textoVentanaBusqueda = (() => {
    const d1 = aLima(rangoBusqueda.desde)
    const d2 = aLima(new Date(rangoBusqueda.hasta.getTime() - 1))
    return `${MESES[d1.getUTCMonth()]} ${d1.getUTCFullYear()} a ${MESES[d2.getUTCMonth()]} ${d2.getUTCFullYear()}`
  })()

  // Tarjetas: cápsula «Sin comisión» mientras la comisión de la cita siga sin resolverse. El servidor (citas_sin_comision) decide:
  // citas pendientes/confirmadas con algún servicio sin % para su asistente y citas COMPLETADAS cuya atención sigue como nota
  // pendiente. Se apaga sola cuando la administradora asigna el % en Comisiones o la nota se confirma; una cancelada o «no
  // asistió» no se marca nunca.
  const idsCitasSinComision = useCitasSinComision(citas)
  const citaSinComision = (cita) =>
    (cita.estado === 'PENDIENTE' || cita.estado === 'COMPLETADA') &&
    idsCitasSinComision.has(cita.id)

  // Detalle de la cita: qué servicios concretos no tienen comisión para su asistente (el aviso «Sin comisión» junto al nombre).
  // Solo si la cita está entre las marcadas arriba, así una completada con todo resuelto no se vuelve a juzgar. Al cerrar el
  // detalle el id vuelve a null y al reabrirlo se consulta de nuevo (por si la administradora asignó el % mientras tanto).
  const serviciosConComisionDetalle = useServiciosConComision(
    citaSeleccionada && citaSinComision(citaSeleccionada) ? citaSeleccionada.asistente_id : null,
  )

  // Atajos de la administradora en el detalle de una cita COMPLETADA, que ya no se puede editar: ahí se resuelve lo que quedó
  // pendiente al completarla. «Cliente»: crear la ficha de la clienta (con el nombre de la cita y su nota como guía) y asignarla;
  // «Porcentaje»: ir a Comisiones con el servicio sin % abierto y el campo destrabado (igual que desde el carrito de la cita).
  const esAdmin = rol === 'ADMINISTRADOR'
  // «Cancelada por: Claudia Sanchez (Administrador)» — nombre y rol de quien cambió el estado, o la clienta si fue desde la web.
  const quienCambioEstado = (() => {
    if (!citaSeleccionada || (citaSeleccionada.estado !== 'CANCELADA' && citaSeleccionada.estado !== 'NO_ASISTIO')) return null
    if (citaSeleccionada.estado_cambiado_web) return 'la clienta (desde la web)'
    const autorId = citaSeleccionada.estado_cambiado_por
    if (!autorId) return null
    const nombre = nombresUsuarios.get(autorId) ?? 'Personal que ya no está activo'
    const etiquetaRol = ETIQUETA_ROL[rolPorUsuario.get(autorId)]
    return etiquetaRol ? `${nombre} (${etiquetaRol})` : nombre
  })()
  // Cita pendiente: el botón de WhatsApp abre el chat con el recordatorio ya escrito (pide confirmar la asistencia); la persona del
  // salón solo lo revisa y lo envía.
  const enlaceRecordatorio =
    citaSeleccionada?.estado === 'PENDIENTE'
      ? `?text=${encodeURIComponent(
          mensajeRecordatorioCita({
            nombreClienta: citaSeleccionada.clientes?.nombre,
            fechaHoraIso: citaSeleccionada.fecha_hora,
            servicios: resumenServiciosDe(citaSeleccionada),
          }),
        )}`
      : ''
  // Cita pendiente de una clienta registrada: cuántas citas anteriores suyas quedaron en «No asistió» (sin contar esta).
  const inasistenciasDetalle = useInasistenciasClienta(
    citaSeleccionada?.estado === 'PENDIENTE' ? citaSeleccionada.cliente_id : null,
    citaSeleccionada?.id ?? null,
  )
  const avisoInasistencias = textoInasistencias(inasistenciasDetalle, { conAdelanto: tieneAdelanto(citaSeleccionada ?? {}) })
  const detalleCompletada = citaSeleccionada?.estado === 'COMPLETADA'
  const puedeAsignarClienteDetalle = esAdmin && detalleCompletada && tieneClientaPendiente(citaSeleccionada)
  const servicioSinComisionDetalle = (citaSeleccionada?.cita_servicios ?? []).find(
    (cs) => cs.servicio_id && serviciosConComisionDetalle && !serviciosConComisionDetalle.has(cs.servicio_id),
  )
  const puedeAsignarComisionDetalle =
    esAdmin && detalleCompletada && citaSinComision(citaSeleccionada) && Boolean(servicioSinComisionDetalle)

  function irAAsignarComisionDeCita() {
    if (!servicioSinComisionDetalle) return
    navigate('/porcentajes', {
      state: {
        asignarPorcentaje: {
          servicioId: servicioSinComisionDetalle.servicio_id,
          servicioNombre: servicioSinComisionDetalle.servicios?.nombre ?? '',
          asistenteId: citaSeleccionada.asistente_id,
          token: Date.now(),
        },
      },
    })
  }

  // Asigna la clienta recién creada a la cita completada. Si la cita tiene su atención en Mis atenciones (nota pendiente) se usa el RPC,
  // que corrige la atención y la cita juntas; si no la tiene (cita completada antes de existir ese vínculo, o su atención se
  // borró) se corrige solo la cita.
  async function asignarClienteACita(cita, clienteCreado) {
    if (!clienteCreado?.id) return
    const registroId = (cita.cita_servicios ?? []).map((cs) => cs.registro_servicio_id).find(Boolean)
    const { error: errorAsignar } = registroId
      ? await supabase.rpc('asignar_cliente_atencion_pendiente', { p_registro_id: registroId, p_cliente_id: clienteCreado.id })
      : await supabase.from('citas').update({ cliente_id: clienteCreado.id, cliente_nombre_referencia: null }).eq('id', cita.id)
    setCitaAAsignarCliente(null)
    if (errorAsignar) {
      mostrarToast(errorAsignar.message || 'No se pudo asignar la clienta a la cita.', 'error')
      return
    }
    setCitaSeleccionada(null)
    mostrarToast(`Clienta registrada y asignada: ${clienteCreado.nombre}.`, 'exito')
    cargarCitas(vigenteRef.current, true)
    refrescarBusquedaRef.current()
  }

  const tituloRango = `${MESES[mesCursor]} ${anioCursor}`
  const nombreFiltroActual =
    asistenteFiltro === 'todas'
      ? 'Todas'
      : (asistentes.find((a) => a.id === asistenteFiltro)?.nombres_completos ?? 'Todas')

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <div
          className={`grid overflow-x-hidden transition-[grid-template-columns] duration-300 ease-in-out ${
            busquedaAbierta ? 'max-lg:grid-cols-[0fr] grid-cols-[1fr]' : 'grid-cols-[1fr]'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2 overflow-x-hidden">
            <div className="relative flex min-w-0 flex-1 items-center">
              {/* Solo PC: mes anterior / siguiente (en el celular se desliza con el dedo). El selector de meses solo cambia de mes
                  dentro del mismo año; estas flechas son la forma de pasar de año. */}
              <button
                type="button"
                onClick={irMesAnterior}
                aria-label="Mes anterior"
                title="Mes anterior"
                className="hidden shrink-0 rounded-lg p-1.5 text-ink/60 transition-colors hover:bg-surface-2 hover:text-purple-300 lg:block"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                ref={botonMesRef}
                type="button"
                onClick={alternarMes}
                aria-expanded={mesAbierto}
                className="flex w-full items-center gap-1 truncate rounded-lg px-2 py-1.5 text-sm font-medium capitalize text-ink hover:bg-surface-2 lg:w-auto lg:min-w-0 lg:shrink"
              >
                <span className="truncate">{tituloRango}</span>
                <IconoFlechaDesplegable
                  className={`h-3 w-3 shrink-0 text-ink/50 transition-transform duration-300 ${
                    mesAbierto ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {mesAbierto &&
                posicionMes &&
                createPortal(
                  // Mismo fondo oscuro que el resto de los modales — tocar
                  // fuera de la lista (en cualquier parte de esa capa) la
                  // cierra, sin depender de blur (que no dispara al tocar
                  // algo no enfocable, como un texto o el fondo suelto).
                  <div
                    className="fixed inset-0 z-30 bg-black/60"
                    onClick={() => setMesAbierto(false)}
                  >
                    <div
                      onClick={(evento) => evento.stopPropagation()}
                      className="animate-entrada-dropdown fixed w-40 rounded-lg border border-border bg-surface-2 shadow-lg"
                      style={{ top: posicionMes.top, left: posicionMes.left }}
                    >
                      {MESES.map((nombreMes, indice) => (
                        <button
                          key={nombreMes}
                          type="button"
                          onClick={() => seleccionarMes(indice)}
                          className={`block w-full px-3 py-2 text-left text-sm capitalize transition-colors ${
                            indice === mesCursor
                              ? 'bg-purple-300/15 text-purple-300'
                              : 'text-ink hover:bg-surface-3'
                          }`}
                        >
                          {nombreMes}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body,
                )}
              <button
                type="button"
                onClick={irMesSiguiente}
                aria-label="Mes siguiente"
                title="Mes siguiente"
                className="hidden shrink-0 rounded-lg p-1.5 text-ink/60 transition-colors hover:bg-surface-2 hover:text-purple-300 lg:block"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setOcultarCanceladas((anterior) => !anterior)}
              aria-label={ocultarCanceladas ? 'Mostrar canceladas' : 'Ocultar canceladas'}
              title={ocultarCanceladas ? 'Mostrar canceladas' : 'Ocultar canceladas'}
              className={`shrink-0 p-1.5 transition-colors ${
                ocultarCanceladas ? 'text-red' : 'text-ink/40 hover:text-purple-300'
              }`}
            >
              {ocultarCanceladas ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>

            {rol === 'ADMINISTRADOR' && (
              <button
                type="button"
                onClick={() => setModalColores(true)}
                aria-label="Colores de las citas"
                title="Colores de las citas"
                className="shrink-0 p-1.5 text-ink/40 transition-colors hover:text-purple-300"
              >
                <Palette className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={irHoy}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                esMesActual
                  ? 'border-purple-300 bg-purple-300/15 text-purple-300'
                  : 'border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300'
              }`}
            >
              Hoy
            </button>

            <div className="relative shrink-0">
              <button
                ref={botonFiltroRef}
                type="button"
                onClick={alternarFiltro}
                aria-expanded={filtroAbierto}
                className="flex max-w-28 items-center gap-1 truncate rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-purple-300"
              >
                <span className="truncate">{nombreFiltroActual}</span>
                <IconoFlechaDesplegable
                  className={`h-3 w-3 shrink-0 text-ink/50 transition-transform duration-300 ${
                    filtroAbierto ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {filtroAbierto &&
                posicionFiltro &&
                createPortal(
                  <div
                    className="fixed inset-0 z-30 bg-black/60"
                    onClick={() => setFiltroAbierto(false)}
                  >
                    <div
                      onClick={(evento) => evento.stopPropagation()}
                      className="animate-entrada-dropdown fixed max-h-64 w-48 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg"
                      style={{ top: posicionFiltro.top, right: posicionFiltro.right }}
                    >
                      <button
                        type="button"
                        onClick={() => seleccionarFiltro('todas')}
                        className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                          asistenteFiltro === 'todas'
                            ? 'bg-purple-300/15 text-purple-300'
                            : 'text-ink hover:bg-surface-3'
                        }`}
                      >
                        Todas
                      </button>
                      {asistentes.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => seleccionarFiltro(a.id)}
                          className={`block w-full truncate px-3 py-2 text-left text-sm transition-colors ${
                            asistenteFiltro === a.id
                              ? 'bg-purple-300/15 text-purple-300'
                              : 'text-ink hover:bg-surface-3'
                          }`}
                        >
                          {a.nombres_completos}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body,
                )}
            </div>

            <button
              type="button"
              onClick={() => setModalCita('nuevo')}
              className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2 text-sm font-semibold text-bg lg:flex"
            >
              Nueva cita
            </button>
          </div>
        </div>

        <div
          className={`flex min-w-0 items-center transition-[flex-grow] duration-300 ease-in-out lg:flex-1 ${
            busquedaAbierta ? 'flex-1' : 'shrink-0'
          }`}
        >
          {/* En PC la barra está siempre desplegada hasta el borde derecho;
              en móvil sigue siendo un ícono que se expande al tocarlo. */}
          <div className={`w-full items-center gap-1 ${busquedaAbierta ? 'flex' : 'hidden lg:flex'}`}>
              <div className="relative w-full">
              <input
                ref={inputBusquedaRef}
                type="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                value={busquedaCitas}
                onChange={(evento) => setBusquedaCitas(evento.target.value)}
                placeholder="Buscar cliente, teléfono, servicio..."
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300 lg:pr-9"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-ink/50 lg:block" />
              </div>
              <button
                type="button"
                onClick={cerrarBusqueda}
                aria-label="Cerrar búsqueda"
                className="shrink-0 rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300 lg:hidden"
              >
                <X className="h-4 w-4" />
              </button>
          </div>
          {!busquedaAbierta && (
            <button
              type="button"
              onClick={() => setBusquedaAbierta(true)}
              aria-label="Buscar citas"
              className="shrink-0 rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300 lg:hidden"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-8 text-center font-mono text-sm text-ink/60">Cargando...</p>
      ) : busquedaCitas.trim() ? (
        <div className="mt-4 space-y-2">
          <p className="px-0.5 text-xs text-ink/50">
            Buscando entre {textoVentanaBusqueda} (un mes antes y uno después del mes actual)
            {citasBusqueda && ` · ${citasFiltradas.length} ${citasFiltradas.length === 1 ? 'resultado' : 'resultados'}`}
          </p>
          {!citasBusqueda ? (
            <p className="py-6 text-center font-mono text-sm text-ink/60">Buscando...</p>
          ) : citasFiltradas.length === 0 ? (
            <EstadoVacio
              icono={CalendarClock}
              mensaje="No hay citas que coincidan en esas fechas."
              tema="purple-300"
            />
          ) : (
            citasFiltradas.map((cita) => {
                const estado = ESTADOS[cita.estado] ?? ESTADOS.PENDIENTE
                const l = aLima(new Date(cita.fecha_hora))
                return (
                  <button
                    key={cita.id}
                    type="button"
                    onClick={() => setCitaSeleccionada(cita)}
                    style={estiloTarjetaCita(colorDeCita(cita, rolPorUsuario, coloresCitas))}
                    className="relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                  >
                    {(cita.cita_servicios?.length ?? 0) > 1 && (
                      <span className="absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-blue">
                        {cita.cita_servicios.length}
                      </span>
                    )}
                    <p className="truncate text-sm text-ink">
                      {nombreClienteDe(cita)} · {resumenServiciosDe(cita)}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-[14px] ${estado.clase}`}
                    >
                      {estado.label}
                    </span>
                    <p className="col-span-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink/60">
                      {l.getUTCDate()} de {MESES[l.getUTCMonth()]} · {formatearHora(cita.fecha_hora)}
                      {esCitaWeb(cita) && <CapsulaClienteWeb />}
                      {tieneAsistentePendiente(cita) && <CapsulaSinAsistente />}
                      <CapsulaSesion cita={cita} />
                      {tieneAdelanto(cita) && <CapsulaAdelanto />}
                      {tieneDescuento(cita) && <CapsulaDescuento />}
                      {tieneClientaPendiente(cita) && <CapsulaSinCliente />}
                      {citaSinComision(cita) && <CapsulaSinComision />}
                    </p>
                  </button>
                )
              })
          )}
        </div>
      ) : (
        <>
          {/* Sesiones de tratamientos (la 1 incluida) que caen en este mes: una línea por sesión, para no tener que ir día por día. «Ver cita» abre el
              día (no se pueden abrir dos días a la vez, por eso cada sesión tiene su propia línea). */}
          {sesionesDelMes.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {sesionesDelMes.map((cita) => {
                const l = aLima(new Date(cita.fecha_hora))
                return (
                  <button
                    key={cita.id}
                    type="button"
                    onClick={() => verDiaDeCita(cita)}
                    className="flex w-full items-center gap-2 rounded-lg border border-pink-400/30 bg-pink-400/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-pink-400"
                  >
                    <CalendarClock className="h-4 w-4 shrink-0 text-pink-400" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-pink-400">{etiquetaSesion(cita)}</span>
                      {' · '}
                      {nombreClienteDe(cita)} · {resumenServiciosDe(cita)}
                      <span className="block font-mono text-[11px] text-ink/60">
                        {l.getUTCDate()} de {MESES[l.getUTCMonth()]} · {formatearHora(cita.fecha_hora)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium text-pink-400 underline-offset-2">Ver cita</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* lg: calendario y lista del día lado a lado (patrón de agenda de
              escritorio) — en móvil sigue apilado, sin cambios. */}
          <div className="lg:flex lg:items-start lg:gap-4">
          {/* Grilla mensual — deslizable con el dedo para pasar de mes */}
          <div
            className="mt-4 touch-pan-y lg:w-[380px] lg:shrink-0"
            onPointerDown={manejarSwipeMesInicio}
            onPointerUp={manejarSwipeMesFin}
            onPointerCancel={manejarSwipeMesFin}
          >
            <div className="grid grid-cols-7 gap-1 text-center">
              {DIAS_CORTOS.map((d) => (
                <p key={d} className="py-1 text-[11px] font-medium uppercase tracking-wide text-ink/50">
                  {d}
                </p>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {diasGrilla.map((dia) => {
                const enLima = aLima(dia)
                const clave = claveDia(dia)
                const enMesActual = enLima.getUTCMonth() === mesCursor
                const esHoy = clave === claveHoy
                const esSeleccionado = clave === claveSeleccionada
                const citasDia = citasPorDia.get(clave) ?? []
                const cumpleanosDia = enMesActual
                  ? (cumpleanosPorDia.get(claveMesDia(enLima.getUTCMonth(), enLima.getUTCDate())) ?? [])
                  : []
                // Verde = ya no hay nada pendiente ese día (todo completado,
                // cancelado o no asistido); azul = todavía hay una cita
                // pendiente por atender.
                const hayPendientes = citasDia.some((c) => c.estado === 'PENDIENTE')
                // Punto rojo en la esquina = el día tiene algo por resolver (una cita sin asistente o sin clienta registrada).
                const hayPorResolver = citasDia.some((c) => tieneAsistentePendiente(c) || tieneClientaPendiente(c))

                return (
                  <button
                    key={clave}
                    type="button"
                    disabled={!enMesActual}
                    onClick={() => setDiaSeleccionado(dia)}
                    className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border text-sm transition-colors ${
                      !enMesActual
                        ? 'cursor-default border-transparent text-ink/20'
                        : esSeleccionado
                          ? 'border-purple-300 bg-purple-300/15 font-semibold text-purple-300'
                          : esHoy
                            ? 'border-purple-300/50 text-ink hover:bg-surface-2'
                            : 'border-transparent text-ink hover:bg-surface-2'
                    }`}
                  >
                    <span>{enLima.getUTCDate()}</span>
                    {enMesActual && hayPorResolver && (
                      <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red" />
                    )}
                    {enMesActual && (citasDia.length > 0 || cumpleanosDia.length > 0) && (
                      <span className="flex items-center gap-1">
                        {citasDia.length > 0 && (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${hayPendientes ? 'bg-blue' : 'bg-green'}`}
                          />
                        )}
                        {cumpleanosDia.length > 0 && <Cake className="h-3 w-3 text-amber" />}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Citas del día seleccionado */}
          <div ref={listaDiaRef} className="mt-4 lg:min-w-0 lg:flex-1">
            {!diaSeleccionado ? (
              <p className="py-8 text-center font-mono text-sm text-ink/60">
                Selecciona un día para ver sus citas.
              </p>
            ) : (
              <div className="space-y-3">
                {cumpleanosDelDiaSeleccionado.length > 0 && (
                  <div className="space-y-2">
                    {cumpleanosDelDiaSeleccionado.map((cliente) => (
                      <TarjetaCumpleanos key={cliente.id} cliente={cliente} />
                    ))}
                  </div>
                )}

                {citasDelDiaSeleccionado.length === 0 ? (
                  <EstadoVacio
                    icono={CalendarClock}
                    mensaje={`No hay citas el ${aLima(diaSeleccionado).getUTCDate()} de ${MESES[aLima(diaSeleccionado).getUTCMonth()]}.`}
                    accion={{ label: '+ Nueva cita', onClick: () => setModalCita('nuevo') }}
                    tema="purple-300"
                  />
                ) : (
                  <div className="space-y-2">
                    {citasDelDiaSeleccionado.map((cita) => {
                        const estado = ESTADOS[cita.estado] ?? ESTADOS.PENDIENTE
                        return (
                          <button
                            key={cita.id}
                            type="button"
                            onClick={() => setCitaSeleccionada(cita)}
                            style={estiloTarjetaCita(colorDeCita(cita, rolPorUsuario, coloresCitas))}
                            className="relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                          >
                            {(cita.cita_servicios?.length ?? 0) > 1 && (
                              <span className="absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-blue">
                                {cita.cita_servicios.length}
                              </span>
                            )}
                            <p className="truncate text-sm text-ink">
                              {nombreClienteDe(cita)} · {resumenServiciosDe(cita)}
                            </p>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-[14px] ${estado.clase}`}
                            >
                              {estado.label}
                            </span>
                            <p className="col-span-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink/60">
                              {formatearHora(cita.fecha_hora)}
                              {esCitaWeb(cita) && <CapsulaClienteWeb />}
                              {tieneAsistentePendiente(cita) && <CapsulaSinAsistente />}
                              <CapsulaSesion cita={cita} />
                              {tieneAdelanto(cita) && <CapsulaAdelanto />}
                              {tieneDescuento(cita) && <CapsulaDescuento />}
                              {tieneClientaPendiente(cita) && <CapsulaSinCliente />}
                              {citaSinComision(cita) && <CapsulaSinComision />}
                            </p>
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </>
      )}

      <BotonFlotanteAgregar onClick={() => setModalCita('nuevo')} color="morado" label="Nueva cita" />

      {modalColores && (
        <ModalColoresCitas
          coloresIniciales={coloresCitas}
          onCerrar={() => setModalColores(false)}
          onGuardado={(nuevos) => {
            setColoresCitas(nuevos)
            setModalColores(false)
          }}
        />
      )}

      {(modalCita || citaPlantilla) && (
        <ModalCita
          cita={modalCita && modalCita !== 'nuevo' ? modalCita : null}
          plantilla={citaPlantilla}
          fechaSugerida={diaSeleccionado ?? fechaCursor}
          onCerrar={() => {
            setModalCita(null)
            setCitaPlantilla(null)
          }}
          onGuardado={() => {
            const esNueva = modalCita === 'nuevo' || Boolean(citaPlantilla)
            setModalCita(null)
            setCitaPlantilla(null)
            setCitaSeleccionada(null)
            mostrarToast(esNueva ? 'Cita agendada.' : 'Cita actualizada.', 'exito')
            // Acá sí hace falta refetch (la cita puede haber cambiado de
            // fecha/cliente/servicio, con joins nuevos) — pero en silencio,
            // sin desmontar la grilla.
            cargarCitas(vigenteRef.current, true)
            refrescarBusquedaRef.current()
          }}
        />
      )}

      {citaACompletar && (
        <ModalRegistroAtencion
          citaId={citaACompletar.id}
          serviciosCita={(citaACompletar.cita_servicios ?? []).map((cs) => ({
            citaServicioId: cs.id,
            servicioId: cs.servicio_id,
            nombre: cs.servicios?.nombre ?? 'Servicio eliminado',
            // Precio acordado al agendar si se guardó uno; si no, el precio
            // actual del catálogo (citas viejas, de antes de este campo).
            precioSugerido: cs.precio ?? cs.servicios?.precio ?? 0,
          }))}
          valoresIniciales={{
            clienteId: citaACompletar.cliente_id ?? '',
            clienteNombre: nombreClienteDe(citaACompletar),
            // Cita con la clienta solo como nombre de referencia: el modal permite completarla anotando la atención como
            // pendiente hasta que la administradora registre a la clienta.
            clienteReferencia: citaACompletar.cliente_id ? '' : (citaACompletar.cliente_nombre_referencia ?? ''),
            fecha: aInputDatetimeLima(new Date()),
            nota: citaACompletar.nota ?? '',
          }}
          onCerrar={() => setCitaACompletar(null)}
          onGuardado={({ conPendientes } = {}) => {
            setCitaACompletar(null)
            setCitaSeleccionada(null)
            mostrarToast(
              conPendientes
                ? 'Cita completada — quedó como nota pendiente en Mis atenciones (falta la clienta registrada o la comisión).'
                : 'Cita completada — atención registrada.',
              'exito',
            )
            cargarCitas(vigenteRef.current, true)
            refrescarBusquedaRef.current()
          }}
        />
      )}

      {citaAAsignarCliente && (
        <ModalCliente
          nombreInicial={citaAAsignarCliente.cliente_nombre_referencia ?? ''}
          notaGuia={citaAAsignarCliente.nota ?? ''}
          onCerrar={() => setCitaAAsignarCliente(null)}
          onGuardado={(clienteCreado) => asignarClienteACita(citaAAsignarCliente, clienteCreado)}
        />
      )}

      {citaSeleccionada && !citaACompletar && !modalCita && !citaPlantilla && !citaAEliminar && !citaAReactivar && !citaACancelar && !citaANoAsistio && !citaAAsignarCliente && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div
            ref={panelDetalleRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">
                {nombreClienteDe(citaSeleccionada)}
              </h2>
              <span className="flex shrink-0 items-center gap-1.5">
                {/* WhatsApp pegado a la izquierda de la cápsula de estado: abre el chat de la clienta. Sin número
                    (o cita sin clienta registrada, solo con nombre de referencia) no se muestra nada. -my-2 para
                    que el botón (40px de zona táctil) no estire la cabecera; -mr-1.5 lo arrima a la cápsula. */}
                {citaSeleccionada.clientes?.telefono?.replace(/\D/g, '') && (
                  <span className="-my-2 -mr-1.5 flex">
                    <BotonAccion
                      icono={MessageCircle}
                      texto={enlaceRecordatorio ? 'Recordarle la cita por WhatsApp' : 'WhatsApp'}
                      color="verde"
                      href={`https://wa.me/${numeroWhatsapp(citaSeleccionada.clientes.telefono)}${enlaceRecordatorio}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      sinBorde
                    />
                  </span>
                )}
                {tieneClientaPendiente(citaSeleccionada) && <CapsulaSinCliente />}
                {esCitaWeb(citaSeleccionada) && <CapsulaClienteWeb />}
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    (ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).clase
                  }`}
                >
                  {(ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).label}
                </span>
                {/* ml: el botón usa margen negativo para agrandar su zona táctil; así no tapa la cápsula. */}
                <span className="ml-3 flex">
                  <BotonCerrarModal onClick={() => setCitaSeleccionada(null)} />
                </span>
              </span>
            </div>

            <div className="mt-3 space-y-1.5 text-sm text-ink/70">
              <div className="space-y-1.5">
                {(citaSeleccionada.cita_servicios ?? []).map((cs) => (
                  <div key={cs.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate">
                          {cs.servicios?.nombre ?? 'Servicio eliminado'}
                        </span>
                        {/* Aviso temprano: la asistente de la cita no tiene % para este servicio, así que no se podrá
                            completar hasta que la administradora se lo asigne (en Comisiones). */}
                        {serviciosConComisionDetalle && cs.servicio_id && !serviciosConComisionDetalle.has(cs.servicio_id) && (
                          <span className="shrink-0 text-[11px] font-medium text-orange-400">Sin comisión</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink/50">
                        {cs.duracion_min} min
                      </span>
                    </div>
                    {(cs.precio ?? cs.servicios?.precio) != null && (
                      <p className="font-mono text-xs text-ink/50">
                        {formatearSoles(cs.precio ?? cs.servicios.precio)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 font-mono text-xs">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-ink/40" />
                  {formatearFechaCorta(citaSeleccionada.fecha_hora)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-ink/40" />
                  {formatearHora(citaSeleccionada.fecha_hora)}
                </span>
                <span className="flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5 text-ink/40" />
                  {duracionTotalDe(citaSeleccionada)} min
                </span>
              </div>
              <p className={`text-xs ${citaSeleccionada.asistente_id ? '' : 'text-red'}`}>
                Asistente: {nombreAsistenteDe(citaSeleccionada)}
              </p>
              {avisoInasistencias && <p className="text-xs text-orange-400">{avisoInasistencias}</p>}
              {/* Quién la canceló o la marcó como «no asistió» (lo registra el servidor). Citas antiguas sin dato: no se muestra. */}
              {quienCambioEstado && (
                <p className="text-xs text-red">
                  {citaSeleccionada.estado === 'CANCELADA' ? 'Cancelada' : 'Marcada como no asistió'} por: {quienCambioEstado}
                </p>
              )}
              {etiquetaSesion(citaSeleccionada) && (
                <p className="flex items-center gap-1 text-xs text-pink-400">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Tratamiento por sesiones · {etiquetaSesion(citaSeleccionada)}
                </p>
              )}
              {tieneAdelanto(citaSeleccionada) && (
                <p className="flex items-center gap-1 text-xs text-green">
                  <Coins className="h-3.5 w-3.5" />
                  Adelanto: {formatearSoles(citaSeleccionada.adelanto)}
                  {citaSeleccionada.adelanto_metodo ? ` · ${citaSeleccionada.adelanto_metodo}` : ''}
                </p>
              )}
              {/* Descuento acordado al agendar: plata que NO va a entrar (Ventas lo aplica solo al cobrar la atención). */}
              {Number(citaSeleccionada.descuento) > 0 && (
                <p className="text-xs text-red">Descuento: -{formatearSoles(citaSeleccionada.descuento)}</p>
              )}
              {citaSeleccionada.nota && (
                <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
                  {citaSeleccionada.nota}
                </p>
              )}
              <p className="text-[11px] text-ink/40">
                Agendado por {nombresUsuarios.get(citaSeleccionada.creado_por) ?? '—'}
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {citaSeleccionada.estado === 'PENDIENTE' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCitaACancelar(citaSeleccionada)}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-xs font-medium text-ink/70 hover:border-red hover:text-red"
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      arrastraSesiones(citaSeleccionada) ? setCitaANoAsistio(citaSeleccionada) : cambiarEstado(citaSeleccionada, 'NO_ASISTIO')
                    }
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red/50 px-2 py-1.5 text-xs font-medium text-red hover:bg-red/10"
                  >
                    <UserX className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">No asistió</span>
                  </button>
                  {/* Solo la persona asignada puede completar (crea el
                      registro en SU pestaña Mis atenciones) — ni un admin puede hacerlo
                      por otra persona. El servidor ya lo bloquea igual,
                      esto evita mostrar un botón que solo va a dar error. */}
                  {citaSeleccionada.asistentes?.usuario_id === usuario?.id && (
                    <button
                      type="button"
                      onClick={() => setCitaACompletar(citaSeleccionada)}
                      className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-green/50 px-2 py-1.5 text-xs font-medium text-green hover:bg-green/10"
                    >
                      <CheckCheck className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Completar</span>
                    </button>
                  )}
                </div>
              )}

              {(citaSeleccionada.estado === 'CANCELADA' || citaSeleccionada.estado === 'NO_ASISTIO') && (
                <button
                  type="button"
                  onClick={() => setCitaAReactivar(citaSeleccionada)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-purple-300/50 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-300/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reactivar
                </button>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCitaSeleccionada(null)}
                  className="rounded-lg border border-border-strong px-4 py-2 text-sm text-ink hover:border-purple-300 hover:text-purple-300"
                >
                  Cerrar
                </button>
                {puedeAsignarClienteDetalle && (
                  <BotonAccion
                    icono={UserPlus}
                    texto="Registrar y asignar la clienta"
                    color="celeste"
                    onClick={() => setCitaAAsignarCliente(citaSeleccionada)}
                  />
                )}
                {puedeAsignarComisionDetalle && (
                  <BotonAccion
                    icono={Percent}
                    texto="Asignar comisión en Comisiones"
                    color="morado"
                    onClick={irAAsignarComisionDeCita}
                  />
                )}
                {citaSeleccionada.estado === 'COMPLETADA' && (
                  <BotonAccion
                    icono={CalendarPlus}
                    texto="Agendar otra igual (misma clienta y servicios, 4 semanas después)"
                    color="morado"
                    onClick={() => setCitaPlantilla(citaSeleccionada)}
                  />
                )}
                {citaSeleccionada.estado !== 'CANCELADA' && citaSeleccionada.estado !== 'COMPLETADA' && (
                  <BotonAccion
                    icono={Pencil}
                    texto="Editar"
                    color="celeste"
                    onClick={() => setModalCita(citaSeleccionada)}
                  />
                )}
                {rol === 'ADMINISTRADOR' && (
                  <BotonAccion
                    icono={Trash2}
                    texto="Eliminar"
                    color="rojo"
                    onClick={() => setCitaAEliminar(citaSeleccionada)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {citaAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta cita?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Esta acción no se puede deshacer. Si ya se completó, el registro de atención asociado
              no se elimina.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCitaAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {citaACancelar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Cancelar esta cita?</h2>
            <p className="mt-1 text-sm text-ink/60">Podrás reactivarla después si cambia el plan.</p>
            {arrastraSesiones(citaACancelar) && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-pink-400/30 bg-pink-400/5 px-2.5 py-2 text-xs text-pink-400">
                <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" />
                Es la sesión 1 de {citaACancelar.sesiones_total}: también se cancelarán las demás sesiones del tratamiento que sigan
                pendientes.
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCitaACancelar(null)}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {citaANoAsistio && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelNoAsistioRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Marcar como «no asistió»?</h2>
            <p className="mt-1 text-sm text-ink/60">Podrás reactivarla después si fue un error.</p>
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-pink-400/30 bg-pink-400/5 px-2.5 py-2 text-xs text-pink-400">
              <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" />
              Es la sesión 1 de {citaANoAsistio.sesiones_total}: se cancelarán las demás sesiones del tratamiento que sigan pendientes.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCitaANoAsistio(null)}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarNoAsistio}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
              >
                Sí, no asistió
              </button>
            </div>
          </div>
        </div>
      )}

      {citaAReactivar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelReactivarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Reactivar esta cita?</h2>
            <p className="mt-1 text-sm text-ink/60">Va a volver a quedar pendiente.</p>
            {arrastraSesiones(citaAReactivar) && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-pink-400/30 bg-pink-400/5 px-2.5 py-2 text-xs text-pink-400">
                <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" />
                También volverán las sesiones siguientes que se cancelaron junto con esta.
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCitaAReactivar(null)}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarReactivar}
                className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg"
              >
                Sí, reactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
