import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const PerfilClienteContext = createContext(null)

// Fuente única del perfil (mi_perfil_cliente(), ver 63_mi_perfil_cliente.sql)
// compartida por el avatar del header (MenuUsuarioCliente) y la pestaña Mi
// Perfil — sin esto, cada uno haría su propio fetch y editar el nombre/foto
// en Mi Perfil no se vería reflejado en el avatar hasta recargar la página.
//
// Sin sesión (visitante en la web pública) no se consulta nada: perfil null y
// cargando false. Al iniciar o cerrar sesión el portal NO se remonta, así que el
// efecto depende del id del usuario: carga el perfil al entrar y lo borra al
// salir (el siguiente visitante nunca ve el perfil anterior).
export function PerfilClienteProvider({ children }) {
  const { usuario } = useAuth()
  const usuarioId = usuario?.id ?? null
  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(Boolean(usuarioId))

  const recargar = useCallback(async () => {
    if (!usuarioId) {
      setPerfil(null)
      setCargando(false)
      return
    }
    const { data } = await supabase.rpc('mi_perfil_cliente')
    setPerfil(data?.[0] ?? null)
    setCargando(false)
  }, [usuarioId])

  useEffect(() => {
    if (usuarioId) setCargando(true)
    recargar()
  }, [usuarioId, recargar])

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

// Variante que no lanza fuera del proveedor: la vista pública de
// Recompensas (sin sesión, fuera de PortalCliente) no tiene perfil.
export function usePerfilClienteOpcional() {
  return useContext(PerfilClienteContext)
}
