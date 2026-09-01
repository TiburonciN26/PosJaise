import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const PerfilClienteContext = createContext(null)

// Fuente única del perfil (mi_perfil_cliente(), ver 63_mi_perfil_cliente.sql)
// compartida por el avatar del header (MenuUsuarioCliente) y la pestaña Mi
// Perfil — sin esto, cada uno haría su propio fetch y editar el nombre/foto
// en Mi Perfil no se vería reflejado en el avatar hasta recargar la página.
export function PerfilClienteProvider({ children }) {
  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(true)

  const recargar = useCallback(async () => {
    const { data } = await supabase.rpc('mi_perfil_cliente')
    setPerfil(data?.[0] ?? null)
    setCargando(false)
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  // setPerfil se expone para que, tras guardar en el modal de edición, se
  // pinte al toque con la fila que ya devolvió la propia RPC de guardado —
  // sin esperar un round-trip extra solo para refrescar el header.
  const value = useMemo(
    () => ({ perfil, cargando, recargar, setPerfil }),
    [perfil, cargando, recargar],
  )

  return <PerfilClienteContext.Provider value={value}>{children}</PerfilClienteContext.Provider>
}

export function usePerfilCliente() {
  const context = useContext(PerfilClienteContext)
  if (!context) {
    throw new Error('usePerfilCliente debe usarse dentro de un PerfilClienteProvider')
  }
  return context
}
