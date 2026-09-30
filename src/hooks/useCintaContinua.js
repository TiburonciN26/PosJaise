import { useCallback, useEffect, useRef } from 'react'

// Cinta continua de tarjetas (Productos → "Ofertas" y "Destacados", ver
// docs/diseno-productos/README.md, sección 1). A diferencia del lienzo
// aprobado — que simula el movimiento con @keyframes + un truco de
// `animation-delay` para las flechas, por lo que el salto se nota — acá
// todo el desplazamiento vive en un único offset en px llevado por
// requestAnimationFrame: las flechas mueven ese mismo offset un paso
// (`mover(±1)`) y el indicador de posición siempre refleja la posición
// REAL de la fila, nunca una posición simulada (pedido explícito del
// README: "esto debe deslizarse").
//
// `derecha` decide el sentido visual (Ofertas se mueve a la derecha,
// Destacados a la izquierda) pero `offset` siempre avanza "hacia
// adelante" en el sentido natural de esa fila — así `mover(1)` (flecha
// ›) siempre adelanta la fila un paso sin importar su sentido, y
// `mover(-1)` (flecha ‹) siempre la retrocede uno.
//
// El offset y el indicador se aplican mutando `style.transform`
// directo por ref (mismo truco ya usado en ProductosCliente.jsx para el
// tilt de la tarjeta iridiscente) — a 60fps, pasar esto por React state
// re-renderizaría el árbol entero de la fila en cada frame.
const RAYA_PX = 23 // 18px de rayita + 5px de separación — igual que el lienzo

export function useCintaContinua({ cantidadDistintos, pasoPx, velocidadPxS, derecha, activo }) {
  const anchoCiclo = cantidadDistintos * pasoPx
  const offsetRef = useRef(0) // siempre en [0, anchoCiclo)
  const pausadoRef = useRef(false)
  const trackRef = useRef(null)
  const dashRef = useRef(null)
  const rafRef = useRef(null)
  const ultimoRef = useRef(null)

  const aplicar = useCallback(() => {
    const offset = offsetRef.current
    if (trackRef.current) {
      const x = derecha ? offset - anchoCiclo : -offset
      trackRef.current.style.transform = `translate3d(${x}px, 0, 0)`
    }
    if (dashRef.current && cantidadDistintos > 0) {
      const progreso = (offset / pasoPx) % cantidadDistintos
      const x = derecha ? progreso * RAYA_PX : (cantidadDistintos - 1) * RAYA_PX - progreso * RAYA_PX
      dashRef.current.style.transform = `translateX(${x}px)`
    }
  }, [anchoCiclo, derecha, pasoPx, cantidadDistintos])

  // Refleja el offset actual cada vez que cambian las medidas (ej. pasar
  // de escritorio a móvil recalcula pasoPx/velocidad al remontar).
  useEffect(() => {
    aplicar()
  }, [aplicar])

  useEffect(() => {
    if (!activo || anchoCiclo <= 0) return undefined

    function tick(t) {
      if (ultimoRef.current == null) ultimoRef.current = t
      const dt = (t - ultimoRef.current) / 1000
      ultimoRef.current = t
      if (!pausadoRef.current) {
        offsetRef.current = (offsetRef.current + velocidadPxS * dt) % anchoCiclo
        aplicar()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      ultimoRef.current = null
    }
  }, [activo, anchoCiclo, velocidadPxS, aplicar])

  // Sin animación continua (prefers-reduced-motion), las flechas siguen
  // funcionando: la fila "se recorre con las flechas" en vez de quedar
  // inmóvil del todo, tal como pide el README.
  const mover = useCallback(
    (pasos) => {
      if (anchoCiclo <= 0) return
      offsetRef.current = ((offsetRef.current + pasos * pasoPx) % anchoCiclo + anchoCiclo) % anchoCiclo
      aplicar()
    },
    [anchoCiclo, pasoPx, aplicar],
  )

  const pausar = useCallback((valor) => {
    pausadoRef.current = valor
  }, [])

  return { trackRef, dashRef, mover, pausar }
}
