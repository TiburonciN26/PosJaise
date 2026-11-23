import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Cuántas citas anteriores de la clienta quedaron en «No asistió» (sin contar `excluirCitaId`, la que se está viendo o editando).
// Una consulta de solo conteo al elegir la clienta. Sin clienta registrada (solo nombre de referencia) no hay historial: 0.
export function useInasistenciasClienta(clienteId, excluirCitaId = null) {
  const clave = clienteId ? `${clienteId}|${excluirCitaId ?? ''}` : null
  const [resultado, setResultado] = useState({ clave: null, total: 0 })

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    let consulta = supabase
      .from('citas')
      .select('id', { count: 'exact', head: true })
      .eq('cliente_id', clienteId)
      .eq('estado', 'NO_ASISTIO')
    if (excluirCitaId) consulta = consulta.neq('id', excluirCitaId)
    consulta.then(({ count, error }) => {
      if (vigente && !error) setResultado({ clave, total: count ?? 0 })
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  return clave && resultado.clave === clave ? resultado.total : 0
}
