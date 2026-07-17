import { X, Mic } from 'lucide-react'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import { useToast } from '../context/ToastContext.jsx'
import IconoBuscar from './IconoBuscar.jsx'
import InputBusqueda from './InputBusqueda.jsx'

const TEMA_CLASES = {
  amber: {
    focus: 'focus:border-amber',
    micHover: 'border-dashed border-border-strong text-ink/70 hover:border-amber hover:text-amber',
  },
  'purple-300': {
    focus: 'focus:border-purple-300',
    micHover:
      'border-dashed border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300',
  },
}

// Icono de búsqueda + input + botón de limpiar + micrófono (voz), el bloque
// que se repetía casi igual en cada pantalla con lista. Devuelve dos
// elementos hermanos (no un solo div envolvente) para que la página los siga
// ubicando junto a su SelectorOrden/botón "Nuevo X" en la misma fila.
export default function BarraBusqueda({ valor, onCambiar, placeholder, tema = 'amber' }) {
  const { mostrarToast } = useToast()
  const clases = TEMA_CLASES[tema]

  const {
    soportado: vozSoportada,
    escuchando,
    alternar: alternarVoz,
    onErrorRef: onErrorVozRef,
  } = useReconocimientoVoz((texto) => onCambiar(texto))
  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  return (
    <>
      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/60">
          <IconoBuscar />
        </span>
        <InputBusqueda
          value={valor}
          onChange={(evento) => onCambiar(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape') onCambiar('')
          }}
          textoPlaceholder={placeholder}
          className={`w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 ${clases.focus}`}
        />
        {valor && (
          <button
            type="button"
            onClick={() => onCambiar('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2.5 text-ink/60 transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {vozSoportada && (
        <button
          type="button"
          onClick={alternarVoz}
          aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
          className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
            escuchando ? 'animate-pulse border-red bg-red/10 text-red' : clases.micHover
          }`}
        >
          <Mic className="h-4 w-4" />
        </button>
      )}
    </>
  )
}
