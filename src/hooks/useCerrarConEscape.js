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

  // QA-049: la capa se registra UNA vez por apertura (depende solo de `activo`). Antes el efecto dependía de la
  // identidad de `onCerrar`: un modal cuyo padre pasa una función nueva en cada render se volvía a registrar al
  // TOPE de la pila en cada render, y un Escape cerraba esa capa (y lo que colgaba de ella) en vez de la que
  // realmente está encima. `onCerrar` se lee por ref, así que siempre se llama la versión más reciente.
  const alCerrarRef = useRef(onCerrar)
  useEffect(() => {
    alCerrarRef.current = onCerrar
  })

  useEffect(() => {
    if (!activo) return undefined

    const id = idRef.current
    pila.push(id)

    function manejarTecla(evento) {
      if (evento.key !== 'Escape') return
      if (pila[pila.length - 1] !== id) return
      alCerrarRef.current()
    }

    document.addEventListener('keydown', manejarTecla)
    return () => {
      document.removeEventListener('keydown', manejarTecla)
      const indice = pila.lastIndexOf(id)
      if (indice !== -1) pila.splice(indice, 1)
    }
  }, [activo])
}
