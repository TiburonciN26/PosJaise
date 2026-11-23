import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { usePaginaActiva } from '../context/PaginaActivaContext.jsx'

// Qué servicios tienen comisión (un % asignado) para una asistente, vía servicios_con_comision() (migración
// 20261121000002). Sirve para avisar al AGENDAR una cita —y al verla— de los servicios que luego no se podrán completar con
// esa asistente, en vez de enterarse recién al completarla.
//
// Devuelve un Set de ids de servicio, o null cuando no hay nada que validar: sin asistente elegida, todavía cargando, o si la
// consulta falla (el aviso es solo informativo: nunca bloquea agendar, y sin dato no se muestra nada en vez de avisar de más).
// Una ficha de administradora cuenta como «todos con comisión» (se queda con el 100 %). No trae el valor del %: la RLS de
// porcentajes lo deja ver solo a su dueña y a la admin.
//
// Las pantallas del POS se conservan montadas (ocultas) al cambiar de pestaña: si la administradora asigna un % en Comisiones y
// vuelve, el aviso debe apagarse solo. Por eso la consulta se repite cada vez que la pantalla vuelve a ser visible, y no se
// hace mientras está oculta.
const SIN_RESULTADO = { asistenteId: null, ids: null }

export function useServiciosConComision(asistenteId) {
  const [resultado, setResultado] = useState(SIN_RESULTADO)
  const visible = usePaginaActiva()

  useEffect(() => {
    if (!asistenteId || !visible) return undefined
    let vigente = true
    supabase.rpc('servicios_con_comision', { p_asistente_id: asistenteId }).then(({ data, error }) => {
      if (!vigente) return
      setResultado({ asistenteId, ids: error || !Array.isArray(data) ? null : new Set(data) })
    })
    return () => {
      vigente = false
      // Al cambiar de asistente (o cerrar) no se reutiliza lo anterior: se vuelve a consultar y mientras tanto no se avisa.
      setResultado(SIN_RESULTADO)
    }
  }, [asistenteId, visible])

  return asistenteId && resultado.asistenteId === asistenteId ? resultado.ids : null
}

// Versión por lote para las tarjetas del calendario: qué citas con la comisión sin resolver (pendiente, o completada
// cuya atención sigue como nota pendiente) tienen algún servicio sin comisión, vía citas_sin_comision(). Una sola consulta por
// cambio en las citas cargadas, no una por tarjeta. Devuelve un Set de ids de cita. Mientras recarga conserva el resultado
// anterior (sin parpadeo de cápsulas). Si la consulta falla, no se marca nada (el aviso es solo informativo). También se repite
// al volver a la pestaña (ver arriba).
const SIN_CITAS = new Set()
const ESTADOS_CON_COMISION_POR_RESOLVER = ['PENDIENTE', 'COMPLETADA']

export function useCitasSinComision(citas) {
  const [ids, setIds] = useState(SIN_CITAS)
  const visible = usePaginaActiva()

  // Clave estable: cambia solo si cambia alguna cita relevante, su asistente, su estado o sus servicios (no en cada render ni
  // al recargar las mismas citas).
  const clave = citas
    .filter((c) => c.asistente_id && ESTADOS_CON_COMISION_POR_RESOLVER.includes(c.estado))
    .map((c) => `${c.id}:${c.asistente_id}:${c.estado}:${(c.cita_servicios ?? []).map((cs) => cs.servicio_id).join('.')}`)
    .join('|')

  useEffect(() => {
    if (!clave || !visible) return undefined
    let vigente = true
    const idsCitas = clave.split('|').map((fila) => fila.split(':')[0])
    supabase.rpc('citas_sin_comision', { p_cita_ids: idsCitas }).then(({ data, error }) => {
      if (vigente) setIds(error || !Array.isArray(data) ? SIN_CITAS : new Set(data))
    })
    return () => {
      vigente = false
    }
  }, [clave, visible])

  return clave ? ids : SIN_CITAS
}
