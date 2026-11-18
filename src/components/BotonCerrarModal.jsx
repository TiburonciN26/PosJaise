import { X } from 'lucide-react'

// Ícono «X» para salir de un modal, a la derecha del título. Convención de todos los modales de la app (POS y Web):
// ponerlo en la cabecera con `justify-between`. El margen negativo agranda la zona táctil sin mover el layout.
// Esc ya cierra los modales por `useCerrarConEscape`; este botón es el equivalente para el toque/ratón.
export default function BotonCerrarModal({ onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Cerrar"
      className="-m-3.5 shrink-0 rounded-lg p-3.5 text-ink/60 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
    >
      <X className="h-4 w-4" />
    </button>
  )
}
