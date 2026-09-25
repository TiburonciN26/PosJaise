import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearFechaISO } from '../lib/fechas.js'

const formatoHora = new Intl.DateTimeFormat('es-PE', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

// Etiqueta propia (no la Etiqueta.jsx compartida con el POS, que usa
// text-ink/60 — un token atado al switch claro/oscuro global; acá el
// fondo es siempre negro).
function EtiquetaCampo({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

// Reprograma una cita ya agendada: mismo asistente y servicios, solo
// cambia fecha/hora. p_excluir_cita_id en horarios_disponibles_cita
// evita que el propio horario viejo de esta cita cuente como "ocupado".
export default function ModalReprogramarCitaCliente({ cita, onCerrar, onReprogramada }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const duracionTotal = useMemo(
    () => (cita.cita_servicios ?? []).reduce((suma, item) => suma + (item.duracion_min ?? 30), 0),
    [cita],
  )

  const [fecha, setFecha] = useState(() => formatearFechaISO(new Date(cita.fecha_hora)))
  const [horarios, setHorarios] = useState([])
  const [cargandoHorarios, setCargandoHorarios] = useState(false)
  const [horarioElegido, setHorarioElegido] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const fechaMinima = useMemo(() => formatearFechaISO(new Date(Date.now() + 24 * 60 * 60 * 1000)), [])

  useEffect(() => {
    if (!fecha) return undefined
    let vigente = true
    setCargandoHorarios(true)
    setHorarioElegido(null)

    supabase
      .rpc('horarios_disponibles_cita', {
        p_asistente_id: cita.asistente_id,
        p_fecha: fecha,
        p_duracion_min: duracionTotal,
        p_excluir_cita_id: cita.id,
      })
      .then(({ data, error: errorHorarios }) => {
        if (!vigente) return
        setHorarios(errorHorarios ? [] : (data ?? []))
        setCargandoHorarios(false)
      })

    return () => {
      vigente = false
    }
  }, [fecha, cita.asistente_id, cita.id, duracionTotal])

  async function confirmar(evento) {
    evento.preventDefault()
    setError('')

    if (!horarioElegido) {
      setError('Elige un horario.')
      return
    }

    setGuardando(true)
    const { error: errorRpc } = await supabase.rpc('reprogramar_mi_cita_web', {
      p_cita_id: cita.id,
      p_nueva_fecha_hora: horarioElegido,
    })
    setGuardando(false)

    if (errorRpc) {
      setError(errorRpc.message || 'No se pudo reprogramar la cita. Intenta de nuevo.')
      return
    }

    onReprogramada(horarioElegido)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={panelRef}
        className="lw-bar max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-lg border border-white/10 p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">Reprogramar cita</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-2 rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={confirmar} className="mt-4 space-y-4">
          <div>
            <EtiquetaCampo obligatorio htmlFor="reprogramar-fecha">
              Nueva fecha
            </EtiquetaCampo>
            <input
              id="reprogramar-fecha"
              type="date"
              min={fechaMinima}
              value={fecha}
              onChange={(evento) => setFecha(evento.target.value)}
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[var(--lw-gold)]"
            />
          </div>

          <div>
            <EtiquetaCampo obligatorio>Horario</EtiquetaCampo>
            {cargandoHorarios ? (
              <p className="text-sm text-white/50">Buscando horarios...</p>
            ) : horarios.length === 0 ? (
              <p className="text-sm text-white/50">
                No hay horarios disponibles ese día. Prueba con otra fecha.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {horarios.map((h) => {
                  const elegido = horarioElegido === h.inicio
                  return (
                    <button
                      key={h.inicio}
                      type="button"
                      onClick={() => setHorarioElegido(h.inicio)}
                      className={`rounded-lg border px-2 py-1.5 font-mono text-xs transition-colors ${
                        elegido
                          ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] font-semibold text-black'
                          : 'border-white/15 text-white hover:border-white/30'
                      }`}
                    >
                      {formatoHora.format(new Date(h.inicio))}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <div className="flex gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={guardando || !horarioElegido}
              className="flex-1 rounded-lg border border-[var(--lw-gold)] bg-transparent py-2 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
            >
              {guardando ? 'Guardando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
