import { createContext, useContext } from 'react'

// PestanasCacheadas mantiene montadas las pestañas ya visitadas y oculta las inactivas con display:none. Los diálogos que
// esas páginas dejan abiertos (borrador a medias) siguen montados, pero NO están a la vista: no deben participar ni en la
// pila de Escape ni en la trampa de foco (QA-049: un segundo Escape cerraba el modal POS oculto en vez del modal Web
// visible). Cada página cacheada se envuelve en este contexto con su visibilidad real; fuera de ese contenedor (portal,
// login, etc.) el valor por defecto es «visible». Nada se desmonta ni se descarta: al volver a ser visible la página, sus
// diálogos recuperan Escape y foco con el borrador intacto.
export const PaginaActivaContext = createContext(true)

export function usePaginaActiva() {
  return useContext(PaginaActivaContext)
}
