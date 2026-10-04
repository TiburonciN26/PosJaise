import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase.js'

// QA-039: cada consulta de Recompensas es un recurso con su propio estado
// — 'cargando' | 'ok' | 'error' — para no confundir una consulta fallida
// con un resultado vacío real (saldo 0, "no tienes cupones"). `datos`
// solo existe cuando el estado es 'ok'; un error NUNCA se traduce a
// null/[] ni a un valor por defecto.
const FUENTES = {
  puntos: async () => {
    const { data, error } = await supabase.rpc('mis_puntos')
    return { error, datos: data?.[0] ?? null }
  },
  fidelizacion: async () => {
    const { data, error } = await supabase.rpc('mi_fidelizacion')
    return { error, datos: data?.[0] ?? null }
  },
  historial: async () => {
    const { data, error } = await supabase.rpc('mi_historial_fidelizacion')
    return { error, datos: data ?? [] }
  },
  cupones: async () => {
    const { data, error } = await supabase.rpc('mis_cupones')
    return { error, datos: data ?? [] }
  },
  promociones: async () => {
    const { data, error } = await supabase
      .from('promociones')
      .select('id, titulo, descripcion, tipo_descuento, valor, vigente_hasta')
      .order('creado_en', { ascending: false })
    return { error, datos: data ?? [] }
  },
}

const CLAVES = Object.keys(FUENTES)
const PENDIENTE = { estado: 'cargando', datos: null }
const RECURSOS_INICIALES = Object.fromEntries(CLAVES.map((clave) => [clave, PENDIENTE]))

// Carga los recursos de la clienta `userId` (null = sin sesión: no se
// consulta nada). Cada recurso se carga y se reintenta por separado, así
// que uno fallido no bloquea a los demás. Los datos quedan atados a la
// cuenta que los pidió: si cambia el usuario, lo anterior deja de verse
// de inmediato y una respuesta tardía de la cuenta previa se descarta.
export function useRecursosRecompensas(userId) {
  const [almacen, setAlmacen] = useState({ dueno: null, recursos: RECURSOS_INICIALES })
  const generacion = useRef(0)
  const duenoActual = useRef(userId)
  duenoActual.current = userId

  const recursos = almacen.dueno === userId ? almacen.recursos : RECURSOS_INICIALES

  const cargar = useCallback(async (clave, { silencioso = false } = {}) => {
    const dueno = duenoActual.current
    if (!dueno) return false
    const gen = generacion.current

    const guardar = (valor) =>
      setAlmacen((previo) => {
        const base = previo.dueno === dueno ? previo.recursos : RECURSOS_INICIALES
        return { dueno, recursos: { ...base, [clave]: valor(base[clave]) } }
      })

    if (!silencioso) guardar(() => PENDIENTE)

    let resultado
    try {
      resultado = await FUENTES[clave]()
    } catch (error) {
      resultado = { error }
    }
    // Otra cuenta (o desmontaje) mientras la consulta volaba: se descarta.
    if (gen !== generacion.current || dueno !== duenoActual.current) return false

    if (resultado.error) {
      // Una actualización silenciosa que falla conserva lo que ya se
      // mostraba (son datos de ESTA cuenta); el que llama avisa con un toast.
      guardar((actual) => (silencioso && actual.estado === 'ok' ? actual : { estado: 'error', datos: null }))
      return false
    }
    guardar(() => ({ estado: 'ok', datos: resultado.datos }))
    return true
  }, [])

  useEffect(() => {
    generacion.current += 1
    if (userId) CLAVES.forEach((clave) => cargar(clave))
    return () => {
      generacion.current += 1
    }
  }, [userId, cargar])

  return { recursos, cargar }
}
