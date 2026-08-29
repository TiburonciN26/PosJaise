import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowBigDown,
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
              href={`https://wa.me/${numeroWhatsapp(cliente.telefono)}`}
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
  'id, cliente_id, servicio_id, asistente_id, fecha_hora, duracion_min, estado, nota, ' +
  'clientes(nombre), servicios(nombre, precio, duracion_min), asistentes(nombres_completos)'

export default function Citas({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()

  const [fechaCursor, setFechaCursor] = useState(() => new Date())
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => new Date())
  const [asistentes, setAsistentes] = useState([])
  const [asistenteFiltro, setAsistenteFiltro] = useState('todas')
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

  function cerrarBusqueda() {
    setBusquedaAbierta(false)
    setBusquedaCitas('')
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
    if (rol !== 'ADMINISTRADOR') return
    supabase
      .from('asistentes')
      .select('id, nombres_completos')
      .eq('activo', true)
      .order('nombres_completos')
      .then(({ data }) => setAsistentes(data ?? []))
  }, [rol])

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

    if (rol === 'ADMINISTRADOR' && asistenteFiltro !== 'todas') {
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
  const citasPorDia = useMemo(() => {
    const mapa = new Map()
    for (const cita of citas) {
      const clave = claveDia(new Date(cita.fecha_hora))
      if (!mapa.has(clave)) mapa.set(clave, [])
      mapa.get(clave).push(cita)
    }
    return mapa
  }, [citas])

  // Una sola vez por render, no por cada una de las ~35 celdas de la grilla.
  const claveHoy = claveDia(new Date())
  const claveSeleccionada = diaSeleccionado ? claveDia(diaSeleccionado) : null

  const citasDelDiaSeleccionado = diaSeleccionado
    ? (citasPorDia.get(claveDia(diaSeleccionado)) ?? [])
    : []

  const cumpleanosDelDiaSeleccionado = diaSeleccionado
    ? (cumpleanosPorDia.get(claveMesDia(aLima(diaSeleccionado).getUTCMonth(), aLima(diaSeleccionado).getUTCDate())) ?? [])
    : []

  // Busca solo dentro de las citas ya cargadas del mes visible (sin ida
  // extra al servidor) — por nombre de cliente o de servicio.
  const citasFiltradas = busquedaCitas.trim()
    ? citas.filter((cita) => {
        const texto = busquedaCitas.trim().toLowerCase()
        return (
          (cita.clientes?.nombre ?? '').toLowerCase().includes(texto) ||
          (cita.servicios?.nombre ?? '').toLowerCase().includes(texto)
        )
      })
    : []

  const tituloRango = `${MESES[mesCursor]} ${anioCursor}`

  return (
    <div className="animate-entrada-pestana p-3 pb-6">
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
              onClick={irHoy}
              className="shrink-0 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-ink/70 hover:border-purple-300 hover:text-purple-300"
            >
              Hoy
            </button>

            {rol === 'ADMINISTRADOR' && (
              <select
                value={asistenteFiltro}
                onChange={(evento) => setAsistenteFiltro(evento.target.value)}
                className="shrink-0 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-purple-300"
              >
                <option value="todas">Todas</option>
                {asistentes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombres_completos}
                  </option>
                ))}
              </select>
            )}

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
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">
                        {cita.clientes?.nombre ?? 'Cliente'} · {cita.servicios?.nombre ?? 'Servicio'}
                      </p>
                      <p className="font-mono text-xs text-ink/60">
                        {l.getUTCDate()} de {MESES[l.getUTCMonth()]} · {formatearHora(cita.fecha_hora)}
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
          {/* Grilla mensual */}
          <div className="mt-4">
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
                        {citasDia.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-blue" />}
                        {cumpleanosDia.length > 0 && <Cake className="h-3 w-3 text-amber" />}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Citas del día seleccionado */}
          <div className="mt-4">
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
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-purple-300/50"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm text-ink">
                                {cita.clientes?.nombre ?? 'Cliente'} · {cita.servicios?.nombre ?? 'Servicio'}
                              </p>
                              <p className="font-mono text-xs text-ink/60">
                                {formatearHora(cita.fecha_hora)}
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
          valoresIniciales={{
            servicioId: citaACompletar.servicio_id ?? '',
            clienteId: citaACompletar.cliente_id ?? '',
            precio: citaACompletar.servicios?.precio != null ? String(citaACompletar.servicios.precio) : '',
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
                {citaSeleccionada.clientes?.nombre ?? 'Cliente'}
              </h2>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  (ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).clase
                }`}
              >
                {(ESTADOS[citaSeleccionada.estado] ?? ESTADOS.PENDIENTE).label}
              </span>
            </div>

            <div className="mt-3 space-y-1.5 text-sm text-ink/70">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{citaSeleccionada.servicios?.nombre ?? 'Servicio'}</span>
                <span className="flex shrink-0 items-center gap-1 font-mono text-xs">
                  <Timer className="h-3.5 w-3.5 text-ink/40" />
                  {citaSeleccionada.duracion_min} min
                </span>
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
              </div>
              {citaSeleccionada.servicios?.precio != null && (
                <p className="font-mono text-xs">{formatearSoles(citaSeleccionada.servicios.precio)}</p>
              )}
              <p className="text-xs">
                Asistente: {citaSeleccionada.asistentes?.nombres_completos ?? 'Sin asignar'}
              </p>
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
                    onClick={() => setCitaACompletar(citaSeleccionada)}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-green/50 px-2 py-1.5 text-xs font-medium text-green hover:bg-green/10"
                  >
                    <CheckCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Completar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'NO_ASISTIO')}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red/50 px-2 py-1.5 text-xs font-medium text-red hover:bg-red/10"
                  >
                    <UserX className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">No asistió</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'CANCELADA')}
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-xs font-medium text-ink/70 hover:border-red hover:text-red"
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Cancelar</span>
                  </button>
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

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setCitaSeleccionada(null)}
                  className="rounded-lg border border-border-strong px-4 py-2 text-sm text-ink hover:border-purple-300 hover:text-purple-300"
                >
                  Cerrar
                </button>
                <BotonAccion
                  icono={Pencil}
                  texto="Editar"
                  color="celeste"
                  onClick={() => setModalCita(citaSeleccionada)}
                />
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
