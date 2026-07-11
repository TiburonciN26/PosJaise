import { Fragment, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const TEMA_CLASES = {
  amber: {
    activo: 'border-amber bg-amber/10 text-amber',
    hover: 'hover:border-amber hover:text-amber',
    opcionActiva: 'bg-amber/15 text-amber',
  },
  'purple-300': {
    activo: 'border-purple-300 bg-purple-300/10 text-purple-300',
    hover: 'hover:border-purple-300 hover:text-purple-300',
    opcionActiva: 'bg-purple-300/15 text-purple-300',
  },
}

export default function SelectorOrden({
  opciones,
  valor,
  onCambiar,
  tema = 'amber',
  icono: Icono = ArrowUpDown,
  ariaLabel = 'Ordenar por',
}) {
  const [abierto, setAbierto] = useState(false)
  useCerrarConEscape(() => setAbierto(false), abierto)
  const clases = TEMA_CLASES[tema]

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((valorAnterior) => !valorAnterior)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        aria-label={ariaLabel}
        aria-expanded={abierto}
        className={`flex items-center justify-center rounded-lg border p-2.5 transition-colors ${
          abierto ? clases.activo : `border-dashed border-border-strong text-ink/70 ${clases.hover}`
        }`}
      >
        <Icono className="h-4 w-4" />
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
          {opciones.map((opcion) => (
            <Fragment key={opcion.id}>
              {opcion.separador && <div className="my-1 border-t border-border" />}
              <button
                type="button"
                onMouseDown={(evento) => evento.preventDefault()}
                onClick={() => {
                  onCambiar(opcion.id)
                  setAbierto(false)
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                  valor === opcion.id ? clases.opcionActiva : 'text-ink hover:bg-surface-3'
                }`}
              >
                {opcion.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
