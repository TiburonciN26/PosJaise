import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowBigDown,
  Eye,
  EyeOff,
  Search,
  CalendarClock,
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
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalCita from '../components/ModalCita.jsx'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'

const DIAS_CORTOS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const ESTADOS = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  CONFIRMADA: { label: 'Confirmada', clase: 'border-blue/50 bg-blue/15 text-blue' },
  COMPLETADA: { label: 'Completada', clase: 'border-green/50 bg-green/15 text-green' },
  CANCELADA: { label: 'Cancelada', clase: 'border-border-strong bg-surface-2 text-ink/50' },
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
              href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}?text=${encodeURIComponent(
                `¡Feliz cumpleaños, ${cliente.nombre.split(' ')[0]}! 🎉 De parte de Jaise Beauty Academy, tenés un 30% de descuento en el servicio que quieras, válido por 7 días. ¡Te esperamos!`,
              )}`}
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
  'fecha_hora, estado, nota, adelanto, ' +
  'clientes(nombre), asistentes(nombres_completos, usuario_id), ' +
  'cita_servicios(id, servicio_id, duracion_min, precio, servicios(nombre, precio))'

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

// Solo mientras la cita sigue activa (pendiente/confirmada) — una cancelada
// o no-asistió sin asistente ya no necesita resolverse.
function tieneAsistentePendiente(cita) {
  return !cita.asistente_id && (cita.estado === 'PENDIENTE' || cita.estado === 'CONFIRMADA')
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

// Diferencia a simple vista las citas con adelanto/abono ya dejado por el
// cliente — misma forma de cápsula que CapsulaClienteWeb, en verde.
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

  const [fechaCursor, setFechaCursor] = useState(() => new Date())
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => new Date())
  const [asistentes, setAsistentes] = useState([])
  const [asistenteFiltro, setAsistenteFiltro] = useState('todas')
  const [nombresUsuarios, setNombresUsuarios] = useState(new Map())
  const [ocultarCanceladas, setOcultarCanceladas] = useState(true)
  const [clientesCumpleanos, setClientesCumpleanos] = useState([])
  const [citas, setCitas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [modalCita, setModalCita] = useState(null) // null | 'nuevo' | cita
  const [citaSeleccionada, setCitaSeleccionada] = useState(null)
  const [citaACompletar, setCitaACompletar] = useState(null)
  const [citaAEliminar, setCitaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [citaAReactivar, setCitaAReactivar] = useState(null)

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

  const [filtroAbierto, setFiltroAbierto] = useState(false)
  const [posicionFiltro, setPosicionFiltro] = useState(null)
  const botonFiltroRef = useRef(null)

  const panelDetalleRef = useRef(null)
  const panelEliminarRef = useRef(null)
  const panelReactivarRef = useRef(null)
  useCerrarConEscape(() => setCitaSeleccionada(null), Boolean(citaSeleccionada))
  useModalA11y(panelDetalleRef, Boolean(citaSeleccionada))
  useCerrarConEscape(() => setCitaAEliminar(null), Boolean(citaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(citaAEliminar))
  useCerrarConEscape(() => setCitaAReactivar(null), Boolean(citaAReactivar))
  useModalA11y(panelReactivarRef, Boolean(citaAReactivar))
  useCerrarConEscape(() => setMesAbierto(false), mesAbierto)
  useCerrarConEscape(() => setFiltroAbierto(false), filtroAbierto)

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
  // activo (mismo guard que Historial/Mi Panel).
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
        () => cargarCitas(vigenteRef.current, true),
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
      CONFIRMADA: 'Cita confirmada.',
      CANCELADA: 'Cita cancelada.',
      NO_ASISTIO: 'Cita marcada como no asistió.',
      PENDIENTE: 'Cita reactivada.',
    }
    mostrarToast(mensajes[nuevoEstado] ?? 'Cita actualizada.', 'info')
    setCitaSeleccionada(null)
    // El servidor solo cambió `estado` de UNA fila — se refleja igual en el
    // array local, sin refetch del mes completo (que hacía parpadear toda
    // la pantalla). El resto de los datos de la cita no cambió.
    setCitas((anteriores) =>
      anteriores.map((c) => (c.id === cita.id ? { ...c, estado: nuevoEstado } : c)),
    )
  }

  async function confirmarReactivar() {
    if (!citaAReactivar) return
    setCitaAReactivar(null)
    await cambiarEstado(citaAReactivar, 'PENDIENTE')
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

  const cumpleanosDelDiaSeleccionado = diaSeleccionado
    ? (cumpleanosPorDia.get(claveMesDia(aLima(diaSeleccionado).getUTCMonth(), aLima(diaSeleccionado).getUTCDate())) ?? [])
    : []

  // Busca solo dentro de las citas ya cargadas del mes visible (sin ida
  // extra al servidor) — por nombre de cliente o de servicio.
  const citasFiltradas = busquedaCitas.trim()
    ? citasVisibles.filter((cita) => {
        const texto = busquedaCitas.trim().toLowerCase()
        return (
          nombreClienteDe(cita).toLowerCase().includes(texto) ||
          (cita.cita_servicios ?? []).some((cs) =>
            (cs.servicios?.nombre ?? '').toLowerCase().includes(texto),
          )
        )
      })
    : []

  const tituloRango = `${MESES[mesCursor]} ${anioCursor}`
  const nombreFiltroActual =
    asistenteFiltro === 'todas'
      ? 'Todas'
      : (asistentes.find((a) => a.id === asistenteFiltro)?.nombres_completos ?? 'Todas')

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-5xl"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <div
          className={`grid overflow-x-hidden transition-[grid-template-columns] duration-300 ease-in-out ${
            busquedaAbierta ? 'grid-cols-[0fr]' : 'grid-cols-[1fr]'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2 overflow-x-hidden">
            <div className="relative min-w-0 flex-1">
              <button
                ref={botonMesRef}
                type="button"
                onClick={alternarMes}
                aria-expanded={mesAbierto}
                className="flex w-full items-center gap-1 truncate rounded-lg px-2 py-1.5 text-sm font-medium capitalize text-ink hover:bg-surface-2"
              >
                <span className="truncate">{tituloRango}</span>
                <ArrowBigDown
                  className={`h-3.5 w-3.5 shrink-0 text-ink/50 transition-transform duration-300 ${
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
                <ArrowBigDown
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
          className={`flex min-w-0 items-center transition-[flex-grow] duration-300 ease-in-out ${
            busquedaAbierta ? 'flex-1' : 'shrink-0'
          }`}
        >
          {busquedaAbierta ? (
            <div className="flex w-full items-center gap-1">
              <input
                type="search"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                value={busquedaCitas}
                onChange={(evento) => setBusquedaCitas(evento.target.value)}
                placeholder="Buscar por cliente o servicio..."
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              />
              <button
                type="button"
                onClick={cerrarBusqueda}
                aria-label="Cerrar búsqueda"
                className="shrink-0 rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBusquedaAbierta(true)}
              aria-label="Buscar citas"
              className="shrink-0 rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300"
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
          {citasFiltradas.length === 0 ? (
            <EstadoVacio
              icono={CalendarClock}
              mensaje="No hay citas que coincidan con la búsqueda."
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
                    className="relative flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                  >
                    {((cita.cita_servicios?.length ?? 0) > 1 || tieneAsistentePendiente(cita)) && (
                      <span className="absolute -left-1.5 -top-1.5 z-10 flex items-center gap-1">
                        {(cita.cita_servicios?.length ?? 0) > 1 && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-blue">
                            {cita.cita_servicios.length}
                          </span>
                        )}
                        {tieneAsistentePendiente(cita) && (
                          <span className="h-2.5 w-2.5 rounded-full bg-red" />
                        )}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">
                        {nombreClienteDe(cita)} · {resumenServiciosDe(cita)}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink/60">
                        {l.getUTCDate()} de {MESES[l.getUTCMonth()]} · {formatearHora(cita.fecha_hora)}
                        {esCitaWeb(cita) && <CapsulaClienteWeb />}
                        {tieneAdelanto(cita) && <CapsulaAdelanto />}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${estado.clase}`}
                    >
                      {estado.label}
                    </span>
                  </button>
                )
              })
          )}
        </div>
      ) : (
        <>
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
                // pendiente o confirmada por atender.
                const hayPendientes = citasDia.some(
                  (c) => c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA',
                )

                return (
                  <button
                    key={clave}
                    type="button"
                    disabled={!enMesActual}
                    onClick={() => setDiaSeleccionado(dia)}
                    className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border text-sm transition-colors ${
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
          <div className="mt-4 lg:min-w-0 lg:flex-1">
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
                            className="relative flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                          >
                            {((cita.cita_servicios?.length ?? 0) > 1 || tieneAsistentePendiente(cita)) && (
                              <span className="absolute -left-1.5 -top-1.5 z-10 flex items-center gap-1">
                                {(cita.cita_servicios?.length ?? 0) > 1 && (
                                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-blue">
                                    {cita.cita_servicios.length}
                                  </span>
                                )}
                                {tieneAsistentePendiente(cita) && (
                                  <span className="h-2.5 w-2.5 rounded-full bg-red" />
                                )}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm text-ink">
                                {nombreClienteDe(cita)} · {resumenServiciosDe(cita)}
                              </p>
                              <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink/60">
                                {formatearHora(cita.fecha_hora)}
                                {esCitaWeb(cita) && <CapsulaClienteWeb />}
                                {tieneAdelanto(cita) && <CapsulaAdelanto />}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${estado.clase}`}
                            >
                              {estado.label}
                            </span>
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

      {modalCita && (
        <ModalCita
          cita={modalCita === 'nuevo' ? null : modalCita}
          fechaSugerida={diaSeleccionado ?? fechaCursor}
          onCerrar={() => setModalCita(null)}
          onGuardado={() => {
            const esNueva = modalCita === 'nuevo'
            setModalCita(null)
            setCitaSeleccionada(null)
            mostrarToast(esNueva ? 'Cita agendada.' : 'Cita actualizada.', 'exito')
            // Acá sí hace falta refetch (la cita puede haber cambiado de
            // fecha/cliente/servicio, con joins nuevos) — pero en silencio,
            // sin desmontar la grilla.
            cargarCitas(vigenteRef.current, true)
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
            fecha: aInputDatetimeLima(new Date()),
            nota: citaACompletar.nota ?? '',
          }}
          onCerrar={() => setCitaACompletar(null)}
          onGuardado={() => {
            setCitaACompletar(null)
            setCitaSeleccionada(null)
            mostrarToast('Cita completada — atención registrada.', 'exito')
            cargarCitas(vigenteRef.current, true)
          }}
        />
      )}

      {citaSeleccionada && !citaACompletar && !modalCita && !citaAEliminar && !citaAReactivar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={panelDetalleRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">
                {nombreClienteDe(citaSeleccionada)}
              </h2>
              <span className="flex shrink-0 items-center gap-1.5">
                {esCitaWeb(citaSeleccionada) && <CapsulaClienteWeb />}
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    (ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).clase
                  }`}
                >
                  {(ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).label}
                </span>
              </span>
            </div>

            <div className="mt-3 space-y-1.5 text-sm text-ink/70">
              <div className="space-y-1.5">
                {(citaSeleccionada.cita_servicios ?? []).map((cs) => (
                  <div key={cs.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {cs.servicios?.nombre ?? 'Servicio eliminado'}
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
              <p className="text-xs">
                Agendado por: {nombresUsuarios.get(citaSeleccionada.creado_por) ?? '—'}
              </p>
              {tieneAdelanto(citaSeleccionada) && (
                <p className="flex items-center gap-1 text-xs text-green">
                  <Coins className="h-3.5 w-3.5" />
                  Adelanto: {formatearSoles(citaSeleccionada.adelanto)}
                </p>
              )}
              {citaSeleccionada.nota && (
                <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
                  {citaSeleccionada.nota}
                </p>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {(citaSeleccionada.estado === 'PENDIENTE' || citaSeleccionada.estado === 'CONFIRMADA') && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'CANCELADA')}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-xs font-medium text-ink/70 hover:border-red hover:text-red"
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'NO_ASISTIO')}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red/50 px-2 py-1.5 text-xs font-medium text-red hover:bg-red/10"
                  >
                    <UserX className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">No asistió</span>
                  </button>
                  {/* Solo la persona asignada puede completar (crea el
                      registro en SU Mi Panel) — ni un admin puede hacerlo
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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

      {citaAReactivar && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelReactivarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Reactivar esta cita?</h2>
            <p className="mt-1 text-sm text-ink/60">Va a volver a quedar pendiente.</p>
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
