import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buscarServicios } from '../lib/buscarServicios.js'
import { useDebounce } from './useDebounce.js'

// Búsqueda de servicios en el servidor para los selectores (QA-046). Mismo contrato que
// useBusquedaClientes: cada resultado queda atado al texto que lo pidió, las respuestas viejas se descartan
// por número de secuencia y los estados son distinguibles (buscando / error / listo), de modo que ninguna
// pantalla presenta una ficha existente (o una consulta fallida) como «no hay servicios».
export function useBusquedaServicios({ termino, activo = true, soloActivos = false, excluirId = null, esperaMs = 250 }) {
  const debounced = useDebounce(termino, esperaMs)
  const [resultado, setResultado] = useState(null) // { para, ok, datos }
  const [intento, setIntento] = useState(0)
  const secuencia = useRef(0)

  useEffect(() => {
    if (!activo) return
    const numero = ++secuencia.current
    buscarServicios(supabase, debounced, { soloActivos, excluirId }).then(
      (datos) => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: true, datos })
      },
      () => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: false, datos: [] })
      },
    )
  }, [debounced, activo, soloActivos, excluirId, intento])

  const vigente = resultado !== null && resultado.para === termino
  const reintentar = useCallback(() => {
    setResultado(null)
    setIntento((n) => n + 1)
  }, [])

  return {
    resultados: vigente && resultado.ok ? resultado.datos : [],
    buscando: !vigente,
    error: vigente && !resultado.ok,
    listo: vigente && resultado.ok,
    reintentar,
  }
}
