import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'

const AuthContext = createContext(null)

const CLAVE_MODO_VISTA = 'modoVista'

// sessionStorage (no localStorage): sobrevive a un refresh de la página
// (F5) — el bug reportado — pero se borra solo al cerrar la pestaña/
// ventana, así que nunca deja "modo cliente" pegado para una sesión de
// personal completamente distinta en otra pestaña u otro día.
function leerModoVistaGuardado() {
  try {
    return sessionStorage.getItem(CLAVE_MODO_VISTA) === 'CLIENTE' ? 'CLIENTE' : 'STAFF'
  } catch {
    return 'STAFF'
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorPerfil, setErrorPerfil] = useState(false)
  const [bloqueoLogin, setBloqueoLogin] = useState(null)
  // Una asistente/cajera/admin a veces también es clienta del salón — con
  // el mismo correo, no uno nuevo (Supabase Auth no permite dos cuentas
  // con el mismo correo, así que "Crear cuenta" en el login de clientes
  // no es una opción para ella). "modoVista" deja que la MISMA sesión de
  // personal entre al portal Web sin dejar de ser personal: cargarPerfil
  // sigue resolviendo "usuario"/"rol" como personal siempre (ver arriba,
  // corta camino ANTES de mirar clientes_web) — modoVista es un flag
  // aparte que App.jsx usa para decidir qué árbol de rutas montar. Se
  // reinicia a 'STAFF' en cada cierre de sesión para que la próxima nunca
  // arranque directo en modo cliente por accidente. Bug reportado: sin
  // persistir esto, un F5 estando en modo cliente perdía el estado (React
  // vuelve a montar todo desde cero) y la app regresaba sola al POS —
  // por eso el valor inicial se lee de sessionStorage, y un efecto lo
  // mantiene sincronizado ahí en cada cambio.
  const [modoVista, setModoVista] = useState(leerModoVistaGuardado)

  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_MODO_VISTA, modoVista)
    } catch {
      // Almacenamiento bloqueado (modo privado, cuota, etc.) — la sesión
      // sigue funcionando, solo no sobrevive a un refresh.
    }
  }, [modoVista])

  // Perfil de un cliente de la pestaña Web (auto-registrado, sin fila en
  // "usuarios"). Siempre deja a "usuario" (o errorPerfil/bloqueoLogin)
  // resuelto por su cuenta — cargarPerfil no necesita mirar el resultado,
  // solo evitar seguir con su propio manejo de "cuenta inválida" después.
  const cargarPerfilCliente = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('clientes_web')
      .select('id, email, activo')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setErrorPerfil(true)
      return
    }

    if (data) {
      if (!data.activo) {
        setUsuario(null)
        setErrorPerfil(false)
        setBloqueoLogin('Esta cuenta está desactivada. Contacta al negocio.')
        await supabase.auth.signOut()
        return
      }

      setErrorPerfil(false)
      setBloqueoLogin(null)
      setUsuario({ ...data, rol: 'CLIENTE' })
      return
    }

    // Primer login de una cuenta recién confirmada: la fila de perfil se
    // crea recién acá (no en el registro), porque si el proyecto exige
    // confirmar el correo, en el momento del registro todavía no hay
    // sesión con la que cumplir la política RLS "id = auth.uid()".
    const { data: { user: usuarioAuth } } = await supabase.auth.getUser()
    const { data: creado, error: errorCreado } = await supabase
      .from('clientes_web')
      .insert({ id: userId, email: usuarioAuth?.email ?? '' })
      .select('id, email, activo')
      .single()

    if (errorCreado) {
      setErrorPerfil(true)
      return
    }

    setErrorPerfil(false)
    setBloqueoLogin(null)
    setUsuario({ ...creado, rol: 'CLIENTE' })
  }, [])

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

    // Sin fila en "usuarios": no es personal, puede ser un cliente de la
    // pestaña Web (se auto-registra, no lo crea un admin). Se resuelve en
    // clientes_web en vez de tratarlo como cuenta inválida/desactivada.
    if (!data) {
      await cargarPerfilCliente(userId)
      return
    }

    if (!data.activo) {
      // Antes esto salía completamente mudo: sin data.activo, se cerraba
      // sesión sin avisar nada y el usuario se quedaba viendo el
      // formulario de login sin entender por qué "no pasa nada" al
      // ingresar datos correctos. Mismo canal que el bloqueo de negocio
      // cerrado (bloqueoLogin), que Login.jsx ya sabe mostrar.
      setUsuario(null)
      setErrorPerfil(false)
      setBloqueoLogin('Esta cuenta está desactivada. Contacta al administrador.')
      await supabase.auth.signOut()
      return
    }

    if (esNuevoLogin && data.rol !== 'ADMINISTRADOR') {
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
  }, [cargarPerfilCliente])

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
    setModoVista('STAFF')
  }, [])

  // Para personal (asistente/cajera/admin) que también es clienta: crea
  // su fila en clientes_web con el MISMO auth.uid() si todavía no la
  // tiene (nunca pasa por auth.signUp — ya está autenticada, y de todos
  // modos Supabase Auth rechazaría un segundo registro con ese correo) y
  // cambia el modo de vista. Es idempotente: si ya tenía perfil de
  // clienta, el insert choca con la PK (23505) y se ignora sin problema —
  // el botón que llama a esto puede usarse cualquier cantidad de veces.
  // El resto (vincular su perfil de negocio, historial, etc.) lo resuelve
  // el flujo normal de Mi Perfil, igual que cualquier clienta nueva.
  const entrarComoClienta = useCallback(async () => {
    const {
      data: { user: usuarioAuth },
    } = await supabase.auth.getUser()
    if (!usuarioAuth) return

    const { error } = await supabase
      .from('clientes_web')
      .insert({ id: usuarioAuth.id, email: usuarioAuth.email ?? '' })

    if (error && error.code !== '23505') throw error

    setModoVista('CLIENTE')
  }, [])

  const volverAlPos = useCallback(() => {
    setModoVista('STAFF')
  }, [])

  // Registro de clientes de la pestaña Web (self-service, distinto del
  // alta de personal que hace el admin). La fila en clientes_web no se
  // crea acá: si el proyecto exige confirmar el correo, signUp puede no
  // devolver sesión todavía, y sin sesión no se cumple la política RLS
  // de clientes_web ("id = auth.uid()"). Se crea sola en cargarPerfilCliente
  // en el primer login con sesión real. Devuelve si ya quedó sesión activa
  // (confirmación desactivada) o si falta confirmar el correo.
  const registrarCliente = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return { requiereConfirmacion: !data.session }
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
      modoVista,
      reintentarPerfil,
      iniciarSesion,
      cerrarSesion,
      registrarCliente,
      actualizarFotoPerfil,
      entrarComoClienta,
      volverAlPos,
    }),
    [
      session,
      usuario,
      cargando,
      errorPerfil,
      bloqueoLogin,
      modoVista,
      reintentarPerfil,
      iniciarSesion,
      cerrarSesion,
      registrarCliente,
      actualizarFotoPerfil,
      entrarComoClienta,
      volverAlPos,
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
