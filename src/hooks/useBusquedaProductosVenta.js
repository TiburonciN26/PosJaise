import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buscarProductosVenta } from '../lib/buscarProductosVenta.js'
import { useDebounce } from './useDebounce.js'

// Búsqueda de productos de Caja en el servidor (QA-047). Mismo contrato que useBusquedaClientes /
// useBusquedaServicios: resultado atado al texto que lo pidió, respuestas viejas descartadas por número de
// secuencia y estados distinguibles (buscando / error / listo): una lista incompleta o una consulta fallida
// nunca se presentan como «no hay productos».
export function useBusquedaProductosVenta({ termino, esperaMs = 250 }) {
  const debounced = useDebounce(termino, esperaMs)
  const [resultado, setResultado] = useState(null) // { para, ok, datos }
  const [intento, setIntento] = useState(0)
  const secuencia = useRef(0)

  useEffect(() => {
    const numero = ++secuencia.current
    if (!debounced.trim()) return
    buscarProductosVenta(supabase, debounced).then(
      (datos) => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: true, datos })
      },
      () => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: false, datos: [] })
      },
    )
  }, [debounced, intento])

  const vacio = !termino.trim()
  const vigente = vacio || (resultado !== null && resultado.para === termino)
  const reintentar = useCallback(() => {
    setResultado(null)
    setIntento((n) => n + 1)
  }, [])

  return {
    resultados: !vacio && vigente && resultado.ok ? resultado.datos : [],
    buscando: !vigente,
    error: !vacio && vigente && !resultado.ok,
    listo: !vacio && vigente && resultado.ok,
    reintentar,
  }
}
