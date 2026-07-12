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
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { aLima, calcularRango, claveDiaLima, esHoyLima, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'

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

function montoDeRegistro(registro, esAdmin) {
  return esAdmin ? registro.precio : (registro.pago_asistente ?? 0)
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

  const [filtro, setFiltro] = useState('hoy')
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

  const [modalRegistro, setModalRegistro] = useState(null) // null | 'nuevo' | registro
  const [registroAEliminar, setRegistroAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [registroACancelar, setRegistroACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)

  useCerrarConEscape(() => setRegistroAEliminar(null), Boolean(registroAEliminar))
  useCerrarConEscape(() => setRegistroACancelar(null), Boolean(registroACancelar))

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
            total: esAdmin ? (filaResumen.total_precio ?? 0) : (filaResumen.total_pago_asistente ?? 0),
          }
        : RESUMEN_VACIO,
    )
    setCargando(false)
  }

  async function cargarMasRegistros() {
    if (cargandoMas || !hayMas || filtroActivo) return
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const { data, error: errorMas } = await construirConsultaRegistros(desde, hasta).range(
      registros.length,
      registros.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)

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
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarRegistros(vigente, silencioso)
    if (!silencioso) setDiasAbiertos(new Set())
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

  const registrosFiltrados = busqueda.trim()
    ? registros.filter((r) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          (r.servicios?.nombre ?? '').toLowerCase().includes(texto) ||
          (r.clientes?.nombre ?? '').toLowerCase().includes(texto)
        )
      })
    : registros

  const grupos = agruparPorDia(registrosFiltrados)

  return (
    <div className="p-3 pb-6">
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
      <div className="mt-3 flex items-center justify-between gap-2">
        {/* Resumen del período: viene del RPC resumen_mi_panel, no del array
            cargado — así sigue exacto aunque la lista de abajo esté paginada. */}
        <div className="flex flex-1 items-center gap-3 text-sm">
          <span className="text-ink/60">
            Atenciones: <span className="font-mono font-semibold text-ink">{resumen.cantidad}</span>
          </span>
          <span className="text-ink/60">
            Total: <span className="font-mono font-semibold text-green">{formatearSoles(resumen.total)}</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setModalRegistro('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Registrar atención</span>
        </button>
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
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando atenciones...</p>
      ) : registrosFiltrados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          {busqueda.trim()
            ? 'No se encontraron atenciones.'
            : 'No hay atenciones registradas en este período.'}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {grupos.map((grupo) => {
            const abierto = diasAbiertos.has(grupo.clave)
            const registrosActivosDia = grupo.registros.filter((r) => r.estado !== 'CANCELADO')
            const totalDia = sumarMontos(registrosActivosDia, (r) => montoDeRegistro(r, esAdmin))

            return (
              <div key={grupo.clave} className="rounded-lg border border-border bg-surface">
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
                      // B4 de la 3ª auditoría: la RLS de registro_servicios_update
                      // solo deja a un no-admin cancelar atenciones de HOY (mismo
                      // criterio que es_hoy() en el servidor) — antes el botón
                      // aparecía igual en días pasados y el intento fallaba con
                      // un toast de error confuso.
                      const puedeCancelar = esAdmin || esHoyLima(new Date(registro.fecha))

                      return (
                        <div
                          key={registro.id}
                          className={`rounded-lg p-2.5 ${
                            cancelado ? 'border border-red/40 bg-red/5' : 'bg-surface-2'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={`min-w-0 truncate text-sm font-medium ${
                                cancelado ? 'text-red line-through' : 'text-ink'
                              }`}
                            >
                              {registro.servicios?.nombre ?? 'Servicio eliminado'}
                            </p>

                            {cancelado ? (
                              <span className="shrink-0 rounded-full bg-red/15 px-2 py-0.5 text-[10px] font-medium text-red">
                                Cancelada
                              </span>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                {esAdmin && (
                                  <span className="font-mono text-sm text-ink">
                                    {formatearSoles(registro.precio)}
                                  </span>
                                )}
                                {esAdmin && (
                                  <BotonAccion
                                    icono={Pencil}
                                    texto="Editar"
                                    color="celeste"
                                    onClick={() => setModalRegistro(registro)}
                                  />
                                )}
                                {puedeCancelar && (
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
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-3 text-xs text-ink/60">
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
                              {esAdmin && !cancelado && (
                                tieneComision ? (
                                  <span className="flex items-center gap-1 text-yellow-300">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {registro.porcentaje_aplicado}%
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-orange-400">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Sin % asignado
                                  </span>
                                )
                              )}
                            </div>

                            {!cancelado &&
                              (tieneComision ? (
                                <span className="shrink-0 rounded-full bg-green/15 px-2 py-0.5 font-mono text-xs font-semibold text-green">
                                  Mi pago: {formatearSoles(registro.pago_asistente)}
                                </span>
                              ) : (
                                !esAdmin && (
                                  <span className="shrink-0 text-xs text-orange-400">
                                    Sin comisión asignada
                                  </span>
                                )
                              ))}
                          </div>

                          {registro.nota && (
                            <p className="mt-1.5 truncate text-xs text-ink/60">{registro.nota}</p>
                          )}
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
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
