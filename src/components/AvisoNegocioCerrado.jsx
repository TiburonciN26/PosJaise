import { Circle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useEstadoNegocio } from '../context/EstadoNegocioContext.jsx'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'

// Si un asistente ya tenía sesión abierta y el admin cierra el negocio
// mientras la sigue usando (EstadoNegocioContext se entera vía Realtime,
// sin recargar), se bloquea toda la UI con este aviso — no se cierra la
// sesión de golpe (podría perder un ticket a medio armar), pero tampoco
// puede seguir operando: el bloqueo real de todos modos está en el
// servidor (RLS + RPCs), esto es solo para que no llegue a intentarlo.
// Desaparece solo cuando el admin vuelve a abrir (mismo mecanismo).
export default function AvisoNegocioCerrado() {
  const { rol, cerrarSesion } = useAuth()
  const { abierto, cargando } = useEstadoNegocio()

  if (cargando || rol === 'ADMINISTRADOR' || abierto) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <Circle className="h-10 w-10 text-red" fill="currentColor" strokeWidth={0} />
      <h1 className="text-lg font-semibold text-ink">Negocio cerrado</h1>
      <p className="max-w-sm text-sm text-ink/60">{MENSAJE_NEGOCIO_CERRADO}</p>
      <button
        type="button"
        onClick={cerrarSesion}
        className="mt-3 rounded-lg border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:border-red hover:text-red"
      >
        Cerrar sesión
      </button>
    </div>
  )
}
