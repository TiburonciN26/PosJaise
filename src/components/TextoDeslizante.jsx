import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Texto de una línea que, si no cabe, en vez de quedarse en «…» se desliza de derecha a izquierda hasta mostrar lo que
// faltaba, espera un momento y vuelve a empezar desde el principio (en bucle, sin fundido). Mientras `activo` es false (o
// con «reducir movimiento») se comporta como un `truncate` normal con «…».
//
// Se anima con la Web Animations API y no con un @keyframes fijo: las pausas deben durar siempre lo mismo y el
// desplazamiento ir a velocidad constante, y eso depende de cuánto sobra en cada texto (con porcentajes fijos un nombre
// apenas cortado esperaría lo mismo que tarda en deslizarse uno muy largo). Solo mueve `transform`: lo
// resuelve el compositor, no repinta la página.
// Pausas más cortas y letras más lentas (pedido del usuario): el ciclo dura más o menos lo mismo que antes, pero el tiempo
// se va en leer mientras se mueve, no en esperar.
const VELOCIDAD_PX_S = 24
const PAUSA_INICIO_MS = 800
const PAUSA_FINAL_MS = 900

// `children` (opcional): contenido con formato (p. ej. «(tú)» en gris en Personal). `texto` sigue siendo obligatorio:
// es el title y lo que dispara la nueva medición cuando cambia.
export default function TextoDeslizante({ texto, activo = true, className = '', children }) {
  const contenedorRef = useRef(null)
  const textoRef = useRef(null)
  const [desborde, setDesborde] = useState(0)

  // Cuánto sobra: ancho real del texto (scrollWidth del span interno, que con o sin «…» mide el texto completo) menos el
  // ancho disponible. Se vuelve a medir si cambia el ancho (giro de pantalla, columnas).
  useLayoutEffect(() => {
    const contenedor = contenedorRef.current
    const elementoTexto = textoRef.current
    if (!contenedor || !elementoTexto) return undefined
    const medir = () => setDesborde(Math.max(0, Math.ceil(elementoTexto.scrollWidth - contenedor.clientWidth)))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(contenedor)
    return () => observador.disconnect()
  }, [texto])

  const sinMovimiento =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const deslizar = activo && desborde > 0 && !sinMovimiento

  useEffect(() => {
    const elementoTexto = textoRef.current
    if (!deslizar || !elementoTexto?.animate) return undefined
    const deslizamientoMs = Math.max(800, (desborde / VELOCIDAD_PX_S) * 1000)
    const total = PAUSA_INICIO_MS + deslizamientoMs + PAUSA_FINAL_MS
    const inicio = 'translateX(0)'
    const fin = `translateX(-${desborde}px)`
    // Tras la pausa final, la vuelta siguiente arranca de nuevo en el inicio (salto directo, sin fundido).
    const animacion = elementoTexto.animate(
      [
        { offset: 0, transform: inicio },
        { offset: PAUSA_INICIO_MS / total, transform: inicio, easing: 'ease-in-out' },
        { offset: (PAUSA_INICIO_MS + deslizamientoMs) / total, transform: fin },
        { offset: 1, transform: fin },
      ],
      { duration: total, iterations: Infinity },
    )
    return () => animacion.cancel()
  }, [deslizar, desborde])

  return (
    <span ref={contenedorRef} title={texto} className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`}>
      <span
        ref={textoRef}
        className={`inline-block align-top ${deslizar ? '' : 'max-w-full overflow-hidden text-ellipsis'}`}
      >
        {children ?? texto}
      </span>
    </span>
  )
}
