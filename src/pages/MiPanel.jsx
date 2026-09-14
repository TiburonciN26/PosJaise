import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Trash2,
  Ban,
  Plus,
  ArrowBigDown,
  User,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  UserCircle,
  Eye,
  EyeOff,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { aLima, calcularRango, claveDiaLima, esHoyLima, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'
import { EsqueletoGrupos } from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const OPCION_TODOS = 'todos'
const TAMANO_PAGINA = 50
const SELECT_REGISTROS =
  'id, usuario_id, servicio_id, cliente_id, precio, fecha, nota, estado, porcentaje_aplicado, pago_asistente, servicios(nombre), clientes(nombre), usuarios(nombre_completo)'
const RESUMEN_VACIO = { cantidad: 0, total: 0 }

function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso)
  return new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearTituloDia(fecha) {
  const diaSemana = capitalizar(
    new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'America/Lima' }).format(fecha),
  )
  const dia = String(aLima(fecha).getUTCDate()).padStart(2, '0')
  const mes = capitalizar(
    new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'America/Lima' })
      .format(fecha)
      .replace('.', ''),
  )
  const anio = aLima(fecha).getUTCFullYear()
  return `${diaSemana} ${dia} ${mes} ${anio}`
}

function agruparPorDia(registros) {
  const grupos = new Map()
  for (const registro of registros) {
    const fecha = new Date(registro.fecha)
    const clave = claveDiaLima(fecha)
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha, registros: [] })
    grupos.get(clave).registros.push(registro)
  }
  return Array.from(grupos.values())
}

// mostrarPrecio: true muestra el precio del servicio (ingreso del
// negocio), false muestra lo que le corresponde a la asistente por su %.
// Antes esto era directo esAdmin (el admin siempre veía precio) — pero
// viendo el perfil de UNA asistente puntual (paga por %), un admin
// necesita ver su pago real, no el precio del servicio que cobró el
// negocio (ver filtroEsAsistente).
function montoDeRegistro(registro, mostrarPrecio) {
  return mostrarPrecio ? registro.precio : (registro.pago_asistente ?? 0)
}

function nombreUsuarioDe(registro) {
  const usuarios = registro?.usuarios
  if (!usuarios) return null
  return Array.isArray(usuarios) ? (usuarios[0]?.nombre_completo ?? null) : (usuarios.nombre_completo ?? null)
}

export default function MiPanel({ activo = true }) {
  const { usuario, rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()

  const [filtro, setFiltro] = useState('mes')
  const [personalizado, setPersonalizado] = useState(() => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [registros, setRegistros] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)

  const [asistentesUsuarios, setAsistentesUsuarios] = useState([])
  const [usuarioFiltro, setUsuarioFiltro] = useState(OPCION_TODOS)
  // El admin ve su propio panel por defecto (no "Todos") — solo una vez,
  // apenas se conoce el usuario logeado; si después elige otra opción a
  // mano (otro asistente, o "Todos"), esto no se lo vuelve a pisar.
  const filtroUsuarioInicializado = useRef(false)
  useEffect(() => {
    if (usuario && !filtroUsuarioInicializado.current) {
      filtroUsuarioInicializado.current = true
      setUsuarioFiltro(usuario.id)
    }
  }, [usuario])

  const [modalRegistro, setModalRegistro] = useState(null) // null | 'nuevo' | registro
  const [registroAEliminar, setRegistroAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [registroACancelar, setRegistroACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const [confirmandoId, setConfirmandoId] = useState(null)
  const [ocultarCancelados, setOcultarCancelados] = useState(true)
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set())
  const [registrosAbiertos, setRegistrosAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasRegistros descarte una respuesta que llega tarde de un
  // filtro/búsqueda que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })

  useCerrarConEscape(() => setRegistroAEliminar(null), Boolean(registroAEliminar))
  useCerrarConEscape(() => setRegistroACancelar(null), Boolean(registroACancelar))

  const panelEliminarRef = useRef(null)
  const panelCancelarRef = useRef(null)
  useModalA11y(panelEliminarRef, Boolean(registroAEliminar))
  useModalA11y(panelCancelarRef, Boolean(registroACancelar))

  useEffect(() => {
    if (!esAdmin) return
    supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('rol', 'ASISTENTE')
      .order('nombre_completo')
      .then(({ data }) => setAsistentesUsuarios(data ?? []))
  }, [esAdmin])

  const opcionesFiltroUsuario = [
    { id: OPCION_TODOS, label: 'Todos' },
    ...(usuario ? [{ id: usuario.id, label: `${usuario.nombre_completo} (yo)` }] : []),
    ...asistentesUsuarios.map((a) => ({ id: a.id, label: a.nombre_completo })),
  ]

  // Con búsqueda de texto activa, paginar rompería el resultado (la búsqueda
  // es sobre lo cargado en el cliente; podría "no encontrar" algo que existe
  // más adelante sin traerlo). Ahí se trae el período completo, ya acotado
  // por fecha; sin búsqueda, se pagina de verdad. Mismo criterio que Historial.
  const filtroActivo = Boolean(busquedaDebounced.trim())

  // A quién apunta el resumen del header: el admin puede filtrar por
  // asistente (o "Todos" = null); un no-admin siempre a sí mismo (aunque la
  // RLS ya lo limitaría, se pasa explícito).
  const usuarioIdResumen = esAdmin
    ? usuarioFiltro !== OPCION_TODOS
      ? usuarioFiltro
      : null
    : (usuario?.id ?? null)

  // El admin filtrando por SU PROPIO nombre o "Todos" sigue viendo el
  // precio del servicio (ingreso), como siempre — pero filtrando por una
  // asistente puntual (paga por %, no por precio) necesita ver lo que de
  // verdad le corresponde a ella, no el precio del servicio que cobró el
  // negocio. asistentesUsuarios ya solo trae cuentas rol=ASISTENTE.
  const filtroEsAsistente =
    esAdmin && usuarioFiltro !== OPCION_TODOS && asistentesUsuarios.some((a) => a.id === usuarioFiltro)

  function construirConsultaRegistros(desde, hasta) {
    let consulta = supabase
      .from('registro_servicios')
      .select(SELECT_REGISTROS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (esAdmin && usuarioFiltro !== OPCION_TODOS) {
      consulta = consulta.eq('usuario_id', usuarioFiltro)
    } else if (!esAdmin) {
      consulta = consulta.eq('usuario_id', usuario.id)
    }
    return consulta
  }

  async function cargarRegistros(vigente = { actual: true }, silencioso = false) {
    if (!usuario) return
    if (!silencioso) setCargando(true)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    let consultaLista = construirConsultaRegistros(desde, hasta)
    if (!filtroActivo) consultaLista = consultaLista.range(0, TAMANO_PAGINA - 1)

    const [listaRes, resumenRes] = await Promise.all([
      consultaLista,
      supabase.rpc('resumen_mi_panel', {
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
        p_usuario_id: usuarioIdResumen,
      }),
    ])

    if (!vigente.actual) return

    if (listaRes.error) {
      setError('No se pudo cargar tus atenciones.')
      setRegistros([])
      setHayMas(false)
      setCargando(false)
      return
    }

    setError(null)
    setRegistros(listaRes.data ?? [])
    setHayMas(!filtroActivo && (listaRes.data ?? []).length === TAMANO_PAGINA)

    const filaResumen = resumenRes.data?.[0]
    setResumen(
      filaResumen
        ? {
            cantidad: filaResumen.cantidad ?? 0,
            total:
              esAdmin && !filtroEsAsistente
                ? (filaResumen.total_precio ?? 0)
                : (filaResumen.total_pago_asistente ?? 0),
          }
        : RESUMEN_VACIO,
    )
    setCargando(false)
  }

  async function cargarMasRegistros() {
    if (cargandoMas || !hayMas || filtroActivo) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const { data, error: errorMas } = await construirConsultaRegistros(desde, hasta).range(
      registros.length,
      registros.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más atenciones.', 'error')
      return
    }

    setRegistros((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarRegistros(vigente, silencioso)
    if (!silencioso) {
      setDiasAbiertos(new Set())
      setRegistrosAbiertos(new Set())
    }
    return () => {
      vigente.actual = false
    }
  }, [activo, usuario, filtro, personalizado.desde, personalizado.hasta, usuarioFiltro, filtroActivo])

  function alternarDia(clave) {
    setDiasAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  function alternarRegistro(id) {
    setRegistrosAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function confirmarEliminar() {
    if (!registroAEliminar) return

    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('registro_servicios')
      .delete()
      .eq('id', registroAEliminar.id)
    setEliminando(false)
    setRegistroAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la atención.', 'error')
      return
    }

    mostrarToast('Atención eliminada.', 'exito')
    cargarRegistros()
  }

  async function confirmarCancelar() {
    if (!registroACancelar) return

    setCancelando(true)
    const { error: errorCancelar } = await supabase
      .from('registro_servicios')
      .update({ estado: 'CANCELADO' })
      .eq('id', registroACancelar.id)
    setCancelando(false)
    setRegistroACancelar(null)

    if (errorCancelar) {
      mostrarToast('No se pudo cancelar la atención.', 'error')
      return
    }

    mostrarToast('Atención cancelada.', 'exito')
    cargarRegistros()
  }

  async function confirmarPendiente(registro) {
    if (confirmandoId) return
    setConfirmandoId(registro.id)

    const { error: errorConfirmar } = await supabase
      .from('registro_servicios')
      .update({ estado: 'ACTIVO' })
      .eq('id', registro.id)

    setConfirmandoId(null)

    if (errorConfirmar) {
      // El mensaje del trigger (si todavía no hay % asignado) ya viene
      // redactado para mostrarlo tal cual — mismo texto que usa Citas.
      mostrarToast(errorConfirmar.message || 'No se pudo confirmar la atención.', 'error')
      return
    }

    mostrarToast('Atención confirmada — ya cuenta en tus totales.', 'exito')
    cargarRegistros()
  }

  const registrosFiltrados = busqueda.trim()
    ? registros.filter((r) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          (r.servicios?.nombre ?? '').toLowerCase().includes(texto) ||
          (r.clientes?.nombre ?? '').toLowerCase().includes(texto)
        )
      })
    : registros

  const registrosVisibles = ocultarCancelados
    ? registrosFiltrados.filter((r) => r.estado !== 'CANCELADO')
    : registrosFiltrados

  const grupos = agruparPorDia(registrosVisibles)

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-3xl"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador: fijo arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por servicio o cliente..."
          tema="purple-300"
        />

        {esAdmin && (
          <SelectorOrden
            opciones={opcionesFiltroUsuario}
            valor={usuarioFiltro}
            onCambiar={setUsuarioFiltro}
            tema="purple-300"
            icono={Users}
            ariaLabel="Filtrar por asistente"
          />
        )}
      </div>

      {/* Filtros de fecha */}
      <FiltrosFecha.Botones
        filtro={filtro}
        onCambiarFiltro={setFiltro}
        tema="purple-300"
        className="mt-3"
      />

      {/* Resumen del período + Registrar atención (desktop) */}
      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        {/* Resumen del período: viene del RPC resumen_mi_panel, no del array
            cargado — así sigue exacto aunque la lista de abajo esté paginada.
            Atenciones a la izquierda (a la altura de "N servicios" de cada
            día) y Total a la derecha (a la altura del monto de cada día). */}
        <span className="flex items-center gap-1.5 text-ink/60">
          Atenciones: <span className="font-mono font-semibold text-ink">{resumen.cantidad}</span>
          <button
            type="button"
            onClick={() => setOcultarCancelados((anterior) => !anterior)}
            aria-label={ocultarCancelados ? 'Mostrar canceladas' : 'Ocultar canceladas'}
            title={ocultarCancelados ? 'Mostrar canceladas' : 'Ocultar canceladas'}
            className={`p-1 transition-colors ${
              ocultarCancelados ? 'text-red' : 'text-ink/40 hover:text-purple-300'
            }`}
          >
            {ocultarCancelados ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>

        <div className="flex items-center gap-3">
          <span className="pr-[35px] text-ink/60">
            {filtroEsAsistente ? 'Pago asistente' : 'Total'}:{' '}
            <span className="font-mono font-semibold text-green">{formatearSoles(resumen.total)}</span>
          </span>

          <button
            type="button"
            onClick={() => setModalRegistro('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar atención</span>
          </button>
        </div>
      </div>

      <FiltrosFecha.CamposPersonalizado
        filtro={filtro}
        personalizado={personalizado}
        onCambiarPersonalizado={setPersonalizado}
        tema="purple-300"
      />

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoGrupos />
      ) : registrosFiltrados.length === 0 ? (
        <EstadoVacio
          icono={UserCircle}
          mensaje={
            busqueda.trim()
              ? 'No se encontraron atenciones.'
              : 'No hay atenciones registradas en este período.'
          }
          accion={{ label: '+ Nueva atención', onClick: () => setModalRegistro('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 space-y-3">
          {grupos.map((grupo) => {
            const abierto = diasAbiertos.has(grupo.clave)
            const registrosActivosDia = grupo.registros.filter((r) => r.estado === 'ACTIVO')
            const totalDia = sumarMontos(registrosActivosDia, (r) =>
              montoDeRegistro(r, esAdmin && !filtroEsAsistente),
            )
            const hayPendientesDia = grupo.registros.some((r) => r.estado === 'PENDIENTE_PORCENTAJE')

            return (
              <div
                key={grupo.clave}
                className={`relative border border-border bg-surface transition-colors duration-300 ${
                  abierto ? 'rounded-none border-l-2 border-l-purple-300 bg-purple-300/5' : 'rounded-lg'
                }`}
              >
                {hayPendientesDia && (
                  <span className="absolute -left-1.5 -top-1.5 z-10 h-3 w-3 rounded-full bg-purple-300" />
                )}
                <button
                  type="button"
                  onClick={() => alternarDia(grupo.clave)}
                  className="flex w-full items-center gap-2 p-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="text-sm font-medium text-ink">
                        {formatearTituloDia(grupo.fecha)}
                      </p>
                      <span className="text-xs text-ink/60">
                        {registrosActivosDia.length} servicio
                        {registrosActivosDia.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-purple-300">
                    {formatearSoles(totalDia)}
                  </span>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      abierto ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <CampoColapsable abierto={abierto}>
                  <div className="space-y-2 border-t border-border p-3">
                    {grupo.registros.map((registro) => {
                      const tieneComision =
                        registro.porcentaje_aplicado != null && registro.pago_asistente != null
                      const cancelado = registro.estado === 'CANCELADO'
                      const pendiente = registro.estado === 'PENDIENTE_PORCENTAJE'
                      // B4 de la 3ª auditoría: la RLS de registro_servicios_update
                      // solo deja a un no-admin cancelar atenciones de HOY (mismo
                      // criterio que es_hoy() en el servidor) — antes el botón
                      // aparecía igual en días pasados y el intento fallaba con
                      // un toast de error confuso.
                      const puedeCancelar = esAdmin || esHoyLima(new Date(registro.fecha))
                      const puedeConfirmar = esAdmin || registro.usuario_id === usuario?.id
                      const registroAbierto = registrosAbiertos.has(registro.id)

                      return (
                        <div
                          key={registro.id}
                          className={`rounded-lg ${
                            cancelado
                              ? 'border border-red/40 bg-red/5'
                              : pendiente
                                ? 'border border-orange-400/40 bg-orange-400/5'
                                : 'bg-surface-2'
                          }`}
                        >
                          <div
                            onClick={() => alternarRegistro(registro.id)}
                            onKeyDown={manejarActivacionTeclado(() => alternarRegistro(registro.id))}
                            role="button"
                            tabIndex={0}
                            aria-expanded={registroAbierto}
                            aria-label={registroAbierto ? 'Contraer' : 'Expandir'}
                            className="cursor-pointer p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={`min-w-0 flex-1 truncate text-sm font-medium ${
                                  cancelado
                                    ? 'text-red line-through'
                                    : pendiente
                                      ? 'text-orange-400'
                                      : 'text-ink'
                                }`}
                              >
                                {registro.servicios?.nombre ?? 'Servicio eliminado'}
                              </p>

                              <div className="flex shrink-0 items-center gap-1.5">
                                {cancelado ? (
                                  <span className="rounded-full bg-red/15 px-2 py-0.5 text-[11px] font-medium text-red">
                                    Cancelada
                                  </span>
                                ) : pendiente ? (
                                  <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[11px] font-medium text-orange-400">
                                    Pendiente
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm text-ink">
                                    {formatearSoles(montoDeRegistro(registro, esAdmin && !filtroEsAsistente))}
                                  </span>
                                )}
                                <ArrowBigDown
                                  className={`h-4 w-4 text-ink/60 transition-transform duration-300 ${
                                    registroAbierto ? 'rotate-180' : ''
                                  }`}
                                />
                              </div>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                              {esAdmin && nombreUsuarioDe(registro) && (
                                <span className="flex items-center gap-1 text-purple-300">
                                  <Users className="h-3.5 w-3.5" />
                                  {nombreUsuarioDe(registro)}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <User className="h-3.5 w-3.5 text-ink/60" />
                                {registro.clientes?.nombre ?? 'Cliente eliminado'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5 text-ink/60" />
                                {formatearHora(registro.fecha)}
                              </span>
                            </div>
                          </div>

                          <CampoColapsable abierto={registroAbierto}>
                            <div className="space-y-2 border-t border-border/60 px-2.5 pb-2.5 pt-2">
                              {pendiente && (
                                <div className="flex items-center gap-1.5 rounded-lg bg-orange-400/10 px-2.5 py-1.5 text-xs text-orange-400">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  Pendiente de comisión — no cuenta en tus totales hasta que el
                                  administrador asigne un % y se confirme.
                                </div>
                              )}

                              {!cancelado && !pendiente && (
                                <div className="flex flex-wrap items-center gap-3">
                                  {esAdmin && tieneComision && (
                                    <span className="rounded-full bg-green/15 px-2 py-0.5 font-mono text-xs font-semibold text-green">
                                      Pago asistente: {formatearSoles(registro.pago_asistente)}
                                    </span>
                                  )}
                                  {!esAdmin && !tieneComision && (
                                    <span className="text-xs text-orange-400">
                                      Sin comisión asignada
                                    </span>
                                  )}
                                  {esAdmin &&
                                    (tieneComision ? (
                                      <span className="flex items-center gap-1 text-xs text-yellow-300">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        {registro.porcentaje_aplicado}%
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-xs text-orange-400">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Sin % asignado
                                      </span>
                                    ))}
                                </div>
                              )}

                              {/* Cancelada: solo Eliminar (admin) sigue disponible —
                                  Editar/Cancelar no aplican a una atención ya cancelada. */}
                              {((!cancelado && (esAdmin || puedeCancelar)) ||
                                (cancelado && esAdmin)) && (
                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                  {pendiente && puedeConfirmar && (
                                    <BotonAccion
                                      icono={CheckCircle2}
                                      texto="Confirmar"
                                      color="verde"
                                      onClick={() => confirmarPendiente(registro)}
                                    />
                                  )}
                                  {!cancelado && esAdmin && (
                                    <BotonAccion
                                      icono={Pencil}
                                      texto="Editar"
                                      color="celeste"
                                      onClick={() => setModalRegistro(registro)}
                                    />
                                  )}
                                  {!cancelado && puedeCancelar && (
                                    <BotonAccion
                                      icono={Ban}
                                      texto="Cancelar"
                                      color="rojo"
                                      onClick={() => setRegistroACancelar(registro)}
                                    />
                                  )}
                                  {esAdmin && (
                                    <BotonAccion
                                      icono={Trash2}
                                      texto="Eliminar"
                                      color="rojo"
                                      onClick={() => setRegistroAEliminar(registro)}
                                    />
                                  )}
                                </div>
                              )}

                              {registro.nota && (
                                <p className="text-xs text-ink/60">{registro.nota}</p>
                              )}
                            </div>
                          </CampoColapsable>
                        </div>
                      )
                    })}
                  </div>
                </CampoColapsable>
              </div>
            )
          })}

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasRegistros}
              disabled={cargandoMas}
              className="w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </div>
      )}

      <BotonFlotanteAgregar
        onClick={() => setModalRegistro('nuevo')}
        color="morado"
        label="Registrar atención"
      />

      {modalRegistro && (
        <ModalRegistroAtencion
          registro={modalRegistro === 'nuevo' ? null : modalRegistro}
          onCerrar={() => setModalRegistro(null)}
          onGuardado={() => {
            const esNuevo = modalRegistro === 'nuevo'
            setModalRegistro(null)
            mostrarToast(esNuevo ? 'Atención registrada.' : 'Atención actualizada.', 'exito')
            cargarRegistros()
          }}
        />
      )}

      {registroAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta atención?</h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRegistroAEliminar(null)}
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

      {registroACancelar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Cancelar esta atención?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Quedará marcada como cancelada y no contará en tus totales del período.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRegistroACancelar(null)}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
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
