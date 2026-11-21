import { useSyncExternalStore } from 'react'

// ¿Se cumple la media query? Se actualiza sola al cambiar el tamaño/orientación. Sirve para MONTAR solo una de dos vistas
// (p. ej. tarjetas en móvil vs. tabla en escritorio) en vez de montar las dos y ocultar una con CSS (`lg:hidden`), que duplica
// el DOM y las consultas de lo que se despliegue dentro.
export function useMediaQuery(consulta) {
  return useSyncExternalStore(
    (avisar) => {
      const lista = window.matchMedia(consulta)
      lista.addEventListener('change', avisar)
      return () => lista.removeEventListener('change', avisar)
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  )
}
