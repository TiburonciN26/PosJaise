import { useState } from 'react'

// Las dos detecciones que necesita la animación de entrada de una
// pestaña (ver docs/patrones/animacion-entrada.md — hoy en
// ServiciosCliente.jsx, estándar para el resto de la Web de clientes):
// si el usuario pidió menos movimiento, y si arrancó en escritorio o en
// móvil. Ambas se resuelven UNA sola vez al montar (no reaccionan en
// vivo a un resize ni a un cambio de preferencia del sistema): la
// animación de entrada solo importa en el instante en que la pestaña se
// monta, así que no vale la pena la complejidad de un listener.
export function useEntornoAnimacion(breakpointEscritorioPx = 1024) {
  const [reducirMovimiento] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [esDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(min-width: ${breakpointEscritorioPx}px)`).matches,
  )

  return { reducirMovimiento, esDesktop }
}
