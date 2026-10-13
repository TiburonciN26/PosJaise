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
  // Fase 2: libro de monedas y sellos (vacío/null mientras el programa esté apagado).
  saldo: async () => {
    const { data, error } = await supabase.rpc('mi_saldo_recompensas')
    return { error, datos: data?.[0] ?? null }
  },
  catalogoMonedas: async () => {
    const { data, error } = await supabase.rpc('mi_catalogo_recompensas', { p_origen: 'MONEDAS' })
    return { error, datos: data ?? [] }
  },
  catalogoSellos: async () => {
    const { data, error } = await supabase.rpc('mi_catalogo_recompensas', { p_origen: 'SELLOS' })
    return { error, datos: data ?? [] }
  },
  movimientos: async () => {
    const { data, error } = await supabase.rpc('mis_movimientos_recompensas')
    return { error, datos: data ?? [] }
  },
  sellosMovs: async () => {
    const { data, error } = await supabase.rpc('mis_sellos_recompensas')
    return { error, datos: data ?? [] }
  },
  // Programa APAGADO (heredado): porcentaje del cupón de la tarjeta de sellos (config_fidelizacion, editable por administración).
  cuponSellos: async () => {
    const { data, error } = await supabase.from('config_fidelizacion').select('porcentaje_recompensa').eq('id', 1).maybeSingle()
    return { error, datos: data ?? null }
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

// Recursos de la clienta `userId` (null = sin sesión: no se consulta nada). Fase 5: NO se piden todos al abrir la pantalla; cada
// subpestaña pide los suyos al entrar (`asegurar`), una sola vez por cuenta, y lo ya leído se conserva al cambiar de subpestaña
// (los reintentos y las actualizaciones tras un canje usan `cargar`). Cada recurso se carga y se reintenta por separado, así que
// uno fallido no bloquea a los demás. Los datos quedan atados a la cuenta que los pidió: si cambia el usuario, lo anterior deja de
// verse de inmediato y una respuesta tardía de la cuenta previa se descarta.
export function useRecursosRecompensas(userId) {
  const [almacen, setAlmacen] = useState({ dueno: null, recursos: RECURSOS_INICIALES })
  const generacion = useRef(0)
  const duenoActual = useRef(userId)
  const pedidas = useRef(new Set())
  duenoActual.current = userId

  const recursos = almacen.dueno === userId ? almacen.recursos : RECURSOS_INICIALES

  const cargar = useCallback(async (clave, { silencioso = false } = {}) => {
    const dueno = duenoActual.current
    if (!dueno) return false
    pedidas.current.add(clave)
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

  // Al cambiar de cuenta (o al montar) se invalida lo que volaba y se olvida qué recursos se habían pedido.
  useEffect(() => {
    generacion.current += 1
    pedidas.current = new Set()
    return () => {
      generacion.current += 1
    }
  }, [userId])

  // Pide los recursos de la subpestaña actual que esta cuenta todavía no pidió.
  const asegurar = useCallback(
    (claves) => {
      if (!duenoActual.current) return
      for (const clave of claves) if (!pedidas.current.has(clave)) cargar(clave)
    },
    [cargar],
  )

  return { recursos, cargar, asegurar }
}

// Catálogo PÚBLICO (QA-037): sin sesión, solo lo publicado, sin datos personales ni
// costos internos. Un error nunca se presenta como catálogo vacío.
export function useCatalogoPublico(activo) {
  const [estado, setEstado] = useState({ estado: 'cargando', datos: null })
  const generacion = useRef(0)
  const terminado = useRef(false)

  const cargar = useCallback(async () => {
    const gen = ++generacion.current
    setEstado({ estado: 'cargando', datos: null })
    let r
    try {
      r = await supabase.rpc('catalogo_recompensas_publico')
    } catch (error) {
      r = { error }
    }
    if (gen !== generacion.current) return
    terminado.current = !r.error
    setEstado(r.error ? { estado: 'error', datos: null } : { estado: 'ok', datos: r.data ?? [] })
  }, [])

  // Solo se vuelve a leer si la lectura anterior NO terminó bien: volver a «Canjear puntos» con el catálogo ya leído no repite la
  // consulta. Se decide por «terminó», no por «se pidió»: el replay de efectos de StrictMode (desarrollo) invalida la primera
  // respuesta con el cleanup y la segunda ejecución debe poder volver a pedir.
  useEffect(() => {
    if (activo && !terminado.current) cargar()
    return () => {
      generacion.current += 1
    }
  }, [activo, cargar])

  return { catalogoPublico: estado, recargarCatalogoPublico: cargar }
}
