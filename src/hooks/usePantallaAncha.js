import { useSyncExternalStore } from 'react'

// true desde el breakpoint `md` de Tailwind (768 px: tablets y PC). Ahí el menú lateral del POS
// queda fijo a la izquierda; por debajo es el cajón que se abre con la hamburguesa.
const CONSULTA = '(min-width: 48rem)'

function suscribir(avisar) {
  const media = window.matchMedia(CONSULTA)
  media.addEventListener('change', avisar)
  return () => media.removeEventListener('change', avisar)
}

const leer = () => window.matchMedia(CONSULTA).matches

export function usePantallaAncha() {
  return useSyncExternalStore(suscribir, leer, () => false)
}
