import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)

  async function cargarPerfil(userId) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo')
      .eq('id', userId)
      .single()

    if (error || !data || !data.activo) {
      setUsuario(null)
      await supabase.auth.signOut()
      return
    }

    setUsuario(data)
  }

  useEffect(() => {
    let vigente = true

    supabase.auth.getSession().then(async ({ data: { session: sesionInicial } }) => {
      if (!vigente) return
      setSession(sesionInicial)
      if (sesionInicial?.user) {
        await cargarPerfil(sesionInicial.user.id)
      }
      if (vigente) setCargando(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_evento, sesionNueva) => {
        setSession(sesionNueva)
        if (sesionNueva?.user) {
          await cargarPerfil(sesionNueva.user.id)
        } else {
          setUsuario(null)
        }
        setCargando(false)
      },
    )

    return () => {
      vigente = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function iniciarSesion(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    usuario,
    rol: usuario?.rol ?? null,
    cargando,
    iniciarSesion,
    cerrarSesion,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider')
  }
  return context
}
