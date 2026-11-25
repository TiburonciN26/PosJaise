import { Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

// Aviso fijo que solo ve el ADMINISTRADOR mientras mira el portal como el
// público (AuthContext.jsx → vistaPreviaPortal). Le recuerda que está en una
// vista previa SIN cuenta (nada de lo que haga aquí se guarda en su nombre) y
// le da el único camino de vuelta al POS, que antes vivía en el menú de la
// cuenta de clienta y ya no existe (el admin no tiene cuenta de clienta).
//
// Va como hijo directo de `.landing-web` (PortalCliente.jsx), fuera del
// <main> con overflow-hidden: un `fixed` dentro de él quedaría recortado.
export default function BarraVistaPreviaPortal() {
  const { vistaPreviaPortal, volverAlPos } = useAuth()
  if (!vistaPreviaPortal) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 max-sm:left-3 max-sm:right-3 max-sm:bottom-3">
      <div className="lw-bar pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 py-1.5 pl-4 pr-1.5 shadow-lg max-sm:justify-between">
        <span className="text-xs text-white/70">Vista previa de la web de clientas</span>
        <button
          type="button"
          onClick={volverAlPos}
          className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 text-xs font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Volver al POS
        </button>
      </div>
    </div>
  )
}
