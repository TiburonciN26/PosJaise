import { useEffect, useRef } from 'react'

// B5 de la 4ª auditoría: con modales apilados (ej. Gastos -> Plantillas ->
// confirmación), cada capa registraba su propio listener de Escape — un
// solo Esc cerraba TODAS a la vez en vez de solo la de arriba. Esta pila a
// nivel de módulo (compartida por todas las instancias del hook) lleva el
// orden real de apertura; en cada Escape, solo la capa que está al tope
// responde, exactamente como se apilan visualmente los modales (el que se
// abrió último siempre queda encima).
const pila = []

// Convención del proyecto: todo modal se puede cerrar con Esc.
// `activo` permite usar el hook también en diálogos condicionales
// (que no siempre están montados) sin romper las reglas de hooks.
export function useCerrarConEscape(onCerrar, activo = true) {
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = Symbol('capa-escape')

  useEffect(() => {
    if (!activo) return undefined

    const id = idRef.current
    pila.push(id)

    function manejarTecla(evento) {
      if (evento.key !== 'Escape') return
      if (pila[pila.length - 1] !== id) return
      onCerrar()
    }

    document.addEventListener('keydown', manejarTecla)
    return () => {
      document.removeEventListener('keydown', manejarTecla)
      const indice = pila.lastIndexOf(id)
      if (indice !== -1) pila.splice(indice, 1)
    }
  }, [onCerrar, activo])
}
