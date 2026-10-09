import { useEffect, useRef, useState } from 'react'
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
  'azul-metal': {
    activo: 'border-azul-metal bg-azul-metal/10 text-azul-metal',
    hover: 'hover:border-azul-metal hover:text-azul-metal',
    opcionActiva: 'bg-azul-metal/15 text-azul-metal',
  },
}

export default function SelectorOrden({
  opciones,
  valor,
  onCambiar,
  tema = 'amber',
  icono: Icono = ArrowUpDown,
  ariaLabel = 'Ordenar por',
  sinBorde = false,
}) {
  const [abierto, setAbierto] = useState(false)
  useCerrarConEscape(() => setAbierto(false), abierto, { trabajoPendiente: false })
  const clases = TEMA_CLASES[tema]

  const temporizadorBlurRef = useRef(null)
  useEffect(() => {
    return () => clearTimeout(temporizadorBlurRef.current)
  }, [])

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((valorAnterior) => !valorAnterior)}
        onBlur={() => {
          temporizadorBlurRef.current = setTimeout(() => setAbierto(false), 150)
        }}
        aria-label={ariaLabel}
        aria-expanded={abierto}
        className={`flex items-center justify-center rounded-lg border p-2.5 transition-colors ${
          abierto
            ? sinBorde
              ? 'border-transparent text-amber'
              : clases.activo
            : sinBorde
              ? `border-transparent text-ink/70 ${clases.hover}`
              : `border-dashed border-border-strong text-ink/70 ${clases.hover}`
        }`}
      >
        <Icono className="h-4 w-4" />
      </button>

      {/* Siempre montado: así el cierre también anima (clip-path de arriba
          hacia abajo al abrir, al revés al cerrar). `invisible` evita foco
          y clics mientras está cerrado. */}
      <div
        aria-hidden={!abierto}
        className={`absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg transition-[clip-path,opacity,visibility,transform] duration-300 ease-out ${
          abierto
            ? 'visible translate-y-0 opacity-100 [clip-path:inset(0_0_0_0)]'
            : 'invisible -translate-y-1 opacity-0 [clip-path:inset(0_0_100%_0)]'
        }`}
      >
        {opciones.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            tabIndex={abierto ? 0 : -1}
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
        ))}
      </div>
    </div>
  )
}
