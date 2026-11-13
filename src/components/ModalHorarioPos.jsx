import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { normalizarHorarioPos } from '../lib/horarioPos.js'
import EditorTurnosSemana from './EditorTurnosSemana.jsx'
import { estadoInicialTurnos, turnosAGuardar, validarTurnos } from '../lib/turnosSemana.js'
import Interruptor from './Interruptor.jsx'

// Apertura y cierre AUTOMÁTICO del negocio para el personal del POS (cajera, asistente, encargada, personal de apoyo):
// al inicio de cada horario el interruptor «Negocio abierto» se prende solo y al fin se apaga (con dos horarios, el
// negocio se cierra en el descanso). Con el negocio cerrado el personal no puede ingresar ni registrar nada; la
// administradora siempre entra. Lo abre SOLO la administradora desde su menú de usuario. Se guarda con
// guardar_horario_pos() (migraciones 20261112000005/06); el servidor lo aplica cada minuto con pg_cron.
// No es el horario de la web: ese está en Web › Contacto Web (ModalHorarioAtencion).

export default function ModalHorarioPos({ onCerrar }) {
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)

  const [automatico, setAutomatico] = useState(false)
  const [dias, setDias] = useState(null)
  const [errorCarga, setErrorCarga] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar, !guardando)

  useEffect(() => {
    let vigente = true
    supabase.rpc('horario_pos_config').then(({ data, error: errorLectura }) => {
      if (!vigente) return
      if (errorLectura) {
        setErrorCarga(true)
        return
      }
      const config = normalizarHorarioPos(data)
      setAutomatico(config.automatico)
      setDias(estadoInicialTurnos(config.dias))
    })
    return () => {
      vigente = false
    }
  }, [])

  async function guardar(evento) {
    evento.preventDefault()
    // Con el modo manual los días no se editan: se guardan tal cual (sin validar lo que no se puede tocar).
    const problema = automatico ? validarTurnos(dias) : null
    if (problema) {
      setError(problema)
      return
    }
    setGuardando(true)
    setError(null)
    const { data: quedoAbierto, error: errorGuardado } = await supabase.rpc('guardar_horario_pos', {
      p_automatico: automatico,
      p_dias: dias.map((d) => {
        const [t1, t2] = turnosAGuardar(d)
        return {
          dia: d.dia,
          apertura: t1?.inicio ?? null,
          cierre: t1?.fin ?? null,
          apertura2: t2?.inicio ?? null,
          cierre2: t2?.fin ?? null,
        }
      }),
    })
    setGuardando(false)
    if (errorGuardado) {
      const legible = errorGuardado.code === 'P0001' || errorGuardado.code === '42501'
      setError({ dia: null, mensaje: legible ? errorGuardado.message : 'No se pudo guardar el horario. Intenta de nuevo.' })
      return
    }
    // El interruptor del menú se actualiza solo (Realtime de estado_negocio).
    mostrarToast(
      !automatico
        ? 'Horario guardado. La apertura y el cierre siguen siendo manuales.'
        : quedoAbierto
          ? 'Horario guardado. Según el horario, el negocio quedó abierto.'
          : 'Horario guardado. Según el horario, el negocio quedó cerrado.',
      'exito',
    )
    onCerrar()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-amber)' }}
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Apertura y cierre del negocio</h2>
        <p className="mt-1 text-sm text-ink/60">
          Al inicio de cada horario el negocio se abre solo y al final se cierra. Con el negocio cerrado el personal no
          puede ingresar ni registrar nada; tú siempre puedes entrar.
        </p>

        {errorCarga ? (
          <p className="mt-4 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            No se pudo cargar el horario. Cierra y vuelve a intentarlo.
          </p>
        ) : !dias ? (
          <p className="mt-4 font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setAutomatico((valor) => !valor)
              }}
              aria-pressed={automatico}
              className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-border-strong bg-bg px-3 py-2 text-left text-sm text-ink transition-colors hover:border-amber"
            >
              <span>
                <span className="block font-medium">Apertura y cierre automático</span>
                <span className="block text-xs text-ink/60">
                  {automatico
                    ? 'Activado: el negocio sigue este horario.'
                    : 'Apagado: abres y cierras tú a mano. Actívalo para editar los días.'}
                </span>
              </span>
              <Interruptor activado={automatico} colorActivado="bg-green" />
            </button>

            <div className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
              <EditorTurnosSemana
                dias={dias}
                onCambiar={(nuevos) => {
                  setError(null)
                  setDias(nuevos)
                }}
                diaConError={error?.dia ?? null}
                deshabilitado={!automatico}
                acento="amber"
                textoActivo="Se abre"
                textoInactivo="No se abre"
              />
            </div>

            {automatico && (
              <p className="mt-3 text-xs text-ink/60">
                Al guardar, el negocio se abre o se cierra según este horario. Puedes seguir abriendo o cerrando a mano
                desde el menú: tu cambio dura hasta la siguiente hora programada.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error.mensaje}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong bg-bg py-2 text-sm text-ink transition-colors hover:border-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || !dias}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      </form>
    </div>
  )
}
