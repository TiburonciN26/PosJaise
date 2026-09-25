import { useState } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'

const LARGO_MINIMO = 6

function EtiquetaCampo({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

// "Seguridad de la cuenta" (menú del avatar, anidada bajo Mi Perfil —
// mismo criterio que Direcciones/Notificaciones, §7.22/§7.24) — cambiar
// contraseña vía Supabase Auth (`updateUser`), la única identidad real
// que tiene un cliente Web (no hay contraseña propia del negocio, es la
// misma cuenta con la que inició sesión). No pide la contraseña actual:
// `updateUser` solo exige una sesión activa y válida, que ya existe por
// estar dentro del portal — mismo criterio que usa Supabase Auth en
// cualquier app con sesión iniciada.
export default function SeguridadCuentaCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()

  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function manejarSubmit(evento) {
    evento.preventDefault()
    setError('')

    if (nueva.length < LARGO_MINIMO) {
      setError(`La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`)
      return
    }
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setGuardando(true)
    const { error: errorActualizar } = await supabase.auth.updateUser({ password: nueva })
    setGuardando(false)

    if (errorActualizar) {
      setError(errorActualizar.message || 'No se pudo actualizar la contraseña. Intenta de nuevo.')
      return
    }

    setNueva('')
    setConfirmar('')
    mostrarToast('Contraseña actualizada.', 'exito')
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="liquid-glass flex items-center gap-3 rounded-none p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--lw-gold)]">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Contraseña</p>
            <p className="truncate text-xs text-white/50">{usuario?.email}</p>
          </div>
        </div>

        <form onSubmit={manejarSubmit} className="liquid-glass mt-4 space-y-4 rounded-none p-5">
          <div>
            <EtiquetaCampo obligatorio htmlFor="seguridad-nueva">
              Nueva contraseña
            </EtiquetaCampo>
            <input
              id="seguridad-nueva"
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(evento) => setNueva(evento.target.value)}
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
              autoFocus
            />
          </div>

          <div>
            <EtiquetaCampo obligatorio htmlFor="seguridad-confirmar">
              Confirmar nueva contraseña
            </EtiquetaCampo>
            <input
              id="seguridad-confirmar"
              type="password"
              autoComplete="new-password"
              value={confirmar}
              onChange={(evento) => setConfirmar(evento.target.value)}
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--lw-gold)]"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="w-full rounded-full border border-[var(--lw-gold)] bg-transparent py-2.5 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
