import { createContext, useContext, useEffect, useRef } from 'react'

// PestanasCacheadas mantiene montadas las pestañas ya visitadas y oculta las inactivas con display:none. Los diálogos que
// esas páginas dejan abiertos (borrador a medias) siguen montados, pero NO están a la vista: no deben participar ni en la
// pila de Escape ni en la trampa de foco (QA-049: un segundo Escape cerraba el modal POS oculto en vez del modal Web
// visible). Cada página cacheada se envuelve en este contexto con su visibilidad real; fuera de ese contenedor (portal,
// login, etc.) el valor por defecto es «visible». Una pantalla oculta SIGUE montada con su estado mientras esté en la caché; al volver
// a ser visible, sus diálogos recuperan Escape y foco con el borrador intacto. (Desde la Fase 6 la caché es LRU de tamaño limitado:
// las pantallas con trabajo sin terminar están protegidas —ver ProteccionPantallaContext más abajo— y las demás, sin nada que perder,
// pueden desmontarse cuando hay otras más recientes.)
export const PaginaActivaContext = createContext(true)

export function usePaginaActiva() {
  return useContext(PaginaActivaContext)
}

// Fase 6: PestanasCacheadas LIMITA cuántas pantallas conserva montadas y desmonta las más antiguas. Una pantalla con trabajo sin
// terminar (un diálogo abierto, un formulario editado, borradores) NO se puede descartar: lo declara con este contexto.
//   proteger(id, true|false): registra / retira una razón de protección de ESA pantalla (cada fuente usa su propio `id`).
// Fuera de PestanasCacheadas (portal, login) el valor es null y no hace nada.
export const ProteccionPantallaContext = createContext(null)

/** Mientras `protegida` sea true, la pantalla que contiene este componente no se desmonta por la política de caché. */
export function useProtegerPantalla(protegida) {
  const proteger = useContext(ProteccionPantallaContext)
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = Symbol('proteccion-pantalla')
  useEffect(() => {
    if (!proteger || !protegida) return undefined
    const id = idRef.current
    proteger(id, true)
    return () => proteger(id, false)
  }, [proteger, protegida])
}
