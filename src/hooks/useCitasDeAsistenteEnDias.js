import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { deInputDatetimeLima } from '../lib/fechas.js'

// Como useCitasDeAsistenteEnElDia pero para VARIOS días a la vez (las sesiones siguientes de un tratamiento caen en meses distintos):
// citas PENDIENTES de una asistente en cada día, para avisar si alguna sesión se cruza con otra cita (lib/choquesCita.js).
// `fechas` = ['AAAA-MM-DD', ...]. Devuelve { 'AAAA-MM-DD': [citas] }. Una consulta por día, solo cuando cambia asistente o días; si una
// falla, ese día simplemente no avisa.
export function useCitasDeAsistenteEnDias(asistenteId, fechas) {
  const unicas = [...new Set((fechas ?? []).filter(Boolean))].sort()
  const clave = asistenteId && unicas.length ? `${asistenteId}|${unicas.join(',')}` : null
  const [resultado, setResultado] = useState({ clave: null, porDia: {} })

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    Promise.all(
      unicas.map(async (fecha) => {
        const desde = deInputDatetimeLima(`${fecha}T00:00`)
        const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)
        const { data, error } = await supabase
          .from('citas')
          .select('id, fecha_hora, cliente_nombre_referencia, clientes(nombre), cita_servicios(duracion_min)')
          .eq('asistente_id', asistenteId)
          .eq('estado', 'PENDIENTE')
          .gte('fecha_hora', desde.toISOString())
          .lt('fecha_hora', hasta.toISOString())
        return [fecha, error ? [] : (data ?? [])]
      }),
    ).then((pares) => {
      if (vigente) setResultado({ clave, porDia: Object.fromEntries(pares) })
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  return clave && resultado.clave === clave ? resultado.porDia : {}
}
