import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Plus, User, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../context/ToastContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../hooks/useModalA11y.js'
import { formatearSoles } from '../../lib/moneda.js'
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
import ModalAgendarCitaCliente from '../../components/ModalAgendarCitaCliente.jsx'
import ModalReprogramarCitaCliente from '../../components/ModalReprogramarCitaCliente.jsx'

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const ETIQUETAS_ESTADO = {
  PENDIENTE: { texto: 'Pendiente', clase: 'bg-[var(--lw-gold)]/15 text-[var(--lw-gold)]' },
  CONFIRMADA: { texto: 'Confirmada', clase: 'bg-blue/15 text-blue' },
  COMPLETADA: { texto: 'Completada', clase: 'bg-green/15 text-green' },
  CANCELADA: { texto: 'Cancelada', clase: 'bg-white/10 text-white/50' },
  NO_ASISTIO: { texto: 'No asistió', clase: 'bg-red/15 text-red' },
}

const formatoHora = new Intl.DateTimeFormat('es-PE', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

// Se puede cancelar/reprogramar hasta 3 horas antes — mismo límite que
// valida cancelar_mi_cita_web()/reprogramar_mi_cita_web() en el servidor;
// acá solo evita mostrar un botón que el servidor igual va a rechazar.
function puedeModificar(cita) {
  if (!['PENDIENTE', 'CONFIRMADA'].includes(cita.estado)) return false
  return new Date(cita.fecha_hora).getTime() - Date.now() > 3 * 60 * 60 * 1000
}

function totalCita(cita) {
  return (cita.cita_servicios ?? []).reduce((suma, item) => suma + (item.precio ?? 0), 0)
}

function nombresServicios(cita) {
  return (cita.cita_servicios ?? []).map((item) => item.servicios?.nombre).filter(Boolean).join(', ')
}

function construirDiasGrilla(mesActual) {
  const { anio, mes } = anioMesEnLima(mesActual)
  const inicioMes = iniciarMesLima(anio, mes)
  const diaSemanaInicio = diaSemanaLima(inicioMes) // 0=domingo … 6=sábado
  const offset = diaSemanaInicio === 0 ? 6 : diaSemanaInicio - 1 // la grilla empieza en lunes
  const primerDiaGrilla = sumarDias(inicioMes, -offset)
  return Array.from({ length: 42 }, (_, i) => sumarDias(primerDiaGrilla, i))
}

// Calendario mensual propio del cliente — mismo espíritu que el de
// Citas.jsx del POS (grilla de 7 columnas, navegación por mes, punto
// indicador de días con citas), pero solo con SUS citas: no hay filtro
// de asistente ni de búsqueda, no tiene sentido con 1-2 citas a la vez.
export default function CitasCliente() {
  const { mostrarToast } = useToast()
  const [mesActual, setMesActual] = useState(() => iniciarDia(new Date()))
  const [citas, setCitas] = useState([])
  const [asistentesPorId, setAsistentesPorId] = useState(() => new Map())
  const [cargando, setCargando] = useState(true)
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => claveDiaLima(new Date()))
  const [mostrarAgendar, setMostrarAgendar] = useState(false)
  const [citaAReprogramar, setCitaAReprogramar] = useState(null)
  const [citaACancelar, setCitaACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const panelCancelarRef = useRef(null)

  useCerrarConEscape(() => setCitaACancelar(null), Boolean(citaACancelar))
  useModalA11y(panelCancelarRef, Boolean(citaACancelar))

  async function cargar() {
    setCargando(true)
    const { anio, mes } = anioMesEnLima(mesActual)
    const inicioMes = iniciarMesLima(anio, mes)
    const finMes = iniciarMesLima(anio, mes + 1)

    const [citasRes, asistentesRes] = await Promise.all([
      supabase
        .from('citas')
        .select(
          'id, fecha_hora, estado, nota, asistente_id, cita_servicios(id, duracion_min, precio, servicios(nombre))',
        )
        .gte('fecha_hora', inicioMes.toISOString())
        .lt('fecha_hora', finMes.toISOString())
        .order('fecha_hora'),
      supabase.rpc('asistentes_para_citas'),
    ])

    setCitas(citasRes.data ?? [])
    setAsistentesPorId(
      new Map((asistentesRes.data ?? []).map((a) => [a.id, a.nombres_completos])),
    )
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesActual])

  const citasPorDia = useMemo(() => {
    const mapa = new Map()
    for (const cita of citas) {
      const clave = claveDiaLima(new Date(cita.fecha_hora))
      if (!mapa.has(clave)) mapa.set(clave, [])
      mapa.get(clave).push(cita)
    }
    return mapa
  }, [citas])

  const diasGrilla = useMemo(() => construirDiasGrilla(mesActual), [mesActual])
  const { anio: anioMesActual, mes: mesIndiceActual } = anioMesEnLima(mesActual)
  const citasDelDia = citasPorDia.get(diaSeleccionado) ?? []
  const hoyClave = claveDiaLima(new Date())

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
    setDiaSeleccionado(claveDiaLima(hoy))
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
    cargar()
  }

  // Bug reportado: tras agendar/reprogramar, el calendario se quedaba
  // mostrando el mes que ya estaba abierto (normalmente el actual) — si
  // la cita nueva caía en otro mes, quedaba invisible hasta navegar ahí
  // a mano; parecía que "no se agendó" aunque el staff sí la veía en el
  // POS. Ahora salta directo al mes/día de la fecha elegida.
  function irAFecha(fechaHoraIso) {
    const fecha = new Date(fechaHoraIso)
    // setMesActual con un Date nuevo siempre dispara el useEffect de
    // arriba (Date se compara por referencia, nunca es "el mismo" objeto
    // que el mesActual anterior) — ese efecto ya llama a cargar() con el
    // mesActual fresco, así que no hace falta llamarlo de nuevo acá.
    setMesActual(iniciarDia(fecha))
    setDiaSeleccionado(claveDiaLima(fecha))
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setMostrarAgendar(true)}
            className="flex items-center gap-1.5 rounded-full border border-[var(--lw-gold)] bg-transparent px-3 py-1.5 text-sm font-semibold text-[var(--lw-gold)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Agendar
          </button>
        </div>

        {/* Navegación de mes */}
        <div className="liquid-glass mt-4 flex items-center justify-between rounded-none px-2 py-2.5">
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

        {/* Grilla mensual */}
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-white/50">
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
            const tieneCitas = citasPorDia.has(clave)

            return (
              <button
                key={clave}
                type="button"
                onClick={() => setDiaSeleccionado(clave)}
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

        {/* Citas del día elegido */}
        <div className="mt-5">
          {cargando ? (
            <p className="text-center text-sm text-white/50">Cargando...</p>
          ) : citasDelDia.length === 0 ? (
            <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-10 text-center">
              <CalendarClock className="h-8 w-8 text-white/30" />
              <p className="text-sm text-white/50">No tienes citas este día.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {citasDelDia.map((cita) => {
                const etiqueta = ETIQUETAS_ESTADO[cita.estado] ?? ETIQUETAS_ESTADO.PENDIENTE
                const modificable = puedeModificar(cita)

                return (
                  <div key={cita.id} className="liquid-glass rounded-none p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-[var(--lw-gold)]">
                          {formatoHora.format(new Date(cita.fecha_hora))}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-white">
                          {nombresServicios(cita) || 'Servicio'}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${etiqueta.clase}`}>
                        {etiqueta.texto}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/60">
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {asistentesPorId.get(cita.asistente_id) || 'Sin asignar'}
                      </span>
                      <span className="font-mono font-semibold text-white">
                        {formatearSoles(totalCita(cita))}
                      </span>
                    </div>

                    {modificable && (
                      <div className="mt-3 flex gap-2 border-t border-white/10 pt-2.5">
                        <button
                          type="button"
                          onClick={() => setCitaAReprogramar(cita)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-1.5 text-xs text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
                        >
                          <Pencil className="h-3 w-3" />
                          Reprogramar
                        </button>
                        <button
                          type="button"
                          onClick={() => setCitaACancelar(cita)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-1.5 text-xs text-red transition-colors hover:border-red"
                        >
                          <X className="h-3 w-3" />
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <PieClienteWeb />

      {mostrarAgendar && (
        <ModalAgendarCitaCliente
          onCerrar={() => setMostrarAgendar(false)}
          onAgendada={(fechaHoraNueva) => {
            setMostrarAgendar(false)
            mostrarToast('Cita agendada.', 'exito')
            irAFecha(fechaHoraNueva)
          }}
        />
      )}

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
              {formatoHora.format(new Date(citaACancelar.fecha_hora))} —{' '}
              {nombresServicios(citaACancelar) || 'Servicio'}. Esta acción no se puede deshacer.
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
