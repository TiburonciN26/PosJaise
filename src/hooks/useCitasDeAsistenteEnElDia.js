import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { deInputDatetimeLima } from '../lib/fechas.js'

// Citas PENDIENTES de una asistente en un día (hora de Lima), para avisar si la cita que se está agendando se cruza con otra
// (lib/choquesCita.js). Se pide una sola vez por asistente+día: cambiar la hora o los servicios solo recalcula en el navegador.
// `fecha` = 'AAAA-MM-DD'. Sin asistente o sin fecha devuelve []. Si la consulta falla, simplemente no se avisa.
export function useCitasDeAsistenteEnElDia(asistenteId, fecha, excluirCitaId = null) {
  const clave = asistenteId && fecha ? `${asistenteId}|${fecha}|${excluirCitaId ?? ''}` : null
  const [resultado, setResultado] = useState({ clave: null, citas: [] })

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    const desde = deInputDatetimeLima(`${fecha}T00:00`)
    const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)
    let consulta = supabase
      .from('citas')
      .select('id, fecha_hora, cliente_nombre_referencia, clientes(nombre), cita_servicios(duracion_min)')
      .eq('asistente_id', asistenteId)
      .eq('estado', 'PENDIENTE')
      .gte('fecha_hora', desde.toISOString())
      .lt('fecha_hora', hasta.toISOString())
    if (excluirCitaId) consulta = consulta.neq('id', excluirCitaId)
    consulta.then(({ data, error }) => {
      if (vigente && !error) setResultado({ clave, citas: data ?? [] })
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  return clave && resultado.clave === clave ? resultado.citas : []
}
