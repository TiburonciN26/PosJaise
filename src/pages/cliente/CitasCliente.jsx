import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowBigDown,
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  Stamp,
  Star,
  User,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { obtenerMiClienteId } from '../../lib/clienteWeb.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useEstadoNegocio } from '../../context/EstadoNegocioContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../hooks/useModalA11y.js'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useProgramaRecompensas } from '../../hooks/useProgramaRecompensas.js'
import { avanceNivel, estimarMonedas, formatearCantidad, tarjetaDeSellos, textoMonedasEstimadas } from '../../lib/programaRecompensas.js'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import PieClienteWeb from './PieClienteWeb.jsx'
import {
  aLima,
  anioMesEnLima,
  claveDiaLima,
  diaSemanaLima,
  iniciarDia,
  iniciarMesLima,
  sumarDias,
} from '../../lib/fechas.js'
import ModalReprogramarCitaCliente from '../../components/ModalReprogramarCitaCliente.jsx'
import ComoGanasPuntosYSellos from './citas/ComoGanasPuntosYSellos.jsx'

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const NOMBRES_MES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
// Indexados por getUTCDay() (0 = domingo), no por el orden lunes-domingo
// de la grilla del calendario (DIAS_SEMANA de arriba).
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const ETIQUETAS_ESTADO = {
  PENDIENTE: { texto: 'Pendiente', clase: 'border border-dashed border-[var(--lw-gold)]/60 text-[var(--lw-gold)]' },
  CONFIRMADA: { texto: 'Confirmada', clase: 'bg-[var(--lw-gold)] text-black' },
  COMPLETADA: { texto: 'Completada', clase: 'bg-green/15 text-green' },
  CANCELADA: { texto: 'Cancelada', clase: 'bg-white/10 text-white/50' },
  NO_ASISTIO: { texto: 'No asistió', clase: 'bg-red/15 text-red' },
}

const formatoHora = new Intl.DateTimeFormat('es-PE', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

const SELECT_CITA =
  'id, fecha_hora, estado, nota, asistente_id, adelanto, cita_servicios(id, duracion_min, precio, servicio_id, servicios(nombre))'

const DEFAULT_PLAZO_CANCELACION_HORAS = 3

const CLASE_BOTON_SECUNDARIO =
  'flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 text-[13px] font-medium text-white/90 transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:cursor-not-allowed disabled:opacity-30'
const CLASE_BOTON_SECUNDARIO_ROJO =
  'flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 text-[13px] font-medium text-red transition-colors hover:border-red disabled:cursor-not-allowed disabled:opacity-30'
const CLASE_BLOQUE =
  'rounded-[10px] border border-white/10 bg-[#111113] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]'

// Se puede cancelar/reprogramar hasta N horas antes — mismo límite que
// valida cancelar_mi_cita_web()/reprogramar_mi_cita_web() en el servidor
// (estado_negocio.cancelacion_plazo_horas, 115_estado_negocio_adelanto.sql);
// acá solo evita mostrar un botón que el servidor igual va a rechazar.
function puedeModificar(cita, plazoHoras) {
  if (!['PENDIENTE', 'CONFIRMADA'].includes(cita.estado)) return false
  return new Date(cita.fecha_hora).getTime() - Date.now() > plazoHoras * 60 * 60 * 1000
}

function esVigente(cita) {
  return ['PENDIENTE', 'CONFIRMADA'].includes(cita.estado) && new Date(cita.fecha_hora).getTime() >= Date.now()
}

function totalCita(cita) {
  return (cita.cita_servicios ?? []).reduce((suma, item) => suma + (item.precio ?? 0), 0)
}

function duracionCita(cita) {
  return (cita.cita_servicios ?? []).reduce((suma, item) => suma + (item.duracion_min ?? 30), 0)
}

function nombresServicios(cita) {
  return (cita.cita_servicios ?? []).map((item) => item.servicios?.nombre).filter(Boolean).join(', ')
}

function relativoTexto(fecha) {
  const dias = Math.round((iniciarDia(fecha).getTime() - iniciarDia(new Date()).getTime()) / 86400000)
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  if (dias > 1) return `En ${dias} días`
  return ''
}

function fechaCortaTexto(fecha) {
  const enLima = aLima(fecha)
  return `${DIAS_CORTOS[enLima.getUTCDay()]} ${enLima.getUTCDate()} ${NOMBRES_MES_CORTOS[enLima.getUTCMonth()].toLowerCase()}`
}

function fechaConDiaLargaTexto(fecha) {
  const enLima = aLima(fecha)
  return `${DIAS_LARGOS[enLima.getUTCDay()]} ${enLima.getUTCDate()} de ${NOMBRES_MES[enLima.getUTCMonth()].toLowerCase()}`
}

function diaSemanaLargoTexto(fecha) {
  return DIAS_LARGOS[diaSemanaLima(fecha)]
}

function fechaLargaTexto(fecha) {
  const enLima = aLima(fecha)
  return `${enLima.getUTCDate()} de ${NOMBRES_MES[enLima.getUTCMonth()].toLowerCase()} de ${enLima.getUTCFullYear()}`
}

function fechaDesdeClaveDia(clave) {
  const [anio, mes, dia] = clave.split('-').map(Number)
  return sumarDias(iniciarMesLima(anio, mes), dia - 1)
}

// Igual que idsConSello() del lienzo aprobado (docs/diseno-citas/README.md,
// "Reglas de puntos y sellos"): 1 sello por DÍA — solo la primera cita no
// cancelada/no-asistió de cada día (cronológicamente) cuenta.
function idsConSello(citas) {
  const vistos = new Set()
  const ids = new Set()
  ;[...citas]
    .filter((c) => c.estado !== 'CANCELADA' && c.estado !== 'NO_ASISTIO')
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
    .forEach((c) => {
      const clave = claveDiaLima(new Date(c.fecha_hora))
      if (!vistos.has(clave)) {
        vistos.add(clave)
        ids.add(c.id)
      }
    })
  return ids
}

// Chips de sello: la tarjeta general (próxima/próximas/día filtrado) y la
// fila de historial muestran reglas ligeramente distintas (ver README:
// una completada que YA ganó el sello no repite el chip "+1 sello" fuera
// de Historial, y Historial nunca muestra "ya contado").
function calcularChipsSello(cita, tieneSello, { historial = false } = {}) {
  if (historial) {
    return { sello: cita.estado === 'COMPLETADA' && tieneSello, selloRepetido: false }
  }
  // Relevante = una cita que de verdad cuenta para el sello del día
  // (vigente a futuro o ya completada) — una cancelada/no-asistió no
  // muestra ningún chip, ni "+1 sello" ni "ya contado". La que SÍ es la
  // dueña del sello de su día debe mostrar "+1 sello" sea cual sea su
  // estado (antes se lo perdía si ya estaba COMPLETADA — bug reportado).
  const relevante = esVigente(cita) || cita.estado === 'COMPLETADA'
  return {
    sello: tieneSello && relevante,
    selloRepetido: !tieneSello && relevante,
  }
}

// Estimado con la misma fórmula que mis_puntos() (config_puntos) con el programa APAGADO: no es la fuente de verdad, solo el número que
// se muestra por adelantado. Sin la configuración no hay estimado (null): nunca un 0 inventado.
function puntosEstimados(cita, tieneSello, cfg) {
  if (!cfg) return null
  return Math.floor((tieneSello ? Number(cfg.puntos_por_visita) : 0) + totalCita(cita) * Number(cfg.puntos_por_sol_gastado))
}

// resenas_servicio es por servicio (unique cliente+servicio) — una cita
// completada "califica" para el botón Calificar si algún servicio suyo
// todavía no tiene reseña; se navega al primero sin reseña.
function estadoResenaCita(cita, resenasServicioIds) {
  if (cita.estado !== 'COMPLETADA') return { puedeCalificar: false, calificada: false, servicioId: null }
  const ids = (cita.cita_servicios ?? []).map((cs) => cs.servicio_id).filter(Boolean)
  if (ids.length === 0) return { puedeCalificar: false, calificada: false, servicioId: null }
  const faltante = ids.find((id) => !resenasServicioIds.has(id))
  return faltante
    ? { puedeCalificar: true, calificada: false, servicioId: faltante }
    : { puedeCalificar: false, calificada: true, servicioId: ids[0] }
}

function construirDiasGrilla(mesActual) {
  const { anio, mes } = anioMesEnLima(mesActual)
  const inicioMes = iniciarMesLima(anio, mes)
  const diaSemanaInicio = diaSemanaLima(inicioMes) // 0=domingo … 6=sábado
  const offset = diaSemanaInicio === 0 ? 6 : diaSemanaInicio - 1 // la grilla empieza en lunes
  const primerDiaGrilla = sumarDias(inicioMes, -offset)
  return Array.from({ length: 42 }, (_, i) => sumarDias(primerDiaGrilla, i))
}

function ChipEstado({ estado }) {
  const info = ETIQUETAS_ESTADO[estado] ?? ETIQUETAS_ESTADO.PENDIENTE
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${info.clase}`}>
      {info.texto}
    </span>
  )
}

function ChipPuntos({ puntos }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--lw-gold)]/35 bg-[var(--lw-gold)]/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#d3e4f8]">
      <Sparkles className="h-3 w-3 text-[var(--lw-gold)]" />+{puntos} pts
    </span>
  )
}

// Con el programa nuevo el sello lo da una VENTA confirmada con servicios (máx. uno por día de Perú), no la cita en sí: el chip no lo
// promete, dice que puede sumarlo. `activo` solo cambia el texto.
function ChipMonedas({ texto }) {
  return (
    <span
      title="Estimado: las monedas se acreditan al confirmarse la venta, sobre el importe neto (después de descuentos y cupones)."
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--lw-gold)]/35 bg-[var(--lw-gold)]/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#d3e4f8]"
    >
      <Sparkles className="h-3 w-3 text-[var(--lw-gold)]" />
      Estimado {texto}
    </span>
  )
}

function ChipSello({ sello, selloRepetido, activo = false }) {
  if (sello) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--lw-gold)]/35 bg-[var(--lw-gold)]/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#d3e4f8]">
        <Stamp className="h-3 w-3 text-[var(--lw-gold)]" />
        {activo ? 'Puede sumar 1 sello' : '+1 sello'}
      </span>
    )
  }
  if (selloRepetido) {
    return (
      <span
        title="Solo se suma 1 sello por día, aunque tengas varias citas ese día"
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-white/40"
      >
        {activo ? 'Máx. 1 sello por día' : 'Sello ya contado ese día'}
      </span>
    )
  }
  return null
}

// "Agendar cita" reemplaza al viejo ModalAgendarCitaCliente (borrado
// junto con este cambio), pero NO manda siempre al carrito: si todavía
// no hay servicios agregados, el carrito solo diría "andá a Servicios"
// — un redirect inútil. Va directo a /citas/carrito solo cuando ya hay
// algo que reservar; si está vacío, manda a elegir servicios primero
// (bug reportado por el usuario, corregido acá).
function BotonAgendar({ destino }) {
  return (
    <Link
      to={destino}
      className="flex h-11 items-center gap-3 rounded-full bg-[var(--lw-gold)] py-0 pl-5 pr-1.5 text-sm font-semibold text-black transition-colors hover:bg-[#bcd3f1] lg:h-12"
    >
      Agendar cita
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)] lg:h-9 lg:w-9">
        <Plus className="h-4 w-4" />
      </span>
    </Link>
  )
}

// Calendario mensual propio del cliente — mismo espíritu que el de
// Citas.jsx del POS (grilla de 7 columnas, navegación por mes, punto
// indicador de días con citas), pero solo con SUS citas: no hay filtro
// de asistente ni de búsqueda, no tiene sentido con 1-2 citas a la vez.
//
// Rediseño (docs/diseno-citas/README.md): el calendario en sí queda
// idéntico, "Próximas citas" se ve siempre (consulta aparte, sin límite
// de mes) y tocar un día solo filtra la lista — no reemplaza a "Próximas".
export default function CitasCliente() {
  const { mostrarToast } = useToast()
  const { serviciosCarrito, agregarServicio } = useCarritoCliente()
  const { cancelacionPlazoHoras } = useEstadoNegocio()
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()
  const navigate = useNavigate()
  const { session } = useAuth()
  // Programa de Recompensas: reglas vigentes y, con el programa activo, el saldo propio (monedas y clasificación SEPARADAS).
  const programa = useProgramaRecompensas(session?.user?.id ?? null)

  const [mesActual, setMesActual] = useState(() => iniciarDia(new Date()))
  const [citasMes, setCitasMes] = useState([])
  const [cargandoMes, setCargandoMes] = useState(true)
  const [proximas, setProximas] = useState([])
  const [historial, setHistorial] = useState([])
  const [cargandoInicial, setCargandoInicial] = useState(true)
  const [asistentesPorId, setAsistentesPorId] = useState(() => new Map())
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)
  const [misPuntos, setMisPuntos] = useState(null)
  const [fidelizacion, setFidelizacion] = useState(null)
  const [cfgPuntos, setCfgPuntos] = useState(null)
  const [resenasServicioIds, setResenasServicioIds] = useState(() => new Set())

  const [diaSeleccionado, setDiaSeleccionado] = useState(null)
  const [histAbierto, setHistAbierto] = useState(true)
  const [citaAReprogramar, setCitaAReprogramar] = useState(null)
  const [citaACancelar, setCitaACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const panelCancelarRef = useRef(null)

  // La animación de entrada de "Próximas citas" corre solo al montar la
  // pestaña (docs/patrones/animacion-entrada.md) — este ref se apaga
  // justo después del primer pintado con datos reales, así que tocar un
  // día del calendario (cambia qué citas se listan) nunca la repite.
  const primeraListaRef = useRef(true)

  useCerrarConEscape(() => setCitaACancelar(null), Boolean(citaACancelar))
  useModalA11y(panelCancelarRef, Boolean(citaACancelar))

  async function cargarMes(fechaMes) {
    setCargandoMes(true)
    const { anio, mes } = anioMesEnLima(fechaMes)
    const inicioMes = iniciarMesLima(anio, mes)
    const finMes = iniciarMesLima(anio, mes + 1)
    const miId = await obtenerMiClienteId()
    if (!miId) {
      setCitasMes([])
      setCargandoMes(false)
      return
    }
    const { data } = await supabase
      .from('citas')
      .select(SELECT_CITA)
      .eq('cliente_id', miId)
      .gte('fecha_hora', inicioMes.toISOString())
      .lt('fecha_hora', finMes.toISOString())
      .order('fecha_hora')
    setCitasMes(data ?? [])
    setCargandoMes(false)
  }

  async function cargarProximasEHistorial() {
    const ahoraIso = new Date().toISOString()
    const miId = await obtenerMiClienteId()
    if (!miId) {
      setProximas([])
      setHistorial([])
      return
    }
    const [proximasRes, historialRes] = await Promise.all([
      supabase
        .from('citas')
        .select(SELECT_CITA)
        .eq('cliente_id', miId)
        .gte('fecha_hora', ahoraIso)
        .in('estado', ['PENDIENTE', 'CONFIRMADA'])
        .order('fecha_hora'),
      supabase
        .from('citas')
        .select(SELECT_CITA)
        .eq('cliente_id', miId)
        .or(`fecha_hora.lt.${ahoraIso},estado.in.(COMPLETADA,CANCELADA,NO_ASISTIO)`)
        .order('fecha_hora', { ascending: false }),
    ])
    setProximas(proximasRes.data ?? [])
    setHistorial(historialRes.data ?? [])
  }

  function recargarTodo() {
    cargarMes(mesActual)
    cargarProximasEHistorial()
  }

  useEffect(() => {
    let vigente = true

    async function cargarInicial() {
      const [asistentesRes, contactoRes, horarioRes, cfgRes, puntosRes, fidelizacionRes] = await Promise.all([
        supabase.rpc('asistentes_para_citas'),
        supabase.rpc('datos_contacto'),
        supabase.rpc('horario_atencion'),
        supabase.from('config_puntos').select('puntos_por_visita, puntos_por_sol_gastado').eq('id', 1).maybeSingle(),
        supabase.rpc('mis_puntos'),
        supabase.rpc('mi_fidelizacion'),
      ])
      if (!vigente) return
      setAsistentesPorId(new Map((asistentesRes.data ?? []).map((a) => [a.id, a.nombres_completos])))
      setContacto(contactoRes.data?.[0] ?? null)
      setHorario(horarioRes.data?.[0] ?? null)
      setCfgPuntos(cfgRes.data ?? null)
      setMisPuntos(puntosRes.data?.[0] ?? null)
      setFidelizacion(fidelizacionRes.data?.[0] ?? null)
      await cargarProximasEHistorial()
      if (!vigente) return
      setCargandoInicial(false)
    }

    cargarInicial()
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargarMes(mesActual)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesActual])

  // Apaga la animación de "Próximas citas" recién después del primer
  // pintado con datos reales (no con el estado de carga vacío).
  useEffect(() => {
    if (cargandoInicial) return undefined
    const id = requestAnimationFrame(() => {
      primeraListaRef.current = false
    })
    return () => cancelAnimationFrame(id)
  }, [cargandoInicial])

  // Qué servicios (de citas COMPLETADAS) ya tienen reseña propia — se
  // reusa mi_resena_servicio() (116_resenas_servicio.sql), la misma RPC
  // security-definer del Detalle de servicio, en vez de reinventar el
  // flujo de reseñas acá.
  useEffect(() => {
    const idsCompletadas = new Set()
    historial.forEach((cita) => {
      if (cita.estado !== 'COMPLETADA') return
      ;(cita.cita_servicios ?? []).forEach((cs) => {
        if (cs.servicio_id) idsCompletadas.add(cs.servicio_id)
      })
    })
    if (idsCompletadas.size === 0) {
      setResenasServicioIds(new Set())
      return undefined
    }
    let vigente = true
    Promise.all(
      [...idsCompletadas].map((id) =>
        supabase
          .rpc('mi_resena_servicio', { p_servicio_id: id })
          .then(({ data }) => {
            const fila = Array.isArray(data) ? data[0] : data
            return fila?.id ? id : null
          }),
      ),
    ).then((resultados) => {
      if (!vigente) return
      setResenasServicioIds(new Set(resultados.filter(Boolean)))
    })
    return () => {
      vigente = false
    }
  }, [historial])

  const citasPorDiaMes = useMemo(() => {
    const mapa = new Map()
    for (const cita of citasMes) {
      const clave = claveDiaLima(new Date(cita.fecha_hora))
      if (!mapa.has(clave)) mapa.set(clave, [])
      mapa.get(clave).push(cita)
    }
    return mapa
  }, [citasMes])

  const citasParaSello = useMemo(() => {
    const mapa = new Map()
    for (const c of citasMes) mapa.set(c.id, c)
    for (const c of proximas) mapa.set(c.id, c)
    for (const c of historial) mapa.set(c.id, c)
    return [...mapa.values()]
  }, [citasMes, proximas, historial])
  const sellosSet = useMemo(() => idsConSello(citasParaSello), [citasParaSello])

  const diasGrilla = useMemo(() => construirDiasGrilla(mesActual), [mesActual])
  const { anio: anioMesActual, mes: mesIndiceActual } = anioMesEnLima(mesActual)
  const hoyClave = claveDiaLima(new Date())

  const plazoHoras = cancelacionPlazoHoras ?? DEFAULT_PLAZO_CANCELACION_HORAS
  const destinoAgendar = serviciosCarrito.size > 0 ? '/citas/carrito' : '/servicios'
  const proxima = proximas[0] ?? null

  const diaSeleccionadoFecha = diaSeleccionado ? fechaDesdeClaveDia(diaSeleccionado) : null
  const listaTitulo = diaSeleccionado
    ? `Citas del ${fechaCortaTexto(diaSeleccionadoFecha).toLowerCase()}`
    : 'Próximas citas'
  const listaTituloLargo = diaSeleccionado
    ? `Citas del ${fechaConDiaLargaTexto(diaSeleccionadoFecha).toLowerCase()}`
    : listaTitulo
  const listaOrdenada = useMemo(() => {
    const base = diaSeleccionado ? (citasPorDiaMes.get(diaSeleccionado) ?? []) : proximas
    return [...base].sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
  }, [diaSeleccionado, citasPorDiaMes, proximas])
  const grupos = useMemo(() => {
    const mapa = new Map()
    listaOrdenada.forEach((cita) => {
      const clave = claveDiaLima(new Date(cita.fecha_hora))
      if (!mapa.has(clave)) {
        mapa.set(clave, {
          clave,
          fecha: fechaCortaTexto(new Date(cita.fecha_hora)),
          fechaLarga: fechaConDiaLargaTexto(new Date(cita.fecha_hora)),
          rel: diaSeleccionado ? '' : relativoTexto(new Date(cita.fecha_hora)),
          items: [],
        })
      }
      mapa.get(clave).items.push(cita)
    })
    return [...mapa.values()]
  }, [listaOrdenada, diaSeleccionado])

  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const mapsUrl = contacto?.direccion
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contacto.direccion)}`
    : null
  const horarioTexto = horario
    ? `${formatearDias(horario.dias_atencion)} ${formatearHora(horario.bloque1_inicio)}-${formatearHora(horario.bloque1_fin)}`
    : null

  // Programa APAGADO (heredado): puntos y sellos de mis_puntos() / mi_fidelizacion() y la fórmula de config_puntos. Cada dato puede
  // faltar (consulta fallida): entonces no se muestra ni se sustituye por un valor por omisión.
  const puntos = misPuntos?.puntos ?? null
  const nivelRaw = misPuntos?.nivel ?? 'BASICO'
  const umbralPremium = misPuntos?.umbral_premium ?? null
  const umbralVip = misPuntos?.umbral_vip ?? null
  let piso = 0
  let techo = umbralPremium
  if (nivelRaw === 'PREMIUM') {
    piso = umbralPremium
    techo = umbralVip
  } else if (nivelRaw === 'VIP') {
    piso = umbralVip
    techo = umbralVip
  }
  const progresoPct = misPuntos && techo > piso ? Math.min(100, Math.max(0, ((puntos - piso) / (techo - piso)) * 100)) : misPuntos ? 100 : 0

  const sellosMeta = fidelizacion?.visitas_por_recompensa ?? null
  const sellosActuales = fidelizacion?.sellos_actuales ?? 0

  // Programa ACTIVO: el saldo gastable (monedas) y la clasificación (nivel) son cosas distintas. La barra y «faltan N» salen de la
  // CLASIFICACIÓN: gastar monedas nunca las mueve.
  const saldoProg = programa.saldo.estado === 'ok' ? programa.saldo.datos : null
  const avanceProg = saldoProg
    ? avanceNivel({
        nivel: saldoProg.nivel,
        clasificacion: saldoProg.clasificacion,
        umbralPremium: saldoProg.umbral_premium,
        umbralVip: saldoProg.umbral_vip,
      })
    : null
  const sellosProg = saldoProg ? tarjetaDeSellos(saldoProg.sellos, saldoProg.sellos_por_premio) : null

  // Estimado que se muestra en cada cita (solo citas vigentes con el programa activo; nada en el historial).
  function chipRecompensa(cita, tieneSello, { historial = false } = {}) {
    if (programa.activo === true) {
      if (historial || !esVigente(cita)) return null
      const texto = textoMonedasEstimadas(estimarMonedas(programa.reglas, { servicios: totalCita(cita) }))
      return texto ? <ChipMonedas texto={texto} /> : null
    }
    if (programa.activo === false) {
      const estimado = puntosEstimados(cita, tieneSello, cfgPuntos)
      return estimado === null ? null : <ChipPuntos puntos={estimado} />
    }
    return null // reglas cargando o con error: sin cifra
  }

  const ENTRADA = esDesktop
    ? { header: 100, proxima: 250, calendario: 450, listaTitulo: 600, listaBase: 700, listaPaso: 110, historial: 950, comoGanas: 1050 }
    : { header: 100, proxima: 250, calendario: 700, listaTitulo: 550, listaBase: 700, listaPaso: 110, historial: 850, comoGanas: 1050 }
  const DELAY_ASIDE_DESKTOP = 750
  const DELAY_PUNTOS_MOBILE = 900
  const DELAY_ANTES_MOBILE = 950

  function irMesAnterior() {
    const { anio, mes } = anioMesEnLima(mesActual)
    setMesActual(iniciarMesLima(anio, mes - 1))
  }

  function irMesSiguiente() {
    const { anio, mes } = anioMesEnLima(mesActual)
    setMesActual(iniciarMesLima(anio, mes + 1))
  }

  function irHoy() {
    const hoy = iniciarDia(new Date())
    setMesActual(hoy)
    setDiaSeleccionado(null)
  }

  function alternarDia(clave) {
    setDiaSeleccionado((anterior) => (anterior === clave ? null : clave))
  }

  async function confirmarCancelar() {
    if (!citaACancelar) return
    setCancelando(true)
    const { error } = await supabase.rpc('cancelar_mi_cita_web', { p_cita_id: citaACancelar.id })
    setCancelando(false)
    setCitaACancelar(null)

    if (error) {
      mostrarToast(error.message || 'No se pudo cancelar la cita.', 'error')
      return
    }

    mostrarToast('Cita cancelada.', 'exito')
    recargarTodo()
  }

  // Bug reportado (código anterior): tras agendar/reprogramar, el
  // calendario se quedaba mostrando el mes que ya estaba abierto — si la
  // cita nueva caía en otro mes, quedaba invisible hasta navegar ahí a
  // mano. Ahora salta directo al mes/día de la fecha elegida y refresca
  // Próximas/Historial (la cita puede haber salido de uno para entrar al
  // otro, ej. al reprogramar).
  function irAFecha(fechaHoraIso) {
    const fecha = new Date(fechaHoraIso)
    setMesActual(iniciarDia(fecha))
    setDiaSeleccionado(null)
    cargarProximasEHistorial()
  }

  // Agrega los servicios de esa cita al carrito de servicios y navega a
  // /citas/carrito (docs/diseno-carrito-servicios/README.md) — ya no
  // abre el modal, que se borró junto con este cambio.
  async function volverAReservar(cita) {
    const ids = [...new Set((cita.cita_servicios ?? []).map((cs) => cs.servicio_id).filter(Boolean))]
    if (ids.length === 0) return
    await Promise.all(ids.filter((id) => !serviciosCarrito.has(id)).map((id) => agregarServicio(id)))
    navigate('/citas/carrito')
  }

  function bloquePuntos() {
    // Reglas leyéndose o con error: sin cifras (no se muestra un saldo que no se leyó).
    if (programa.estado === 'cargando') {
      return (
        <div role="region" aria-label="Tu saldo y nivel" className={`${CLASE_BLOQUE} p-5`}>
          <h2 className="lw-titulo-heavitas text-[15px] uppercase">Puntos</h2>
          <p aria-busy="true" className="mt-3 text-[13px] text-white/50">Cargando tu saldo…</p>
        </div>
      )
    }
    if (programa.estado === 'error' || (programa.activo === true && programa.saldo.estado === 'error')) {
      return (
        <div role="region" aria-label="Tu saldo y nivel" className={`${CLASE_BLOQUE} p-5`}>
          <h2 className="lw-titulo-heavitas text-[15px] uppercase">Puntos</h2>
          <p role="alert" className="mt-3 text-[13px] leading-relaxed text-white/60">
            No pudimos cargar tu saldo ahora. No cambió; solo no pudimos leerlo.
          </p>
          <button
            type="button"
            onClick={programa.recargar}
            className="mt-3 min-h-11 rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
          >
            Reintentar
          </button>
        </div>
      )
    }
    if (programa.activo === true && !saldoProg) {
      return (
        <div role="region" aria-label="Tu saldo y nivel" className={`${CLASE_BLOQUE} p-5`}>
          <h2 className="lw-titulo-heavitas text-[15px] uppercase">Monedas</h2>
          <p aria-busy="true" className="mt-3 text-[13px] text-white/50">Cargando tu saldo…</p>
        </div>
      )
    }

    const activo = programa.activo === true
    const nivelMostrado = activo ? saldoProg.nivel : nivelRaw
    const nivelEtiqueta = nivelMostrado === 'BASICO' ? 'Básico' : nivelMostrado === 'PREMIUM' ? 'Premium' : 'VIP'
    const pct = activo ? avanceProg.pct : progresoPct
    return (
      <div role="region" aria-label="Tu saldo y nivel" className={`${CLASE_BLOQUE} p-5`}>
        <div className="flex items-center justify-between gap-2.5">
          <h2 className="lw-titulo-heavitas text-[15px] uppercase">{activo ? 'Monedas' : 'Puntos'}</h2>
          <span className="rounded-full bg-[var(--lw-gold)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--lw-gold)]">
            Nivel {nivelEtiqueta}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold" style={{ color: 'var(--lw-gold)' }}>
            {activo ? formatearCantidad(saldoProg.monedas) : (puntos ?? '—')}
          </span>
          <span className="text-[13px] text-white/50">{activo ? 'monedas disponibles' : 'pts'}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={activo ? 'Progreso de clasificación' : 'Progreso de nivel'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#86a9d8,#d3e4f8)' }}
            />
          </div>
          <Link to="/recompensas?seccion=tarjeta" className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--lw-gold)]">
            {activo ? 'Ver mis monedas' : 'Ver mis puntos'} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {activo && (
          <p className="mt-1 text-xs leading-relaxed text-white/50">Gastar monedas no baja tu nivel ni este avance.</p>
        )}
        <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
          {activo ? (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="lw-titulo-heavitas text-[15px] uppercase">Sellos</h2>
                {sellosProg.negativo && <span className="text-xs text-white/50">{sellosProg.porRecuperar} por recuperar</span>}
              </div>
              {!sellosProg.negativo && (
                <div className="flex items-center justify-between gap-3">
                <div className="flex gap-2">
                  {Array.from({ length: saldoProg.sellos_por_premio }, (_, i) => (
                    <span
                      key={i}
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        sellosProg.completa || i < sellosProg.enTarjeta
                          ? 'bg-[var(--lw-gold)] text-black'
                          : 'border border-dashed border-white/25 text-transparent'
                      }`}
                    >
                      <Stamp className="h-3 w-3" />
                    </span>
                  ))}
                </div>
                <Link to="/recompensas?seccion=sellos" className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--lw-gold)]">
                  Ver mis sellos <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="lw-titulo-heavitas text-[15px] uppercase">Sellos de fidelidad</h2>
                {!sellosMeta && <span className="text-xs text-white/50">No disponible ahora</span>}
              </div>
              {sellosMeta && (
                <div className="flex items-center justify-between gap-3">
                <div className="flex gap-2">
                  {Array.from({ length: sellosMeta }, (_, i) => (
                    <span
                      key={i}
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        i < sellosActuales ? 'bg-[var(--lw-gold)] text-black' : 'border border-dashed border-white/25 text-transparent'
                      }`}
                    >
                      <Stamp className="h-3 w-3" />
                    </span>
                  ))}
                </div>
                <Link to="/recompensas?seccion=sellos" className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--lw-gold)]">
                  Ver mi fidelización <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  function bloqueAntes() {
    return (
      <div className={`${CLASE_BLOQUE} p-5 sm:px-6`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="lw-titulo-heavitas text-[15px] uppercase">Antes de tu cita</h2>
          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre mi cita.')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-2 text-sm font-semibold text-green transition-opacity hover:opacity-80"
            >
              <MessageCircle className="h-4 w-4" />
              ¿Dudas con tu cita?
            </a>
          ) : (
            <span className="shrink-0 text-sm text-white/40">WhatsApp aún no configurado</span>
          )}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-white/10 bg-[#111113] p-4">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              <Clock className="h-4 w-4 text-[var(--lw-gold)]" />
              Reprogramar o cancelar
            </span>
            <p className="text-[13px] leading-relaxed text-white/70">
              Desde aquí hasta <strong className="text-white">{plazoHoras} horas antes</strong>. Después, escríbenos por WhatsApp.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-white/10 bg-[#111113] p-4">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              <CalendarClock className="h-4 w-4 text-[var(--lw-gold)]" />
              Horario
            </span>
            <p className="text-[13px] leading-relaxed text-white/70">{horarioTexto ? `Atendemos ${horarioTexto}.` : 'Horario aún no configurado'}</p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-white/10 bg-[#111113] p-4">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              <MapPin className="h-4 w-4 text-[var(--lw-gold)]" />
              Dirección
            </span>
            <p className="text-[13px] leading-relaxed text-white/70">{contacto?.direccion || 'Dirección aún no configurada'}</p>
          </div>
        </div>
      </div>
    )
  }

  if (cargandoInicial) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto py-4 md:py-8">
      <div className="mx-auto w-full max-w-[1400px] lw-gutter-detalle">
        {/* Encabezado */}
        <div
          className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pt-2 ${reducirMovimiento ? '' : 'in-left'}`}
          style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA.header}ms` }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="lw-titulo-heavitas text-3xl uppercase">Mis citas</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/citas/carrito"
              aria-label={
                serviciosCarrito.size > 0 ? `Carrito de servicios, ${serviciosCarrito.size} por reservar` : 'Carrito de servicios, vacío'
              }
              className="flex shrink-0 items-center gap-2.5 text-[var(--lw-gold)] transition-colors hover:text-[#d3e4f8]"
            >
              <span className="text-sm font-medium">Carrito de servicios</span>
              <span className="relative flex">
                <ShoppingCart className="h-5 w-5" />
                {serviciosCarrito.size > 0 && (
                  <span className="absolute -right-2.5 -top-2.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-[#0b0b0c] bg-[var(--lw-gold)] px-1 text-[11px] font-bold text-black">
                    {serviciosCarrito.size}
                  </span>
                )}
              </span>
            </Link>
            <BotonAgendar destino={destinoAgendar} />
          </div>
        </div>

        {/* Tu próxima cita */}
        <section
          aria-labelledby="citas-proxima-titulo"
          className={`mt-6 rounded-[10px] border border-[var(--lw-gold)]/35 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:p-8 ${
            reducirMovimiento ? '' : 'in-up'
          }`}
          style={{
            ...(reducirMovimiento ? {} : { animationDelay: `${ENTRADA.proxima}ms` }),
            backgroundImage: 'radial-gradient(120% 160% at 0% 0%, rgba(169,198,236,0.10), transparent 55%)',
          }}
        >
          {proxima ? (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[330px_minmax(0,1fr)_300px] lg:items-center">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <h2 id="citas-proxima-titulo" className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                    Tu próxima cita
                  </h2>
                  <span className="rounded-full bg-[var(--lw-gold)]/15 px-3 py-1 text-xs font-semibold text-[var(--lw-gold)]">
                    {relativoTexto(new Date(proxima.fecha_hora))}
                  </span>
                </div>
                <div className="lw-titulo-heavitas text-[28px] uppercase leading-none">
                  {diaSemanaLargoTexto(new Date(proxima.fecha_hora))}
                </div>
                <div className="text-base text-white/80">{fechaLargaTexto(new Date(proxima.fecha_hora))}</div>
                <div className="font-mono text-2xl font-bold" style={{ color: 'var(--lw-gold)' }}>
                  {formatoHora.format(new Date(proxima.fecha_hora))}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                {(proxima.cita_servicios ?? []).map((s) => (
                  <div key={s.id} className="flex justify-between gap-4">
                    <span className="text-[15px] font-semibold">{s.servicios?.nombre}</span>
                    <span className="shrink-0 text-xs text-white/60">
                      {formatearSoles(s.precio)} · {s.duracion_min ?? 30} min
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-white/60">
                    <User className="h-3.5 w-3.5" />
                    {asistentesPorId.get(proxima.asistente_id) || 'Por asignar'}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-white/60">
                    <Clock className="h-3.5 w-3.5" />
                    {duracionCita(proxima)} min
                  </span>
                  <ChipEstado estado={proxima.estado} />
                  {chipRecompensa(proxima, sellosSet.has(proxima.id))}
                  <ChipSello {...calcularChipsSello(proxima, sellosSet.has(proxima.id))} activo={programa.activo === true} />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-white/60">
                    {proxima.adelanto > 0 ? `Dejaste ${formatearSoles(proxima.adelanto)} de adelanto · total` : 'Total estimado'}
                  </span>
                  <span className="font-mono text-lg font-bold text-white">{formatearSoles(totalCita(proxima))}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCitaAReprogramar(proxima)}
                    disabled={!puedeModificar(proxima, plazoHoras)}
                    className={CLASE_BOTON_SECUNDARIO}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Reprogramar
                  </button>
                  <button
                    type="button"
                    onClick={() => setCitaACancelar(proxima)}
                    disabled={!puedeModificar(proxima, plazoHoras)}
                    className={CLASE_BOTON_SECUNDARIO_ROJO}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                  {mapsUrl ? (
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={CLASE_BOTON_SECUNDARIO}>
                      <MapPin className="h-3.5 w-3.5" />
                      Cómo llegar
                    </a>
                  ) : (
                    <span className={`${CLASE_BOTON_SECUNDARIO} opacity-40`}>Sin dirección</span>
                  )}
                  {whatsapp ? (
                    <a
                      href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre mi cita.')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={CLASE_BOTON_SECUNDARIO}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  ) : (
                    <span className={`${CLASE_BOTON_SECUNDARIO} opacity-40`}>WhatsApp</span>
                  )}
                </div>
                <p className="text-center text-xs text-white/40">
                  Puedes reprogramar o cancelar hasta {plazoHoras} horas antes.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
              <div className="flex flex-col gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">Tu próxima cita</h2>
                <div className="lw-titulo-heavitas text-2xl uppercase">No tienes citas agendadas</div>
                <p className="text-sm text-white/60">Elige tus servicios y reserva el día y la hora que te acomoden.</p>
              </div>
              <div className="flex shrink-0 gap-2.5">
                <Link to="/servicios" className={CLASE_BOTON_SECUNDARIO}>
                  Ver servicios
                </Link>
                <BotonAgendar destino={destinoAgendar} />
              </div>
            </div>
          )}
        </section>

        {/* Calendario | Próximas | (Puntos + Antes) — Historial abajo, a
            todo el ancho. En móvil se apila con `order-*` (ver abajo). */}
        <div className="mt-8 flex flex-col gap-8 lg:grid lg:grid-cols-[400px_minmax(0,1fr)_340px] lg:items-start lg:gap-8">
          {/* Calendario */}
          <section
            aria-labelledby="citas-calendario-titulo"
            className={`order-2 flex flex-col gap-3.5 lg:order-none ${reducirMovimiento ? '' : 'in-left'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA.calendario}ms` }}
          >
            <h2 id="citas-calendario-titulo" className="lw-titulo-heavitas text-base uppercase">
              Calendario
            </h2>
            <div className="liquid-glass flex items-center justify-between rounded-none px-2 py-2.5">
              <button
                type="button"
                onClick={irMesAnterior}
                aria-label="Mes anterior"
                className="p-1.5 text-white/70 transition-colors hover:text-[var(--lw-gold)]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {NOMBRES_MES[mesIndiceActual]} {anioMesActual}
                </span>
                <button
                  type="button"
                  onClick={irHoy}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/70 transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
                >
                  Hoy
                </button>
              </div>
              <button
                type="button"
                onClick={irMesSiguiente}
                aria-label="Mes siguiente"
                className="p-1.5 text-white/70 transition-colors hover:text-[var(--lw-gold)]"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-white/50">
                {DIAS_SEMANA.map((dia) => (
                  <span key={dia}>{dia}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {diasGrilla.map((dia) => {
                  const clave = claveDiaLima(dia)
                  const { mes } = anioMesEnLima(dia)
                  const esDelMes = mes === mesIndiceActual
                  const esHoy = clave === hoyClave
                  const esSeleccionado = clave === diaSeleccionado
                  const tieneCitas = citasPorDiaMes.has(clave)

                  return (
                    <button
                      key={clave}
                      type="button"
                      onClick={() => alternarDia(clave)}
                      className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-sm transition-colors ${
                        esSeleccionado
                          ? 'bg-[var(--lw-gold)] font-semibold text-black'
                          : esHoy
                            ? 'border border-[var(--lw-gold)] text-[var(--lw-gold)]'
                            : esDelMes
                              ? 'text-white hover:bg-white/5'
                              : 'text-white/30 hover:bg-white/5'
                      }`}
                    >
                      {aLima(dia).getUTCDate()}
                      <span
                        className={`h-1 w-1 rounded-full ${
                          tieneCitas ? (esSeleccionado ? 'bg-black' : 'bg-[var(--lw-gold)]') : 'bg-transparent'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="text-xs text-white/40">Toca un día para ver solo las citas de esa fecha.</p>
          </section>

          {/* Próximas citas / citas del día filtrado */}
          <section
            aria-labelledby="citas-lista-titulo"
            className={`order-1 flex flex-col gap-3.5 lg:order-none ${reducirMovimiento ? '' : 'in-up'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA.listaTitulo}ms` }}
          >
            <div className="flex min-h-[32px] items-center justify-between gap-3">
              <h2 id="citas-lista-titulo" className="lw-titulo-heavitas text-base uppercase">
                <span className="md:hidden">{listaTitulo}</span>
                <span className="hidden md:inline">{listaTituloLargo}</span>
              </h2>
              {diaSeleccionado ? (
                <button
                  type="button"
                  onClick={() => setDiaSeleccionado(null)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 px-3 py-1.5 text-xs font-medium text-[var(--lw-gold)] transition-colors hover:bg-[var(--lw-gold)]/20"
                >
                  Ver todas las próximas <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {diaSeleccionado && cargandoMes ? (
              <p className="text-sm text-white/50">Cargando...</p>
            ) : listaOrdenada.length === 0 ? (
              <div className="flex flex-col items-center gap-2.5 rounded-[10px] border border-white/10 bg-[#111113] py-10 text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <CalendarClock className="h-7 w-7 text-white/25" />
                <p className="text-sm text-white/50">{diaSeleccionado ? 'No tienes citas este día.' : 'No tienes citas próximas.'}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {grupos.map((grupo, indiceGrupo) => {
                  const animarGrupo = !reducirMovimiento && primeraListaRef.current
                  const delayGrupo = ENTRADA.listaBase + indiceGrupo * ENTRADA.listaPaso
                  return (
                    <div
                      key={grupo.clave}
                      className={`flex flex-col gap-2 ${animarGrupo ? 'in-right' : ''}`}
                      style={animarGrupo ? { animationDelay: `${delayGrupo}ms` } : undefined}
                    >
                      <div className="flex items-baseline gap-2.5 text-[13px]">
                        <span className="font-semibold text-white/85">
                          <span className="md:hidden">{grupo.fecha}</span>
                          <span className="hidden md:inline">{grupo.fechaLarga}</span>
                        </span>
                        {grupo.rel && <span className="text-[var(--lw-gold)]">{grupo.rel}</span>}
                      </div>
                      {grupo.items.map((cita) => {
                        const tieneSello = sellosSet.has(cita.id)
                        const chipsSello = calcularChipsSello(cita, tieneSello)
                        const modificable = puedeModificar(cita, plazoHoras)
                        const esCompletada = cita.estado === 'COMPLETADA'
                        const esLaProxima = !diaSeleccionado && proxima?.id === cita.id
                        const { puedeCalificar, calificada, servicioId } = estadoResenaCita(cita, resenasServicioIds)
                        return (
                          <article
                            key={cita.id}
                            className={`flex flex-col gap-2.5 rounded-[10px] border bg-[#111113] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${
                              cita.estado === 'CANCELADA' ? 'opacity-45' : ''
                            } ${
                              esLaProxima ? 'border-[var(--lw-gold)]/45' : 'border-white/10'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className="font-mono text-sm font-bold" style={{ color: 'var(--lw-gold)' }}>
                                  {formatoHora.format(new Date(cita.fecha_hora))}
                                </span>
                                <span className="text-[15px] font-medium">{nombresServicios(cita) || 'Servicio'}</span>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1 sm:self-stretch sm:justify-between">
                                <ChipEstado estado={cita.estado} />
                                <span className="hidden font-mono text-sm font-bold text-white sm:block">{formatearSoles(totalCita(cita))}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex flex-wrap gap-4">
                                <span className="flex items-center gap-1.5 text-xs text-white/60">
                                  <User className="h-3.5 w-3.5" />
                                  {asistentesPorId.get(cita.asistente_id) || 'Por asignar'}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs text-white/60">
                                  <Clock className="h-3.5 w-3.5" />
                                  {duracionCita(cita)} min
                                </span>
                                {chipRecompensa(cita, tieneSello)}
                                <ChipSello {...chipsSello} activo={programa.activo === true} />
                              </div>
                              <span className="font-mono text-sm font-bold text-white sm:hidden">{formatearSoles(totalCita(cita))}</span>
                            </div>
                            {modificable && (
                              <div className="flex gap-2 border-t border-white/10 pt-2.5 sm:justify-end">
                                <button type="button" onClick={() => setCitaAReprogramar(cita)} className={`flex-1 sm:flex-none sm:px-4 ${CLASE_BOTON_SECUNDARIO}`}>
                                  <Pencil className="h-3.5 w-3.5" />
                                  Reprogramar
                                </button>
                                <button type="button" onClick={() => setCitaACancelar(cita)} className={`flex-1 sm:flex-none sm:px-4 ${CLASE_BOTON_SECUNDARIO_ROJO}`}>
                                  <X className="h-3.5 w-3.5" />
                                  Cancelar
                                </button>
                              </div>
                            )}
                            {esCompletada && (
                              <div className="flex gap-2 border-t border-white/10 pt-2.5">
                                {puedeCalificar && (
                                  <Link
                                    to={`/servicios/${servicioId}#resenas`}
                                    className={`flex flex-1 items-center justify-center gap-1.5 ${CLASE_BOTON_SECUNDARIO}`}
                                  >
                                    <Star className="h-3.5 w-3.5" />
                                    Calificar
                                  </Link>
                                )}
                                {calificada && (
                                  <span className="flex flex-1 items-center justify-center text-xs text-white/45">Calificada</span>
                                )}
                                <button type="button" onClick={() => volverAReservar(cita)} className={`flex-1 ${CLASE_BOTON_SECUNDARIO}`}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Volver a reservar
                                </button>
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Puntos */}
          <div
            className={`order-5 lg:order-none ${reducirMovimiento ? '' : 'in-right'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${esDesktop ? DELAY_ASIDE_DESKTOP : DELAY_PUNTOS_MOBILE}ms` }}
          >
            {bloquePuntos()}
          </div>

          {/* Antes de tu cita — a todo el ancho, encima del Historial */}
          <div
            className={`order-3 lg:order-none lg:col-span-3 ${reducirMovimiento ? '' : 'in-up'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${DELAY_ANTES_MOBILE}ms` }}
          >
            {bloqueAntes()}
          </div>

          {/* Historial */}
          <div
            className={`order-4 lg:order-none lg:col-span-3 ${CLASE_BLOQUE} ${reducirMovimiento ? '' : 'in-up'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA.historial}ms` }}
          >
            <button
              type="button"
              onClick={() => setHistAbierto((v) => !v)}
              aria-expanded={histAbierto}
              className="flex w-full items-center gap-3 px-5 py-4 text-left text-white sm:px-6"
            >
              <h2 className="lw-titulo-heavitas text-base uppercase">Historial</h2>
              <span className="flex-1" />
              <ArrowBigDown className={`h-5 w-5 text-white/50 transition-transform ${histAbierto ? 'rotate-180' : ''}`} />
            </button>
            {histAbierto &&
              (historial.length === 0 ? (
                <p className="px-5 pb-6 text-sm text-white/50 sm:px-6">Todavía no tienes citas pasadas.</p>
              ) : (
                <div>
                  {historial.map((cita) => {
                    const tieneSello = sellosSet.has(cita.id)
                    const chips = calcularChipsSello(cita, tieneSello, { historial: true })
                    const { puedeCalificar, calificada, servicioId } = estadoResenaCita(cita, resenasServicioIds)
                    return (
                      <div
                        key={cita.id}
                        className="flex flex-col gap-2.5 border-t border-white/10 px-5 py-3.5 sm:grid sm:grid-cols-[130px_minmax(0,1fr)_140px_100px_220px] sm:items-center sm:gap-4 sm:px-6"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold">{fechaCortaTexto(new Date(cita.fecha_hora))}</span>
                          <span className="font-mono text-xs text-white/50">{formatoHora.format(new Date(cita.fecha_hora))}</span>
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm">{nombresServicios(cita) || 'Servicio'}</span>
                          <span className="text-xs text-white/50">{asistentesPorId.get(cita.asistente_id) || 'Sin asignar'}</span>
                        </div>
                        <div className="flex flex-wrap items-start gap-1.5">
                          <ChipEstado estado={cita.estado} />
                          {cita.estado === 'COMPLETADA' && chipRecompensa(cita, tieneSello, { historial: true })}
                          {chips.sello && programa.activo === false && <ChipSello sello />}
                        </div>
                        <span className="font-mono text-sm font-bold sm:text-right">{formatearSoles(totalCita(cita))}</span>
                        <div className="flex items-center gap-4 sm:justify-end">
                          {puedeCalificar && (
                            <Link
                              to={`/servicios/${servicioId}#resenas`}
                              className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--lw-gold)]"
                            >
                              <Star className="h-3.5 w-3.5" />
                              Calificar
                            </Link>
                          )}
                          {calificada && <span className="text-[13px] text-white/45">Calificada</span>}
                          <button
                            type="button"
                            onClick={() => volverAReservar(cita)}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--lw-gold)]"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Volver a reservar
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
          </div>
        </div>

        {/* Cómo ganas puntos y sellos (programa apagado: heredado · activo: monedas, clasificación y sellos vigentes) */}
        <ComoGanasPuntosYSellos
          programa={programa}
          heredado={{
            cfg: cfgPuntos,
            umbrales: misPuntos ? { premium: umbralPremium, vip: umbralVip } : null,
            sellosMeta,
          }}
          reducirMovimiento={reducirMovimiento}
          retrasoMs={ENTRADA.comoGanas}
        />
      </div>

      <PieClienteWeb />

      {citaAReprogramar && (
        <ModalReprogramarCitaCliente
          cita={citaAReprogramar}
          onCerrar={() => setCitaAReprogramar(null)}
          onReprogramada={(fechaHoraNueva) => {
            setCitaAReprogramar(null)
            mostrarToast('Cita reprogramada.', 'exito')
            irAFecha(fechaHoraNueva)
          }}
        />
      )}

      {citaACancelar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelCancelarRef} className="lw-bar w-full max-w-sm rounded-lg border border-white/10 p-5">
            <h2 className="text-base font-semibold text-white">¿Cancelar esta cita?</h2>
            <p className="mt-1 text-sm text-white/60">
              {formatoHora.format(new Date(citaACancelar.fecha_hora))} — {nombresServicios(citaACancelar) || 'Servicio'}. Esta
              acción no se puede deshacer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCitaACancelar(null)}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                disabled={cancelando}
                className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
