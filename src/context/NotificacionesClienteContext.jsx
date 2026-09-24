import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const NotificacionesClienteContext = createContext(null)

// Solo el contador de no leídas (para la insignia en MenuUsuarioCliente) —
// mismo motivo que CarritoClienteContext: un solo fetch compartido, no uno
// por componente. La lista completa la trae NotificacionesCliente.jsx por su
// cuenta (no hace falta guardarla acá, nadie más la necesita).
export function NotificacionesClienteProvider({ children }) {
  const [noLeidas, setNoLeidas] = useState(0)

  const recargar = useCallback(async () => {
    const { count } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('leida', false)
    setNoLeidas(count ?? 0)
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  const value = useMemo(() => ({ noLeidas, recargar }), [noLeidas, recargar])

  return (
    <NotificacionesClienteContext.Provider value={value}>{children}</NotificacionesClienteContext.Provider>
  )
}

export function useNotificacionesCliente() {
  const context = useContext(NotificacionesClienteContext)
  if (!context) {
    throw new Error('useNotificacionesCliente debe usarse dentro de un NotificacionesClienteProvider')
  }
  return context
}
