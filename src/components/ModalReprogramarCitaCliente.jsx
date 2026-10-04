import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { leerServicios } from '../lib/buscarServicios.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
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

// Reprograma una cita ya agendada — a pedido del usuario, "reprogramar"
// deja de ser solo cambiar fecha/hora: acá se puede editar TODO lo
// editable de la cita (servicios, asistente, fecha/hora, nota), mismo
// flujo/checklist que ModalAgendarCitaCliente pero precargado con lo
// que la cita ya tenía. reprogramar_mi_cita_web(125_reprogramar_cita_
// web_completa.sql) revalida todo de nuevo en el servidor — esto es
// solo para no dejar mandar un formulario a medio llenar.
export default function ModalReprogramarCitaCliente({ cita, onCerrar, onReprogramada }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)
  const [servicios, setServicios] = useState([])
  const [asistentes, setAsistentes] = useState([])

  const [serviciosSeleccionados, setServiciosSeleccionados] = useState(
    () => new Set((cita.cita_servicios ?? []).map((item) => item.servicio_id).filter(Boolean)),
  )
  const [asistenteId, setAsistenteId] = useState(cita.asistente_id ?? '')
  const [fecha, setFecha] = useState(() => formatearFechaISO(new Date(cita.fecha_hora)))
  const [horarios, setHorarios] = useState([])
  const [cargandoHorarios, setCargandoHorarios] = useState(false)
  const [horarioElegido, setHorarioElegido] = useState(null)
  const [nota, setNota] = useState(cita.nota ?? '')

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true

    Promise.all([
      leerServicios(supabase, { columnas: 'id, nombre, precio, duracion_min', soloActivos: true }).then(
        (data) => ({ data }),
        () => ({ data: [] }),
      ),
      supabase.rpc('asistentes_para_citas'),
    ]).then(([serviciosRes, asistentesRes]) => {
      if (!vigente) return
      setServicios(serviciosRes.data ?? [])
      setAsistentes(asistentesRes.data ?? [])
      setCargandoCatalogo(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  const duracionTotal = useMemo(
    () =>
      servicios
        .filter((s) => serviciosSeleccionados.has(s.id))
        .reduce((suma, s) => suma + (s.duracion_min ?? 30), 0),
    [servicios, serviciosSeleccionados],
  )
  const precioTotal = useMemo(
    () =>
      servicios
        .filter((s) => serviciosSeleccionados.has(s.id))
        .reduce((suma, s) => suma + (s.precio ?? 0), 0),
    [servicios, serviciosSeleccionados],
  )

  // Mañana como mínimo del selector: reprogramar "para ahora mismo" no
  // tiene sentido acá — igual el servidor exige fecha futura.
  const fechaMinima = useMemo(() => formatearFechaISO(new Date(Date.now() + 24 * 60 * 60 * 1000)), [])

  useEffect(() => {
    if (!asistenteId || !fecha || duracionTotal === 0) {
      setHorarios([])
      setHorarioElegido(null)
      return undefined
    }

    let vigente = true
    setCargandoHorarios(true)
    setHorarioElegido(null)

    supabase
      .rpc('horarios_disponibles_cita', {
        p_asistente_id: asistenteId,
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
  }, [asistenteId, fecha, duracionTotal, cita.id])

  function alternarServicio(id) {
    setServiciosSeleccionados((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
    setHorarioElegido(null)
  }

  async function confirmar(evento) {
    evento.preventDefault()
    setError('')

    if (serviciosSeleccionados.size === 0) {
      setError('Elige al menos un servicio.')
      return
    }
    if (!asistenteId) {
      setError('Elige un asistente.')
      return
    }
    if (!horarioElegido) {
      setError('Elige un horario.')
      return
    }

    setGuardando(true)
    const { error: errorRpc } = await supabase.rpc('reprogramar_mi_cita_web', {
      p_cita_id: cita.id,
      p_asistente_id: asistenteId,
      p_nueva_fecha_hora: horarioElegido,
      p_servicio_ids: [...serviciosSeleccionados],
      p_nota: nota.trim() || null,
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
        className="lw-bar max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-white/10 p-5"
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

        {cargandoCatalogo ? (
          <p className="mt-6 text-center text-sm text-white/50">Cargando...</p>
        ) : (
          <form onSubmit={confirmar} className="mt-4 space-y-4">
            <div>
              <EtiquetaCampo obligatorio>Servicios</EtiquetaCampo>
              <div className="space-y-1.5">
                {servicios.map((servicio) => {
                  const marcado = serviciosSeleccionados.has(servicio.id)
                  return (
                    <label
                      key={servicio.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm text-white transition-colors ${
                        marcado
                          ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/10'
                          : 'border-white/15 hover:border-white/30'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternarServicio(servicio.id)}
                          className="h-4 w-4 accent-[var(--lw-gold)]"
                        />
                        {servicio.nombre}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-white/60">
                        {formatearSoles(servicio.precio)} · {servicio.duracion_min ?? 30} min
                      </span>
                    </label>
                  )
                })}
              </div>
              {serviciosSeleccionados.size > 0 && (
                <p className="mt-1.5 text-right text-xs text-white/60">
                  Total:{' '}
                  <span className="font-mono font-semibold text-[var(--lw-gold)]">
                    {formatearSoles(precioTotal)}
                  </span>
                  {' · '}
                  {duracionTotal} min
                </p>
              )}
            </div>

            <div>
              <EtiquetaCampo obligatorio htmlFor="reprogramar-asistente">
                Asistente
              </EtiquetaCampo>
              <select
                id="reprogramar-asistente"
                value={asistenteId}
                onChange={(evento) => {
                  setAsistenteId(evento.target.value)
                  setHorarioElegido(null)
                }}
                className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
              >
                <option value="">Selecciona un asistente</option>
                {asistentes.map((asistente) => (
                  <option key={asistente.id} value={asistente.id}>
                    {asistente.nombres_completos}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <EtiquetaCampo obligatorio htmlFor="reprogramar-fecha">
                Fecha
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
              {!asistenteId || duracionTotal === 0 ? (
                <p className="text-sm text-white/50">Elige servicios y asistente para ver horarios.</p>
              ) : cargandoHorarios ? (
                <p className="text-sm text-white/50">Buscando horarios...</p>
              ) : horarios.length === 0 ? (
                <p className="text-sm text-white/50">
                  No hay horarios disponibles ese día. Prueba con otra fecha.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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

            <div>
              <EtiquetaCampo htmlFor="reprogramar-nota">Nota (opcional)</EtiquetaCampo>
              <textarea
                id="reprogramar-nota"
                value={nota}
                onChange={(evento) => setNota(evento.target.value)}
                placeholder="Algo que quieras avisar antes de tu cita"
                rows={2}
                className="w-full resize-none rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
              />
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
        )}
      </div>
    </div>
  )
}
