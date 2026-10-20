import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Selector móvil compartido por navegación y filtros de Recompensas.
export default function SelectorDesplegable({ opciones, valor, onSeleccionar, etiqueta, etiquetaLista, className = '', alineacion = 'derecha' }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  const boton = useRef(null)
  const id = useId()
  const seleccionada = opciones.find(opcion => opcion.clave === valor)

  useEffect(() => {
    if (!abierto) return undefined
    const cerrarFuera = evento => {
      if (!raiz.current?.contains(evento.target)) setAbierto(false)
    }
    const ancho = window.matchMedia('(min-width: 40rem)')
    const cerrarEnPC = evento => { if (evento.matches) setAbierto(false) }
    document.addEventListener('pointerdown', cerrarFuera)
    ancho.addEventListener('change', cerrarEnPC)
    return () => {
      document.removeEventListener('pointerdown', cerrarFuera)
      ancho.removeEventListener('change', cerrarEnPC)
    }
  }, [abierto])

  return (
    <div ref={raiz} className={`relative min-w-0 sm:hidden ${className}`}
      onKeyDown={evento => {
        if (evento.key === 'Escape' && abierto) {
          evento.preventDefault()
          setAbierto(false)
          boton.current?.focus()
        }
      }}>
      <button ref={boton} type="button" aria-expanded={abierto} aria-controls={id}
        aria-label={`${etiqueta}: ${seleccionada?.label ?? ''}`}
        onClick={() => setAbierto(valorAnterior => !valorAnterior)}
        className="flex w-full min-w-0 items-center justify-between gap-1.5 border-0 bg-transparent px-(--pading-horizontal-boton) py-(--pading-vertical-boton) text-[13px] sm:text-sm font-semibold leading-normal text-[var(--lw-fg)]">
        <span className="truncate">{seleccionada?.label}</span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${abierto ? 'rotate-180' : ''}`} />
      </button>
      <div id={id} role="group" aria-label={etiquetaLista} aria-hidden={!abierto} inert={!abierto} data-abierto={abierto}
        className={`recompensas-selector__lista absolute top-full z-30 mt-2 w-48 max-w-[calc(100vw-20px)] ${alineacion === 'izquierda' ? 'left-0' : 'right-0'}`}>
          <div className="max-h-[40svh] space-y-[2px] overflow-y-auto bg-[var(--lw-card)] px-(--pading-horizontal-boton) py-(--pading-vertical-boton) shadow-lg">
            {opciones.map(opcion => (
              <button key={opcion.clave} type="button" aria-pressed={valor === opcion.clave}
                onClick={() => {
                  onSeleccionar(opcion.clave)
                  setAbierto(false)
                  boton.current?.focus()
                }}
                className={`block w-full rounded-none border-0 px-(--pading-horizontal-boton) py-(--pading-vertical-boton) text-left text-[13px] sm:text-sm leading-normal transition-colors hover:bg-[var(--lw-border)] ${valor === opcion.clave ? 'bg-[var(--lw-border)] font-semibold text-[var(--lw-gold)]' : 'bg-transparent text-[var(--lw-fg)]'}`}>
                {opcion.label}
              </button>
            ))}
          </div>
      </div>
    </div>
  )
}
