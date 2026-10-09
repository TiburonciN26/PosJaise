import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const NotificacionesClienteContext = createContext(null)

// Solo el contador de no leídas (para la insignia en MenuUsuarioCliente) —
// mismo motivo que CarritoClienteContext: un solo fetch compartido, no uno
// por componente. La lista completa la trae NotificacionesCliente.jsx por su
// cuenta (no hace falta guardarla acá, nadie más la necesita).
// Sin sesión no hay nada que contar: no consulta y deja el contador en 0.
export function NotificacionesClienteProvider({ children }) {
  const { usuario } = useAuth()
  const usuarioId = usuario?.id ?? null
  const [noLeidas, setNoLeidas] = useState(0)

  const recargar = useCallback(async () => {
    if (!usuarioId) {
      setNoLeidas(0)
      return
    }
    const { count } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('leida', false)
    setNoLeidas(count ?? 0)
  }, [usuarioId])

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
