import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buscarAtenciones } from '../lib/buscarAtenciones.js'
import { useDebounce } from './useDebounce.js'

// Búsqueda de atenciones pendientes en el servidor (QA-044). Mismo contrato que useBusquedaClientes:
// el resultado queda atado al texto que lo pidió, las respuestas viejas se descartan por número de
// secuencia y los estados son distinguibles (buscando / error / listo), de modo que una lista incompleta o
// una consulta fallida NUNCA se presentan como «no hay atenciones pendientes».
// Cambiar las exclusiones (se agregó o se quitó una atención del carrito) vuelve a pedir la lista sin
// mostrar «Buscando…»: el modal además oculta al instante lo que ya está en el carrito.
export function useBusquedaAtenciones({ termino, excluirIds, esperaMs = 250 }) {
  const debounced = useDebounce(termino, esperaMs)
  const claveExclusion = [...excluirIds].sort().join(',')
  const [resultado, setResultado] = useState(null) // { para, ok, filas, truncado }
  const [intento, setIntento] = useState(0)
  const secuencia = useRef(0)

  useEffect(() => {
    const numero = ++secuencia.current
    const ids = claveExclusion ? claveExclusion.split(',') : []
    buscarAtenciones(supabase, debounced, { excluirIds: ids }).then(
      ({ filas, truncado }) => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: true, filas, truncado })
      },
      () => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: false, filas: [], truncado: false })
      },
    )
  }, [debounced, claveExclusion, intento])

  const vigente = resultado !== null && resultado.para === termino
  const reintentar = useCallback(() => {
    setResultado(null)
    setIntento((n) => n + 1)
  }, [])

  return {
    resultados: vigente && resultado.ok ? resultado.filas : [],
    truncado: vigente && resultado.ok ? resultado.truncado : false,
    buscando: !vigente,
    error: vigente && !resultado.ok,
    listo: vigente && resultado.ok,
    reintentar,
  }
}
