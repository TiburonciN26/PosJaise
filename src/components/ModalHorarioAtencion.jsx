import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { olvidarHorario } from '../lib/datosNegocioWeb.js'
import { normalizarSemana } from '../lib/horarioAtencion.js'
import EditorTurnosSemana from './EditorTurnosSemana.jsx'
import { estadoInicialTurnos, turnosAGuardar, validarTurnos } from '../lib/turnosSemana.js'

// Horario de atención de la WEB por día, con un horario y un segundo OPCIONAL (p. ej. 10:00-13:00 y 15:00-20:30). Lo
// abre la administradora desde Web › Contacto Web (ContactoWeb.jsx); por eso usa el color azul-metal de esa pestaña.
// No es la apertura/cierre automático del POS (ModalHorarioPos.jsx, menú de usuario). Se guarda con
// guardar_horario_atencion() (migración 20261112000004), que repite las validaciones y deja auditoría por día.
// Lo usan la web (Inicio, pie, Nosotros, Citas, carritos) y el servidor al aceptar citas y pedidos web.

export default function ModalHorarioAtencion({ onCerrar }) {
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)

  const [dias, setDias] = useState(null)
  const [errorCarga, setErrorCarga] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar, !guardando)

  useEffect(() => {
    let vigente = true
    supabase.rpc('horario_atencion_semanal').then(({ data, error: errorLectura }) => {
      if (!vigente) return
      if (errorLectura) {
        setErrorCarga(true)
        return
      }
      setDias(estadoInicialTurnos(normalizarSemana(data)))
    })
    return () => {
      vigente = false
    }
  }, [])

  async function guardar(evento) {
    evento.preventDefault()
    const problema = validarTurnos(dias)
    if (problema) {
      setError(problema)
      return
    }
    setGuardando(true)
    setError(null)
    const { error: errorGuardado } = await supabase.rpc('guardar_horario_atencion', {
      p_dias: dias.map((d) => {
        const [t1, t2] = turnosAGuardar(d)
        return {
          dia: d.dia,
          bloque1_inicio: t1?.inicio ?? null,
          bloque1_fin: t1?.fin ?? null,
          bloque2_inicio: t2?.inicio ?? null,
          bloque2_fin: t2?.fin ?? null,
        }
      }),
    })
    setGuardando(false)
    if (errorGuardado) {
      // P0001/42501: mensajes del servidor pensados para mostrarse (validación por día, solo la administradora).
      const legible = errorGuardado.code === 'P0001' || errorGuardado.code === '42501'
      setError({ dia: null, mensaje: legible ? errorGuardado.message : 'No se pudo guardar el horario. Intenta de nuevo.' })
      return
    }
    olvidarHorario()
    mostrarToast('Horario de atención guardado.', 'exito')
    onCerrar()
  }

  const diasAbiertos = dias?.filter((d) => d.activo).length ?? 0

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-azul-metal)' }}
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Horario de atención</h2>
        <p className="mt-1 text-sm text-ink/60">
          Elige los días que atiende el negocio y su horario. Tus clientas lo ven en la web y solo podrán reservar citas o
          pedir entregas dentro de este horario.
        </p>

        {errorCarga ? (
          <p className="mt-4 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            No se pudo cargar el horario. Cierra y vuelve a intentarlo.
          </p>
        ) : !dias ? (
          <p className="mt-4 font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="-mx-1 mt-4 min-h-0 flex-1 overflow-y-auto px-1">
            <EditorTurnosSemana
              dias={dias}
              onCambiar={(nuevos) => {
                setError(null)
                setDias(nuevos)
              }}
              diaConError={error?.dia ?? null}
              acento="azul-metal"
            />
          </div>
        )}

        {dias && diasAbiertos === 0 && (
          <p className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink/80">
            Con todos los días cerrados nadie podrá reservar citas ni pedir entregas desde la web.
          </p>
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
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-azul-metal hover:text-azul-metal disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || !dias}
            className="flex-1 rounded-lg bg-azul-metal py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      </form>
    </div>
  )
}
