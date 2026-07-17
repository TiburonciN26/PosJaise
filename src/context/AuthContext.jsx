import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorPerfil, setErrorPerfil] = useState(false)
  const [bloqueoLogin, setBloqueoLogin] = useState(null)

  // A2 de la 3ª auditoría: un fallo de red al leer el perfil NO cierra la
  // sesión — antes cualquier error del select disparaba signOut(), y un
  // parpadeo de conexión expulsaba al usuario. Solo se cierra sesión cuando
  // Supabase respondió bien y el perfil de verdad no existe o está inactivo.
  // maybeSingle() (no single()) para que "0 filas" llegue como data null,
  // no mezclado con los errores de red.
  //
  // esNuevoLogin (true solo en el evento SIGNED_IN, ver el listener más
  // abajo) es clave para el bloqueo de negocio cerrado: signInWithPassword
  // dispara ese evento de forma asíncrona e independiente de iniciarSesion
  // — si el chequeo de "asistente + negocio cerrado" viviera aparte (como
  // en un primer intento), este mismo cargarPerfil ya habría corrido antes
  // desde el propio evento y dejado a "usuario" seteado un instante, y
  // Login.jsx ya habría navegado adentro antes de que el chequeo tardío
  // alcanzara a echarlo — eso se vivía como "entra un segundo y lo bota".
  // Haciendo el chequeo ACÁ, en el único lugar que decide setUsuario, no
  // hay ventana en la que la app llegue a mostrarse.
  const cargarPerfil = useCallback(async (userId, esNuevoLogin = false) => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo, foto_url')
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

    if (esNuevoLogin && data.rol === 'ASISTENTE') {
      const { data: estado } = await supabase
        .from('estado_negocio')
        .select('abierto')
        .eq('id', 1)
        .maybeSingle()

      if (estado?.abierto === false) {
        setUsuario(null)
        setErrorPerfil(false)
        setBloqueoLogin(MENSAJE_NEGOCIO_CERRADO)
        await supabase.auth.signOut()
        return
      }
    }

    setErrorPerfil(false)
    setBloqueoLogin(null)
    setUsuario(data)
  }, [])

  const reintentarPerfil = useCallback(async () => {
    const { data: { session: sesionActual } } = await supabase.auth.getSession()
    if (sesionActual?.user) {
      setCargando(true)
      await cargarPerfil(sesionActual.user.id)
      setCargando(false)
    }
  }, [cargarPerfil])

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

    // A1 de la 4ª auditoría: la documentación de supabase-js advierte no
    // hacer await de llamadas de Supabase (incluida signOut, que cargarPerfil
    // puede disparar) DENTRO del callback de onAuthStateChange — corre
    // sosteniendo el lock interno de auth, y una llamada que necesite ese
    // mismo lock puede colgarse ahí. Se manifestaba como un "Cargando..."
    // infinito intermitente, sin poder reproducirlo a voluntad. El
    // setTimeout(0) saca todo el trabajo async fuera de ese contexto antes
    // de tocar Supabase.
    const { data: listener } = supabase.auth.onAuthStateChange((evento, sesionNueva) => {
      setTimeout(async () => {
        if (!vigente) return
        setSession(sesionNueva)
        if (sesionNueva?.user) {
          // Solo un login recién hecho (SIGNED_IN) es candidato al bloqueo
          // de negocio cerrado — restaurar una sesión ya existente (al
          // recargar la página, o un TOKEN_REFRESHED) no debe expulsar a
          // un asistente que ya estaba adentro: eso se maneja aparte con
          // el aviso de UI (ver EstadoNegocioContext + Layout.jsx), no
          // cortando la sesión de golpe.
          await cargarPerfil(sesionNueva.user.id, evento === 'SIGNED_IN')
        } else {
          setUsuario(null)
        }
        if (vigente) setCargando(false)
      }, 0)
    })

    return () => {
      vigente = false
      listener.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  // El bloqueo de "asistente + negocio cerrado" vive en cargarPerfil (ver
  // arriba) — acá solo se dispara el login y se limpia cualquier aviso
  // viejo del intento anterior.
  const iniciarSesion = useCallback(async (email, password) => {
    setBloqueoLogin(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const cerrarSesion = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // El RPC (46_foto_perfil_usuario.sql) es la única puerta de escritura —
  // solo puede tocar foto_url de la propia fila (auth.uid()), nunca
  // rol/activo/etc. Tras confirmarse en el servidor, se actualiza el
  // estado local sin volver a pedir todo el perfil.
  const actualizarFotoPerfil = useCallback(async (fotoUrl) => {
    const { error } = await supabase.rpc('actualizar_mi_foto_perfil', { p_foto_url: fotoUrl })
    if (error) throw error
    setUsuario((anterior) => (anterior ? { ...anterior, foto_url: fotoUrl } : anterior))
  }, [])

  // Memoizado (M5): el value solo cambia cuando cambia sesión/usuario/estado,
  // no en cada render — las funciones ya son estables por useCallback.
  const value = useMemo(
    () => ({
      session,
      usuario,
      rol: usuario?.rol ?? null,
      cargando,
      errorPerfil,
      bloqueoLogin,
      reintentarPerfil,
      iniciarSesion,
      cerrarSesion,
      actualizarFotoPerfil,
    }),
    [
      session,
      usuario,
      cargando,
      errorPerfil,
      bloqueoLogin,
      reintentarPerfil,
      iniciarSesion,
      cerrarSesion,
      actualizarFotoPerfil,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider')
  }
  return context
}
