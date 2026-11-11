import { useId, useRef, useState } from 'react'
import { Copy, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { MIN_PASSWORD, generarPassword, restablecerPassword, validarPassword } from '../lib/personal.js'
import Etiqueta from './Etiqueta.jsx'

// Restablece la contraseña de una cuenta de personal (la administradora la define y se la entrega).
export default function ModalClavePersonal({ persona, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  useModalA11y(panelRef)

  const [password, setPassword] = useState(() => generarPassword())
  const [ver, setVer] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [hecho, setHecho] = useState(false)

  useCerrarConEscape(() => (hecho ? onGuardado() : onCerrar()), !guardando)

  async function guardar(evento) {
    evento.preventDefault()
    const errorClave = validarPassword(password)
    if (errorClave) {
      setError(errorClave)
      return
    }
    setGuardando(true)
    setError(null)
    const resultado = await restablecerPassword(persona.id, password)
    setGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setHecho(true)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`Correo: ${persona.email}\nContraseña: ${password}`)
      mostrarToast('Credenciales copiadas.', 'exito')
    } catch {
      mostrarToast('No se pudo copiar. Anótalas manualmente.', 'error')
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Restablecer contraseña</h2>
        <p className="mt-1 text-sm text-ink/60">
          {persona.nombre_completo} · <span className="font-mono">{persona.email}</span>
        </p>

        <div className="mt-4">
          <Etiqueta obligatorio htmlFor={`${idBase}-clave`}>
            Nueva contraseña
          </Etiqueta>
          <div className="flex items-center gap-2">
            <input
              id={`${idBase}-clave`}
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              readOnly={hecho}
              onChange={(evento) => setPassword(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink/70 hover:border-purple-300"
            >
              {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            {!hecho && (
              <button
                type="button"
                onClick={() => setPassword(generarPassword())}
                aria-label="Generar contraseña"
                title="Generar contraseña"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink/70 hover:border-purple-300"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-ink/60">
            {hecho
              ? 'Contraseña cambiada. Entrégasela a la persona: ya no se vuelve a mostrar.'
              : `Mínimo ${MIN_PASSWORD} caracteres. Sus sesiones abiertas siguen hasta que expiren.`}
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          {hecho ? (
            <>
              <button
                type="button"
                onClick={copiar}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copiar
              </button>
              <button
                type="button"
                onClick={onGuardado}
                className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg"
              >
                Listo
              </button>
            </>
          ) : (
            <>
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
                {guardando ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
