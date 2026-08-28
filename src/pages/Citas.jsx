import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  Check,
  CheckCheck,
  X,
  UserX,
  Pencil,
  Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aLima, iniciarDia, sumarDias, diaSemanaLima, aInputDatetimeLima } from '../lib/fechas.js'
import { formatearSoles } from '../lib/moneda.js'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import ModalCita from '../components/ModalCita.jsx'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'

const HORA_INICIO = 8
const HORA_FIN = 21
const SLOT_MIN = 30
const TOTAL_SLOTS = ((HORA_FIN - HORA_INICIO) * 60) / SLOT_MIN
const ROW_H = 40 // px por slot de 30 min

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
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

function inicioSemanaLima(fecha) {
  const dia = diaSemanaLima(fecha)
  const diasDesdeLunes = dia === 0 ? 6 : dia - 1
  return sumarDias(iniciarDia(fecha), -diasDesdeLunes)
}

function claveDia(fecha) {
  const l = aLima(fecha)
  return `${l.getUTCFullYear()}-${l.getUTCMonth()}-${l.getUTCDate()}`
}

function formatearHora(fechaIso) {
  const l = aLima(new Date(fechaIso))
  const h = l.getUTCHours()
  const m = String(l.getUTCMinutes()).padStart(2, '0')
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${h < 12 ? 'a.m.' : 'p.m.'}`
}

function calcularPosicion(cita) {
  const l = aLima(new Date(cita.fecha_hora))
  const minutosDesdeInicio = (l.getUTCHours() - HORA_INICIO) * 60 + l.getUTCMinutes()
  const slotInicioCrudo = Math.round(minutosDesdeInicio / SLOT_MIN)
  const slotInicio = Math.min(Math.max(slotInicioCrudo, 0), TOTAL_SLOTS - 1)
  const span = Math.min(
    Math.max(Math.round((cita.duracion_min ?? 30) / SLOT_MIN), 1),
    TOTAL_SLOTS - slotInicio,
  )
  return { slotInicio, span }
}

const SELECT_CITAS =
  'id, cliente_id, servicio_id, asistente_id, fecha_hora, duracion_min, estado, nota, ' +
  'clientes(nombre), servicios(nombre, precio, duracion_min), asistentes(nombres_completos)'

function EjeHoras() {
  const horas = []
  for (let h = HORA_INICIO; h <= HORA_FIN; h++) {
    horas.push(h)
  }
  return (
    <div className="relative w-11 shrink-0" style={{ height: TOTAL_SLOTS * ROW_H }}>
      {horas.map((h) => (
        <span
          key={h}
          className="absolute -translate-y-1/2 font-mono text-[10px] text-ink/50"
          style={{ top: (h - HORA_INICIO) * 2 * ROW_H }}
        >
          {String(h).padStart(2, '0')}:00
        </span>
      ))}
    </div>
  )
}

function ColumnaDia({ citasDelDia, onSeleccionar }) {
  const lineas = []
  for (let h = HORA_INICIO; h <= HORA_FIN; h++) {
    lineas.push(h)
  }
  return (
    <div
      className="relative flex-1 border-l border-border"
      style={{ height: TOTAL_SLOTS * ROW_H, minWidth: '7.5rem' }}
    >
      {lineas.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-border/60"
          style={{ top: (h - HORA_INICIO) * 2 * ROW_H }}
        />
      ))}
      {citasDelDia.map((cita) => {
        const { slotInicio, span } = calcularPosicion(cita)
        const estado = ESTADOS[cita.estado] ?? ESTADOS.PENDIENTE
        return (
          <button
            key={cita.id}
            type="button"
            onClick={() => onSeleccionar(cita)}
            className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left leading-tight transition-opacity hover:opacity-80 ${estado.clase}`}
            style={{ top: slotInicio * ROW_H + 1, height: span * ROW_H - 2 }}
          >
            <p className="truncate text-[11px] font-semibold">
              {formatearHora(cita.fecha_hora)} · {cita.clientes?.nombre ?? 'Cliente'}
            </p>
            {span > 1 && (
              <p className="truncate text-[11px] opacity-80">
                {cita.servicios?.nombre ?? 'Servicio'}
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function Citas({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()

  const [vistaSemana] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  const [fechaCursor, setFechaCursor] = useState(() => new Date())
  const [asistentes, setAsistentes] = useState([])
  const [asistenteFiltro, setAsistenteFiltro] = useState('todas')
  const [citas, setCitas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [modalCita, setModalCita] = useState(null) // null | 'nuevo' | cita
  const [citaSeleccionada, setCitaSeleccionada] = useState(null)
  const [citaACompletar, setCitaACompletar] = useState(null)
  const [citaAEliminar, setCitaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  const panelDetalleRef = useRef(null)
  const panelEliminarRef = useRef(null)
  useCerrarConEscape(() => setCitaSeleccionada(null), Boolean(citaSeleccionada))
  useModalA11y(panelDetalleRef, Boolean(citaSeleccionada))
  useCerrarConEscape(() => setCitaAEliminar(null), Boolean(citaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(citaAEliminar))

  const rango = useMemo(() => {
    return vistaSemana
      ? { desde: inicioSemanaLima(fechaCursor), hasta: sumarDias(inicioSemanaLima(fechaCursor), 7) }
      : { desde: iniciarDia(fechaCursor), hasta: sumarDias(iniciarDia(fechaCursor), 1) }
  }, [fechaCursor, vistaSemana])

  useEffect(() => {
    if (rol !== 'ADMINISTRADOR') return
    supabase
      .from('asistentes')
      .select('id, nombres_completos')
      .eq('activo', true)
      .order('nombres_completos')
      .then(({ data }) => setAsistentes(data ?? []))
  }, [rol])

  async function cargarCitas() {
    setCargando(true)
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

    if (errorConsulta) {
      setError('No se pudieron cargar las citas.')
    } else {
      setError(null)
      setCitas(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return
    cargarCitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, rango.desde.getTime(), rango.hasta.getTime(), asistenteFiltro, rol])

  function irAnterior() {
    setFechaCursor((f) => sumarDias(f, vistaSemana ? -7 : -1))
  }
  function irSiguiente() {
    setFechaCursor((f) => sumarDias(f, vistaSemana ? 7 : 1))
  }
  function irHoy() {
    setFechaCursor(new Date())
  }

  async function cambiarEstado(cita, nuevoEstado) {
    const { error: errorCambio } = await supabase
      .from('citas')
      .update({ estado: nuevoEstado })
      .eq('id', cita.id)

    if (errorCambio) {
      mostrarToast('No se pudo actualizar la cita.', 'error')
      return
    }

    const mensajes = {
      CONFIRMADA: 'Cita confirmada.',
      CANCELADA: 'Cita cancelada.',
      NO_ASISTIO: 'Cita marcada como no asistió.',
    }
    mostrarToast(mensajes[nuevoEstado] ?? 'Cita actualizada.', 'info')
    setCitaSeleccionada(null)
    cargarCitas()
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
    cargarCitas()
  }

  const dias = vistaSemana
    ? Array.from({ length: 7 }, (_, i) => sumarDias(rango.desde, i))
    : [rango.desde]

  const citasPorDia = useMemo(() => {
    const mapa = new Map()
    for (const dia of dias) mapa.set(claveDia(dia), [])
    for (const cita of citas) {
      const clave = claveDia(new Date(cita.fecha_hora))
      if (mapa.has(clave)) mapa.get(clave).push(cita)
    }
    return mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citas, rango.desde.getTime(), vistaSemana])

  const tituloRango = vistaSemana
    ? (() => {
        const finSemana = sumarDias(rango.desde, 6)
        const li = aLima(rango.desde)
        const lf = aLima(finSemana)
        return `${li.getUTCDate()} – ${lf.getUTCDate()} de ${MESES[lf.getUTCMonth()]}`
      })()
    : (() => {
        const l = aLima(fechaCursor)
        return `${DIAS_LARGOS[l.getUTCDay()]} ${l.getUTCDate()} de ${MESES[l.getUTCMonth()]}`
      })()

  return (
    <div className="animate-entrada-pestana p-3 pb-6">
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={irAnterior}
            aria-label="Anterior"
            className="rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={irSiguiente}
            aria-label="Siguiente"
            className="rounded-lg p-2 text-ink/70 hover:bg-surface-2 hover:text-purple-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={irHoy}
          className="shrink-0 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-ink/70 hover:border-purple-300 hover:text-purple-300"
        >
          Hoy
        </button>

        <p className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-ink">
          {tituloRango}
        </p>

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

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-8 text-center font-mono text-sm text-ink/60">Cargando...</p>
      ) : citas.length === 0 ? (
        <EstadoVacio
          icono={CalendarClock}
          mensaje="No hay citas en este rango de fechas."
          accion={{ label: '+ Nueva cita', onClick: () => setModalCita('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div className="flex" style={{ minWidth: vistaSemana ? '52rem' : undefined }}>
            <div className="pt-7">
              <EjeHoras />
            </div>
            <div className="flex flex-1">
              {dias.map((dia) => (
                <div key={claveDia(dia)} className="flex flex-1 flex-col">
                  <p className="sticky top-[3.25rem] z-[5] truncate bg-bg py-1 text-center text-xs font-medium capitalize text-ink/70">
                    {DIAS_CORTOS[aLima(dia).getUTCDay()]} {aLima(dia).getUTCDate()}
                  </p>
                  <ColumnaDia
                    citasDelDia={citasPorDia.get(claveDia(dia)) ?? []}
                    onSeleccionar={setCitaSeleccionada}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <BotonFlotanteAgregar onClick={() => setModalCita('nuevo')} color="morado" label="Nueva cita" />

      {modalCita && (
        <ModalCita
          cita={modalCita === 'nuevo' ? null : modalCita}
          fechaSugerida={fechaCursor}
          onCerrar={() => setModalCita(null)}
          onGuardado={() => {
            const esNueva = modalCita === 'nuevo'
            setModalCita(null)
            mostrarToast(esNueva ? 'Cita agendada.' : 'Cita actualizada.', 'exito')
            cargarCitas()
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
            cargarCitas()
          }}
        />
      )}

      {citaSeleccionada && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={panelDetalleRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5"
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
              <p>{citaSeleccionada.servicios?.nombre ?? 'Servicio'}</p>
              <p className="font-mono text-xs">
                {formatearHora(citaSeleccionada.fecha_hora)} · {citaSeleccionada.duracion_min} min
              </p>
              <p className="text-xs">
                Asistente: {citaSeleccionada.asistentes?.nombres_completos ?? 'Sin asignar'}
              </p>
              {citaSeleccionada.servicios?.precio != null && (
                <p className="font-mono text-xs">{formatearSoles(citaSeleccionada.servicios.precio)}</p>
              )}
              {citaSeleccionada.nota && (
                <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
                  {citaSeleccionada.nota}
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {citaSeleccionada.estado === 'PENDIENTE' && (
                <button
                  type="button"
                  onClick={() => cambiarEstado(citaSeleccionada, 'CONFIRMADA')}
                  className="flex items-center gap-1.5 rounded-lg border border-blue/50 px-3 py-1.5 text-xs font-medium text-blue hover:bg-blue/10"
                >
                  <Check className="h-3.5 w-3.5" /> Confirmar
                </button>
              )}

              {(citaSeleccionada.estado === 'PENDIENTE' || citaSeleccionada.estado === 'CONFIRMADA') && (
                <>
                  <button
                    type="button"
                    onClick={() => setCitaACompletar(citaSeleccionada)}
                    className="flex items-center gap-1.5 rounded-lg border border-green/50 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/10"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Completar
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'NO_ASISTIO')}
                    className="flex items-center gap-1.5 rounded-lg border border-red/50 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10"
                  >
                    <UserX className="h-3.5 w-3.5" /> No asistió
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(citaSeleccionada, 'CANCELADA')}
                    className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink/70 hover:border-red hover:text-red"
                  >
                    <X className="h-3.5 w-3.5" /> Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalCita(citaSeleccionada)}
                    className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink/70 hover:border-purple-300 hover:text-purple-300"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                </>
              )}

              {rol === 'ADMINISTRADOR' && (
                <button
                  type="button"
                  onClick={() => setCitaAEliminar(citaSeleccionada)}
                  className="flex items-center gap-1.5 rounded-lg border border-red/50 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCitaSeleccionada(null)}
              className="mt-4 w-full rounded-lg border border-border-strong py-2 text-sm text-ink hover:border-purple-300 hover:text-purple-300"
            >
              Cerrar
            </button>
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
    </div>
  )
}
