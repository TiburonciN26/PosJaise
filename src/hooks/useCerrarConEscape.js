import { useEffect } from 'react'

// Convención del proyecto: todo modal se puede cerrar con Esc.
// `activo` permite usar el hook también en diálogos condicionales
// (que no siempre están montados) sin romper las reglas de hooks.
export function useCerrarConEscape(onCerrar, activo = true) {
  useEffect(() => {
    if (!activo) return undefined

    function manejarTecla(evento) {
      if (evento.key === 'Escape') onCerrar()
    }

    document.addEventListener('keydown', manejarTecla)
    return () => document.removeEventListener('keydown', manejarTecla)
  }, [onCerrar, activo])
}
