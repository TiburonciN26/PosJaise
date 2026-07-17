import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const EstadoNegocioContext = createContext(null)

// Única fuente de verdad: la fila public.estado_negocio en Supabase (ver
// 44_estado_negocio.sql), no una variable local — todo dispositivo
// conectado la lee al montar y se mantiene al día vía Realtime, sin
// necesidad de recargar la página.
export function EstadoNegocioProvider({ children }) {
  const { session } = useAuth()
  // Fail-open a propósito: esto es solo para la UI (mostrar el aviso,
  // habilitar/deshabilitar botones). La barrera real está en el servidor
  // (RLS + RPCs en 45_negocio_cerrado_bloquea_escrituras.sql), así que un
  // valor optimista acá no abre ningún hueco de seguridad.
  const [abierto, setAbierto] = useState(true)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!session) {
      setCargando(false)
      return undefined
    }

    let vigente = true

    supabase
      .from('estado_negocio')
      .select('abierto')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!vigente) return
        if (data) setAbierto(data.abierto)
        setCargando(false)
      })

    const canal = supabase
      .channel('estado_negocio')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'estado_negocio' },
        (payload) => {
          if (vigente) setAbierto(payload.new.abierto)
        },
      )
      .subscribe()

    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [session])

  // El servidor decide quién puede llamar esto (RLS admin-only) — acá no
  // se repite ese chequeo, solo se propaga el error si Supabase lo rechaza.
  const cambiarEstado = useCallback(async (nuevoAbierto) => {
    const { error } = await supabase
      .from('estado_negocio')
      .update({ abierto: nuevoAbierto })
      .eq('id', 1)
    if (error) throw error
    setAbierto(nuevoAbierto)
  }, [])

  const value = useMemo(
    () => ({ abierto, cargando, cambiarEstado }),
    [abierto, cargando, cambiarEstado],
  )

  return <EstadoNegocioContext.Provider value={value}>{children}</EstadoNegocioContext.Provider>
}

export function useEstadoNegocio() {
  const context = useContext(EstadoNegocioContext)
  if (!context) {
    throw new Error('useEstadoNegocio debe usarse dentro de un EstadoNegocioProvider')
  }
  return context
}
