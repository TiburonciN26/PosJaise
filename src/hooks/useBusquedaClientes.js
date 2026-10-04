import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buscarClientes } from '../lib/buscarClientes.js'
import { useDebounce } from './useDebounce.js'

// Búsqueda de clientes en el servidor para los selectores (QA-043). Devuelve el estado de la
// búsqueda de forma que NINGÚN selector pueda presentar una ficha existente como inexistente:
//
//   buscando → el texto escrito aún no tiene resultado (antirrebote o petición en vuelo)
//   error    → la búsqueda de ESE texto falló (no es «sin resultados»)
//   listo    → la búsqueda de ESE texto terminó bien; `resultados` es la respuesta completa y acotada
//
// Cada resultado queda atado al texto que lo pidió y cada petición lleva un número de secuencia:
// si el texto cambia mientras una respuesta vuela, la respuesta vieja se descarta y nunca pisa a la nueva.
// `activo` permite montar el hook siempre y buscar solo cuando el desplegable está abierto.
export function useBusquedaClientes({ termino, activo = true, conTelefono = false, esperaMs = 250 }) {
  const debounced = useDebounce(termino, esperaMs)
  const [resultado, setResultado] = useState(null) // { para, ok, datos }
  const [intento, setIntento] = useState(0)
  const secuencia = useRef(0)

  useEffect(() => {
    if (!activo) return
    const numero = ++secuencia.current
    buscarClientes(supabase, debounced, { conTelefono }).then(
      (datos) => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: true, datos })
      },
      () => {
        if (numero === secuencia.current) setResultado({ para: debounced, ok: false, datos: [] })
      },
    )
  }, [debounced, activo, conTelefono, intento])

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
