import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { contarCuponesPorEstado, leerCupones } from '../lib/listasAdmin.js'
import { useEstadoVista } from '../lib/estadoVista.js'
import { useDebounce } from './useDebounce.js'
import { useListaPaginada } from './useListaPaginada.js'

// Lista de cupones emitidos de Referidos Web / Fidelización Web (Fase 5): hasta 40 por página, filtro de estado y búsqueda por
// «código o clienta» en el servidor, y contadores GLOBALES (de todos los cupones de esos orígenes, no de la página).
//   origenes: arreglo ESTABLE (constante de módulo) con los `origen` que muestra la pantalla.
//   filtro:   'RECIENTES' (todos, del más nuevo al más antiguo) | 'DISPONIBLE' | 'CANJEADO'.
export function useCuponesAdmin({ origenes, activo = true, claveVista }) {
  // Filtro y búsqueda sobreviven a que la caché de pestañas desmonte la pantalla (Fase 6): se guardan por `claveVista`.
  const [filtro, setFiltro] = useEstadoVista(`${claveVista}:filtro`, 'RECIENTES')
  const [busqueda, setBusqueda] = useEstadoVista(`${claveVista}:busqueda`, '')
  const termino = useDebounce(busqueda.trim(), 300)
  const estado = filtro === 'RECIENTES' ? null : filtro

  const lista = useListaPaginada({
    activo,
    clave: `${termino}|${estado ?? ''}`,
    leer: ({ desde, hasta }) => leerCupones(supabase, { origenes, estado, termino, desde, hasta }),
  })

  const [conteos, setConteos] = useState(null)
  const generacion = useRef(0)
  const refrescarConteos = useCallback(async () => {
    const gen = (generacion.current += 1)
    try {
      const nuevos = await contarCuponesPorEstado(supabase, origenes)
      if (gen === generacion.current) setConteos(nuevos)
    } catch {
      if (gen === generacion.current) setConteos(null)
    }
  }, [origenes])
  useEffect(() => {
    if (activo) refrescarConteos()
  }, [activo, refrescarConteos])

  return { lista, filtro, setFiltro, busqueda, setBusqueda, termino, estado, conteos }
}
