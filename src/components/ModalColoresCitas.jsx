import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { CLAVES_COLOR_CITA, REGEX_COLOR, estiloTarjetaCita } from '../lib/coloresCitas.js'

// Configuración de colores de las tarjetas de cita por rol de quien la agendó (+ Cliente Web). Solo la abre la
// administradora desde la cabecera de Citas. Guarda con guardar_colores_citas() (migración 20261112000009), que repite la
// validación de formato y de rol en el servidor.

export default function ModalColoresCitas({ coloresIniciales, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)

  // Lo que se escribe a mano puede quedar a medias (#A8); se valida recién al guardar.
  const [colores, setColores] = useState(() => ({ ...coloresIniciales }))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mientras guarda, Esc no cierra; el modal sigue en la pila para que tampoco cierre el de abajo.
  useCerrarConEscape(() => {
    if (!guardando) onCerrar()
  })

  function cambiar(clave, valor) {
    setError(null)
    setColores((anterior) => ({ ...anterior, [clave]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()
    const invalido = CLAVES_COLOR_CITA.find(({ clave }) => !REGEX_COLOR.test(colores[clave] ?? ''))
    if (invalido) {
      setError(`El color de «${invalido.label}» debe tener el formato #RRGGBB.`)
      return
    }
    setGuardando(true)
    setError(null)
    const aGuardar = Object.fromEntries(CLAVES_COLOR_CITA.map(({ clave }) => [clave, colores[clave].toUpperCase()]))
    const { error: errorGuardado } = await supabase.rpc('guardar_colores_citas', { p_colores: aGuardar })
    setGuardando(false)
    if (errorGuardado) {
      const legible = errorGuardado.code === 'P0001' || errorGuardado.code === '42501'
      setError(legible ? errorGuardado.message : 'No se pudieron guardar los colores. Intenta de nuevo.')
      return
    }
    mostrarToast('Colores de citas guardados.', 'exito')
    onGuardado(aGuardar)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Colores de las citas</h2>
        <p className="mt-1 text-sm text-ink/60">
          Cada tarjeta de cita toma el color del rol de quien la agendó. Las que agenda la clienta desde la web usan el
          color de «Cliente Web».
        </p>

        <div className="-mx-1 mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-1">
          {CLAVES_COLOR_CITA.map(({ clave, label }) => {
            const valor = colores[clave] ?? ''
            const valido = REGEX_COLOR.test(valor)
            return (
              <div
                key={clave}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                style={valido ? estiloTarjetaCita(valor) : undefined}
              >
                <label htmlFor={`color-cita-${clave}`} className="min-w-0 flex-1 truncate text-sm text-ink">
                  {label}
                </label>
                <input
                  id={`color-cita-${clave}`}
                  type="color"
                  value={valido ? valor : '#000000'}
                  onChange={(evento) => cambiar(clave, evento.target.value.toUpperCase())}
                  aria-label={`Elegir color para ${label}`}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <input
                  type="text"
                  value={valor}
                  maxLength={7}
                  spellCheck="false"
                  autoCapitalize="characters"
                  onChange={(evento) => cambiar(clave, evento.target.value.trim())}
                  aria-label={`Código de color para ${label}`}
                  className={`w-20 shrink-0 rounded-lg border bg-surface-2 px-2 py-1 font-mono text-xs uppercase text-ink outline-none focus:border-purple-300 ${
                    valido ? 'border-border' : 'border-red'
                  }`}
                />
              </div>
            )
          })}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar colores'}
          </button>
        </div>
      </form>
    </div>
  )
}
