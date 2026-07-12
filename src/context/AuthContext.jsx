import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorPerfil, setErrorPerfil] = useState(false)

  // A2 de la 3ª auditoría: un fallo de red al leer el perfil NO cierra la
  // sesión — antes cualquier error del select disparaba signOut(), y un
  // parpadeo de conexión expulsaba al usuario. Solo se cierra sesión cuando
  // Supabase respondió bien y el perfil de verdad no existe o está inactivo.
  // maybeSingle() (no single()) para que "0 filas" llegue como data null,
  // no mezclado con los errores de red.
  async function cargarPerfil(userId) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      // Transitorio (red, timeout): se conserva la sesión y el perfil ya
      // cargado si lo hay; App muestra "reintentar" si aún no había perfil.
      setErrorPerfil(true)
      return
    }

    if (!data || !data.activo) {
      setUsuario(null)
      setErrorPerfil(false)
      await supabase.auth.signOut()
      return
    }

    setErrorPerfil(false)
    setUsuario(data)
  }

  async function reintentarPerfil() {
    const { data: { session: sesionActual } } = await supabase.auth.getSession()
    if (sesionActual?.user) {
      setCargando(true)
      await cargarPerfil(sesionActual.user.id)
      setCargando(false)
    }
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
    errorPerfil,
    reintentarPerfil,
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
