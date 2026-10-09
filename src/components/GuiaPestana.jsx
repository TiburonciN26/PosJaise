import { useEffect, useRef, useState } from 'react'

// Botón "!" flotante (posición absoluta: no empuja el contenido; la página
// que lo usa debe ser `relative`), arriba a la derecha, justo bajo el avatar
// del header. Abre la
// breve guía de una pestaña de Web en un globo. Reemplaza al bloque de ícono
// + texto que ocupaba el inicio de cada pantalla.
export default function GuiaPestana({ children }) {
  const [abierta, setAbierta] = useState(false)
  const raiz = useRef(null)

  useEffect(() => {
    if (!abierta) return undefined
    const fuera = (e) => {
      if (raiz.current && !raiz.current.contains(e.target)) setAbierta(false)
    }
    const esc = (e) => {
      if (e.key === 'Escape') setAbierta(false)
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierta])

  return (
    <div className="absolute right-3 top-2 z-20">
      <div ref={raiz} className="relative">
        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          aria-label="Ver guía de esta pestaña"
          aria-expanded={abierta}
          className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold transition-colors ${
            abierta
              ? 'border-azul-metal bg-azul-metal/15 text-azul-metal'
              : 'border-border-strong text-ink/70 hover:border-azul-metal hover:text-azul-metal'
          }`}
        >
          !
        </button>
        {abierta && (
          <div
            role="dialog"
            aria-label="Guía de la pestaña"
            className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[85vw] rounded-xl border border-border bg-surface-2 p-3 text-left text-sm text-ink/80 shadow-lg"
          >
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
