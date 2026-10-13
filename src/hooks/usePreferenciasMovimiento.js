import { useEffect, useState } from 'react'

// Fase 6: señales para PAUSAR animaciones y temporizadores que no se ven.
//   useMovimientoReducido() → la persona pidió menos movimiento (prefers-reduced-motion). Se actualiza si lo cambia en el sistema.
//   useDocumentoVisible()   → la pestaña del navegador está a la vista (Page Visibility); false cuando está en segundo plano.
// (Una pantalla oculta dentro de la caché de PestanasCacheadas se detecta con usePaginaActiva().)
const CONSULTA_REDUCIDO = '(prefers-reduced-motion: reduce)'

export function useMovimientoReducido() {
  const [reducido, setReducido] = useState(() => typeof window !== 'undefined' && window.matchMedia(CONSULTA_REDUCIDO).matches)
  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_REDUCIDO)
    const alCambiar = () => setReducido(consulta.matches)
    alCambiar()
    consulta.addEventListener('change', alCambiar)
    return () => consulta.removeEventListener('change', alCambiar)
  }, [])
  return reducido
}

export function useDocumentoVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const alCambiar = () => setVisible(!document.hidden)
    alCambiar()
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])
  return visible
}
