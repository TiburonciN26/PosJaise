import { Plus } from 'lucide-react'

const COLORES = {
  amber: 'bg-amber',
  morado: 'bg-purple-300',
}

export default function BotonFlotanteAgregar({ onClick, color = 'amber', label = 'Agregar' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full text-bg shadow-lg transition-transform active:scale-95 lg:hidden ${COLORES[color]}`}
    >
      <Plus className="h-6 w-6" />
    </button>
  )
}
