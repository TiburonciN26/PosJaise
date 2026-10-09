import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePaginaActiva } from '../context/PaginaActivaContext.jsx'
import { limpiarPendiente, marcarPendiente } from '../lib/trabajoPendiente.js'

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
// `opciones.trabajoPendiente = false` excluye menús/selectores desplegables: no tienen nada que perder al recargar.
export function useCerrarConEscape(onCerrar, activoSolicitado = true, { trabajoPendiente = true } = {}) {
  // Un diálogo de una pestaña cacheada y OCULTA no participa en la pila (QA-049); vuelve al ser visible, con su estado intacto.
  const paginaActiva = usePaginaActiva()
  const activo = activoSolicitado && paginaActiva
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

  // Layout effect: el listener queda registrado en el mismo commit en que aparece el diálogo, antes de que el usuario (o una
  // prueba) pueda ver y pulsar Escape (se descarta un registro tardío como posible causa de una intermitencia observada).
  useLayoutEffect(() => {
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

  // Fase 2B (B4): trabajo pendiente = el diálogo está ABIERTO/montado, aunque su página esté oculta en la caché de pestañas
  // (Atrás del navegador oculta la página, pero su formulario sigue en memoria y se perdería al recargar). Por eso depende
  // de `activoSolicitado` y NO de `paginaActiva`; Escape y la pila de capas (QA-049) siguen limitados a la página visible.
  // Solo informa al aviso de «versión nueva»: no cambia el comportamiento del diálogo.
  useLayoutEffect(() => {
    if (!activoSolicitado || !trabajoPendiente) return undefined
    const id = idRef.current
    marcarPendiente(id, 'una ventana o formulario abierto')
    return () => limpiarPendiente(id)
  }, [activoSolicitado, trabajoPendiente])
}
