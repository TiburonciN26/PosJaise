import { useId, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { MIN_PASSWORD, validarPassword } from '../lib/personal.js'
import Etiqueta from './Etiqueta.jsx'

// Cambio de la PROPIA contraseña del personal (la contraseña inicial la define la administradora al crear la
// cuenta). Usa la sesión actual: Supabase Auth no pide la anterior.
export default function ModalCambiarClave({ onCerrar }) {
  const idBase = useId()
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)

  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [ver, setVer] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar, !guardando)

  async function guardar(evento) {
    evento.preventDefault()
    const errorClave = validarPassword(nueva)
    if (errorClave) {
      setError(errorClave)
      return
    }
    if (nueva !== repetir) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setGuardando(true)
    setError(null)
    const { error: errorActualizar } = await supabase.auth.updateUser({ password: nueva })
    setGuardando(false)
    if (errorActualizar) {
      setError(
        /different from the old password/i.test(errorActualizar.message ?? '')
          ? 'La nueva contraseña debe ser distinta a la actual.'
          : 'No se pudo cambiar la contraseña. Intenta de nuevo.',
      )
      return
    }
    mostrarToast('Contraseña actualizada.', 'exito')
    onCerrar()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Cambiar mi contraseña</h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-nueva`}>
              Nueva contraseña
            </Etiqueta>
            <div className="flex items-center gap-2">
              <input
                id={`${idBase}-nueva`}
                type={ver ? 'text' : 'password'}
                autoComplete="new-password"
                value={nueva}
                onChange={(evento) => setNueva(evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink/70 hover:border-amber"
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink/60">Mínimo {MIN_PASSWORD} caracteres.</p>
          </div>

          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-repetir`}>
              Repite la contraseña
            </Etiqueta>
            <input
              id={`${idBase}-repetir`}
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={repetir}
              onChange={(evento) => setRepetir(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Cambiar'}
          </button>
        </div>
      </form>
    </div>
  )
}
