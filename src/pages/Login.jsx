import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Pause, Play, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useTemaWeb } from '../context/TemaWebContext.jsx'
import AceptoTerminos from '../components/AceptoTerminos.jsx'
import { precargarPortalEnReposo } from '../config/paginasCliente.js'
import { resolverDestino, rutaInternaSegura } from '../lib/destinoLogin.js'
import { obtenerContacto } from '../lib/datosNegocioWeb.js'
import { useLectura } from '../hooks/useLectura.js'
import { obtenerFotosLogin } from '../lib/fotosLogin.js'
import FotosLogin from '../components/FotosLogin.jsx'
import './Login.css'

function MarcaLogin({ className = '' }) {
  return (
    <div className={`lgn-marca ${className}`}>
      <span className="lgn-marca__nombre">JAISE<span className="lgn-marca__grado">˚</span></span>
      <span className="lgn-marca__academia">BEAUTY ACADEMY</span>
    </div>
  )
}

// Hallazgo crítico reportado por el usuario (no numerado en ninguna
// auditoría formal): al cerrar sesión, el navegador autocompletaba el
// login con el correo/contraseña de quien acababa de salir — grave en un
// POS donde varios empleados comparten el mismo dispositivo/navegador: el
// siguiente en usarlo podía entrar como el anterior sin saber su clave. No
// era un bug de estado de React (email/password acá siempre arrancan en
// '', y Login se desmonta/remonta entero en cada logout, no persiste
// nada) — era el propio navegador guardando y ofreciendo la contraseña,
// invitado exactamente por los atributos autoComplete="email"/
// "current-password" que tenían estos inputs. autoComplete="off" (form +
// email) y "new-password" (el truco estándar para que Chrome/Firefox no
// sugieran una contraseña guardada) lo reducen — no hay forma 100%
// garantizada de bloquear el autocompletado vía estándares web, así que en
// un dispositivo compartido conviene además que el personal rechace el
// "¿Guardar contraseña?" del navegador.
export default function Login() {
  const { tema } = useTemaWeb()
  const contacto = useLectura(obtenerContacto).datos
  const fotos = useLectura(obtenerFotosLogin).datos
  const [fotosPausadas, setFotosPausadas] = useState(false)
  useEffect(() => {
    precargarPortalEnReposo()
  }, [])

  const { usuario, iniciarSesion, registrarCliente, bloqueoLogin } = useAuth()
  const { mostrarToast } = useToast()
  // Quien pidió el login (ruta privada o acción que requiere cuenta, ver RutaPrivada y
  // useRequerirSesion) deja en location.state.desde la ruta a la que quería ir.
  const location = useLocation()
  const [params] = useSearchParams()
  const desde = rutaInternaSegura(location.state?.desde)
  const [modo, setModo] = useState(params.get('modo') === 'registro' ? 'registro' : 'login') // 'login' | 'registro'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const [passwordConfirmar, setPasswordConfirmar] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [terminosAceptados, setTerminosAceptados] = useState(false)

  // Ya con sesión: el destino sale del ROL REAL (cliente → la web; personal → su panel).
  if (usuario) {
    return <Navigate to={resolverDestino(usuario.rol, desde)} replace />
  }

  // El aviso de "negocio cerrado" no lo lanza iniciarSesion (no hay forma
  // de esperarlo ahí sin reabrir la condición de carrera que causaba el
  // bug de "entra un segundo y lo bota" — ver el comentario en
  // AuthContext.cargarPerfil) — llega solo, un instante después, como
  // bloqueoLogin del contexto. Se muestra igual que un error local.
  const mensajeError = error || bloqueoLogin

  function cambiarModo(nuevoModo) {
    setModo(nuevoModo)
    setError('')
    setPassword('')
    setPasswordConfirmar('')
  }

  async function manejarLogin() {
    try {
      await iniciarSesion(email, password)
    } catch (errorLogin) {
      // M6 de la 3ª auditoría: distinguir credenciales incorrectas de un fallo
      // de red. Supabase adjunta un status HTTP 4xx cuando el correo/clave son
      // inválidos; un fallo de conexión (fetch falla, AuthRetryableFetchError)
      // llega sin status numérico. Antes todo caía en "credenciales
      // incorrectas" y el usuario reintentaba datos que sí eran correctas.
      const status = errorLogin?.status
      const esCredenciales = typeof status === 'number' && status >= 400 && status < 500
      setError(
        esCredenciales
          ? 'Correo o contraseña incorrectos.'
          : 'No se pudo conectar. Revisa tu conexión a internet.',
      )
    }
  }

  async function manejarRegistro() {
    if (password !== passwordConfirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (!terminosAceptados) {
      setError('Debes aceptar los términos y condiciones y la política de privacidad.')
      return
    }

    try {
      const { requiereConfirmacion } = await registrarCliente(email, password)
      if (requiereConfirmacion) {
        mostrarToast('Cuenta creada. Revisa tu correo para confirmarla.', 'exito')
        cambiarModo('login')
      }
      // Si no requiere confirmación, la sesión ya quedó activa: el
      // listener de AuthContext carga el perfil solo y este componente
      // navega afuera por el "if (usuario)" de arriba.
    } catch (errorRegistro) {
      const mensaje = errorRegistro?.message ?? ''
      setError(
        mensaje.includes('already registered') || mensaje.includes('already exists')
          ? 'Ese correo ya tiene una cuenta.'
          : mensaje.includes('Password')
            ? 'La contraseña debe tener al menos 6 caracteres.'
            : 'No se pudo crear la cuenta. Intenta de nuevo.',
      )
    }
  }

  async function manejarSubmit(evento) {
    evento.preventDefault()
    setError('')
    setEnviando(true)
    if (modo === 'login') {
      await manejarLogin()
    } else {
      await manejarRegistro()
    }
    setEnviando(false)
  }

  const esLogin = modo === 'login'
  const redes = [
    { nombre: 'Instagram', url: contacto?.instagram_url, icono: 'InstagramColor.svg' },
    { nombre: 'Facebook', url: contacto?.facebook_url, icono: 'facebookColor.svg' },
    { nombre: 'TikTok', url: contacto?.tiktok_url, icono: 'tiktokColor.svg' },
  ].filter((red) => /^https?:\/\//i.test(red.url ?? ''))

  return (
    <main className="lgn" data-tema-login={tema}>
      <div className="lgn-intro" aria-hidden="true">
        <MarcaLogin className="lgn-marca--intro" />
      </div>
      <div className="lgn-distribucion" data-fotos-pausadas={fotosPausadas}>
        <FotosLogin fotos={fotos} pausadas={fotosPausadas}>
          {redes.length > 0 && (
            <nav className="lgn-redes" aria-label="Redes sociales de Jaise">
              {redes.map(({ nombre, url, icono }) => (
                <a key={nombre} href={url} target="_blank" rel="noopener noreferrer" aria-label={nombre} className="lgn-red-social">
                  <img src={`${import.meta.env.BASE_URL}icons/${icono}`} alt="" />
                </a>
              ))}
            </nav>
          )}
          <button
            type="button"
            className="lgn-pausa"
            onClick={() => setFotosPausadas((anterior) => !anterior)}
            aria-label={fotosPausadas ? 'Reanudar presentación de fotos' : 'Pausar presentación de fotos'}
            aria-pressed={fotosPausadas}
          >
            {fotosPausadas ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          </button>
        </FotosLogin>

        <section className="lgn-panel" aria-labelledby="login-titulo">
          <form onSubmit={manejarSubmit} autoComplete="off" className="lgn-formulario" aria-busy={enviando}>
            <Link to="/inicio" aria-label="Jaise Beauty Academy — inicio" className="lgn-logo">
              <MarcaLogin />
            </Link>
            <h1 id="login-titulo" className="lgn-titulo">{esLogin ? 'Bienvenida de nuevo' : 'Crea tu cuenta'}</h1>
            <div className="lgn-grupo lgn-grupo--primero">
              <label htmlFor="email">Email</label>
              <div className="lgn-campo">
                <Mail className="lgn-campo__icono" aria-hidden="true" />
                <input
                  id="email"
                  ref={emailRef}
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(evento) => setEmail(evento.target.value)}
                  placeholder="Ej. maria@gmail.com"
                  aria-invalid={mensajeError ? true : undefined}
                  aria-describedby={mensajeError ? 'login-error' : undefined}
                />
                {email && (
                  <div className="lgn-campo__acciones">
                    <button
                      type="button"
                      className="lgn-borrar"
                      aria-label="Borrar correo"
                      onClick={() => {
                        setEmail('')
                        emailRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="lgn-grupo">
              <label htmlFor="password">Contraseña</label>
              <div className="lgn-campo">
                <LockKeyhole className="lgn-campo__icono" aria-hidden="true" />
                <input
                  id="password"
                  ref={passwordRef}
                  type={mostrarPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(evento) => setPassword(evento.target.value)}
                  placeholder="Contraseña"
                  aria-invalid={mensajeError ? true : undefined}
                  aria-describedby={mensajeError ? 'login-error' : undefined}
                />
                <div className="lgn-campo__acciones">
                  {password && (
                    <button
                      type="button"
                      className="lgn-borrar"
                      aria-label="Borrar contraseña"
                      onClick={() => {
                        setPassword('')
                        passwordRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((valorAnterior) => !valorAnterior)}
                    aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="lgn-ojo"
                  >
                    {mostrarPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>

            {!esLogin && (
              <>
                <div className="lgn-grupo">
                  <label htmlFor="password-confirmar">Confirmar contraseña</label>
                  <div className="lgn-campo">
                    <LockKeyhole className="lgn-campo__icono" aria-hidden="true" />
                    <input
                      id="password-confirmar"
                      type={mostrarPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={passwordConfirmar}
                      onChange={(evento) => setPasswordConfirmar(evento.target.value)}
                      placeholder="Confirmar contraseña"
                    />
                  </div>
                </div>
                <div className="lgn-terminos">
                  <AceptoTerminos id="registro-acepto-terminos" aceptado={terminosAceptados} onCambiar={setTerminosAceptados} />
                </div>
              </>
            )}

            <p id="login-error" role="alert" className="lgn-error">{mensajeError}</p>

            <button type="submit" disabled={enviando} className="lgn-btn" data-cargando={enviando}>
              <span className="lgn-btn__texto">
                {esLogin
                  ? enviando ? 'Entrando...' : 'Ingresar'
                  : enviando ? 'Creando cuenta...' : 'Crear cuenta'}
              </span>
              {enviando && <LoaderCircle className="lgn-cargando" aria-hidden="true" />}
            </button>
            <div className="lgn-divisor" aria-hidden="true"><i /><b>O</b><i /></div>
            {/* Conserva el botón existente; su integración con Google es independiente del diseño. */}
            <button type="button" className="lgn-google">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span>Continuar con Google</span>
            </button>
            <p className="lgn-cambiar-modo">
              {esLogin ? '¿No tienes una cuenta? ' : '¿Ya tienes una cuenta? '}
              <button type="button" onClick={() => cambiarModo(esLogin ? 'registro' : 'login')}>
                {esLogin ? 'Regístrate' : 'Inicia sesión'}
              </button>
            </p>
            <p className="lgn-explorar"><Link to="/inicio">Seguir explorando sin cuenta</Link></p>
          </form>
          <p className="lgn-copyright">Jaise Beauty Academy © 2026</p>
        </section>
      </div>
    </main>
  )
}
