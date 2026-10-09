import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'

// Texto guía de un campo de formulario: un "!" pequeño en círculo que se
// pone al lado de la etiqueta y, al pulsarlo, despliega el mensaje debajo
// (se cierra al pulsar de nuevo, al hacer clic fuera o con Esc). Sirve para
// explicaciones que no hace falta ver siempre, en vez de una nota fija
// bajo el campo:
//   <div className="flex items-center gap-1">
//     <Etiqueta htmlFor="x">Transferencia</Etiqueta>
//     <AyudaCampo>Mismo dato que se edita desde Ventas.</AyudaCampo>
//   </div>
// (No usar con ErrorCampo: ese es para errores de validación.)
export default function AyudaCampo({ children, etiqueta = 'Ver ayuda' }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  const idMensaje = useId()

  useEffect(() => {
    if (!abierto) return
    function alPulsarFuera(evento) {
      if (raiz.current && !raiz.current.contains(evento.target)) setAbierto(false)
    }
    function alPulsarTecla(evento) {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', alPulsarFuera)
    document.addEventListener('keydown', alPulsarTecla)
    return () => {
      document.removeEventListener('pointerdown', alPulsarFuera)
      document.removeEventListener('keydown', alPulsarTecla)
    }
  }, [abierto])

  // Solo se monta abierto: un popover cerrado (aunque transparente) seguía
  // ocupando ancho y provocaba scroll horizontal en móvil. Al abrirse se
  // desplaza a la izquierda lo justo para no salirse de la pantalla.
  function ajustarAlViewport(elemento) {
    if (!elemento) return
    elemento.style.left = '0px'
    const { right } = elemento.getBoundingClientRect()
    const limite = document.documentElement.clientWidth - 8
    if (right > limite) elemento.style.left = `${limite - right}px`
  }

  return (
    <span ref={raiz} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setAbierto((anterior) => !anterior)}
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={abierto ? idMensaje : undefined}
        className={`flex items-center rounded-full transition-colors hover:text-azul-metal ${abierto ? 'text-azul-metal' : 'text-ink/50'}`}
      >
        <CircleAlert className="h-3.5 w-3.5" />
      </button>
      {abierto && (
        <span
          ref={ajustarAlViewport}
          id={idMensaje}
          role="note"
          className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-border bg-surface-2 p-2.5 text-xs font-normal text-ink/70 shadow-lg transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none"
        >
          {children}
        </span>
      )}
    </span>
  )
}
