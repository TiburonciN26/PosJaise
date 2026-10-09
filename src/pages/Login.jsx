import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import AceptoTerminos from '../components/AceptoTerminos.jsx'
import { precargarPortalEnReposo } from '../config/paginasCliente.js'
import { resolverDestino, rutaInternaSegura } from '../lib/destinoLogin.js'
import fotoLogin from '../assets/login/foto-login.jpeg'

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

  return (
    <main
      className="lgn flex min-h-svh flex-col md:flex-row"
      style={{ '--lgn-foto': `url(${fotoLogin})` }}
    >
      {/* Foto: arriba en móvil, columna izquierda en escritorio */}
      <section
        role="img"
        aria-label="Clienta sonriente en el salón Jaise"
        className="lgn-foto relative h-[290px] shrink-0 overflow-hidden md:h-auto md:flex-[57_1_0%]"
      >
        {/* Logo sobre la foto: solo móvil (en escritorio va dentro de la tarjeta) */}
        <div className="absolute left-[22px] top-[22px] flex flex-col items-center gap-[5px] text-[#0b0b0c] md:hidden">
          <span
            className="flex items-start pl-[0.15em] text-[20px] font-black leading-none tracking-[0.15em]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            JAISE<span className="ml-px mt-[-2px] text-[9px]">˚</span>
          </span>
          <span className="pl-[0.3em] text-[8px] font-bold leading-none tracking-[0.3em]">
            BEAUTY ACADEMY
          </span>
        </div>

        {/* Titular móvil (blanco) */}
        <div
          className="absolute bottom-12 left-[22px] right-[22px] text-[30px] uppercase leading-none tracking-[0.01em] text-white md:hidden"
          style={{ fontFamily: "'Kunaroh', 'Orbitron', sans-serif", textShadow: '0 2px 18px rgba(0,0,0,.32)' }}
        >
          <div className="lgn-a-hl1">Tu academia</div>
          <div className="lgn-a-hl2 mt-1">de belleza</div>
        </div>

        {/* Titular escritorio (oscuro, sobre la foto) */}
        <div
          className="absolute bottom-14 left-8 hidden whitespace-nowrap text-[62px] lowercase leading-none tracking-[0.02em] text-[#0b0b0c] md:block"
          style={{ fontFamily: "'Kunaroh', 'Orbitron', sans-serif" }}
        >
          <div className="lgn-a-hl1">tu salon</div>
          <div className="lgn-a-hl2 mt-5">de belleza</div>
        </div>
      </section>

      {/* Tarjeta de login */}
      <section className="flex grow md:flex-[43_1_0%] md:py-[14px] md:pl-px">
        <form
          onSubmit={manejarSubmit}
          autoComplete="off"
          className="lgn-a-card relative flex w-full flex-col justify-center gap-3 bg-[#0b0b0c] px-7 pb-[26px] pt-[30px] md:justify-start md:gap-0 md:overflow-hidden md:rounded-[26px] md:px-[62px] md:pb-9 md:pt-14 md:shadow-[1px_10px_24px_rgba(0,0,0,0.5),0_1px_3px_rgba(10,14,20,0.05)]"
        >
          {/* Logo en la tarjeta: solo escritorio */}
          <div className="lgn-a-logo hidden flex-col items-center gap-[7px] text-[#f5f5f4] md:flex">
            <span
              className="flex items-start pl-[0.15em] text-[26px] font-black leading-none tracking-[0.15em]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              JAISE<span className="ml-0.5 mt-[-2px] text-[11px]">˚</span>
            </span>
            <span className="pl-[0.3em] text-[9px] font-bold leading-none tracking-[0.3em]">
              BEAUTY ACADEMY
            </span>
          </div>

          <h1
            className="lgn-a-h1 m-0 text-center text-[27px] uppercase leading-[1.05] tracking-[0.02em] text-[#f5f5f4] md:mt-[70px] md:text-[40px] md:leading-none"
            style={{ fontFamily: "'Kunaroh', 'Orbitron', sans-serif", fontWeight: 400 }}
          >
            {esLogin ? '¡Bienvenida!' : 'Crea tu cuenta'}
          </h1>
          <p className="lgn-a-sub m-0 mb-2.5 text-center text-[15px] leading-[1.4] text-[#a1a1aa] md:mb-0 md:mt-3.5 md:text-[19px] md:tracking-[-0.2px]">
            <b className="font-bold text-[#f5f5f4]">{esLogin ? 'Inicia sesión' : 'Regístrate'}</b>{' '}
            para gestionar tus citas.
          </p>
          {desde && (
            <p className="m-0 mb-2.5 text-center text-[13px] leading-[1.4] text-[#a1a1aa] md:mb-0 md:mt-3">
              Necesitas una cuenta para continuar con lo que estabas haciendo.
            </p>
          )}

          <label htmlFor="email" className="sr-only">
            Correo electrónico
          </label>
          <div className="lgn-campo lgn-a-email box-border flex h-[54px] items-center rounded-xl border-[1.5px] border-[#3f3f46] bg-[#18181b] px-4 md:mt-[52px] md:h-[61px] md:px-[17px]">
            <input
              id="email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              placeholder="Ej. maria@gmail.com"
            />
          </div>

          <label htmlFor="password" className="sr-only">
            Contraseña
          </label>
          <div className="lgn-campo lgn-a-pw box-border flex h-[54px] items-center rounded-xl border-[1.5px] border-[#1f1f23] bg-[#1f1f23] px-4 md:mt-2 md:h-[59px] md:px-[18px]">
            <input
              id="password"
              type={mostrarPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(evento) => setPassword(evento.target.value)}
              placeholder="Contraseña"
            />
            <button
              type="button"
              onClick={() => setMostrarPassword((valorAnterior) => !valorAnterior)}
              aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="-mr-2 shrink-0 p-2 text-[#a1a1aa] transition-colors hover:text-[#f5f5f4]"
            >
              {mostrarPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {!esLogin && (
            <>
              <label htmlFor="password-confirmar" className="sr-only">
                Confirmar contraseña
              </label>
              <div className="lgn-campo box-border flex h-[54px] items-center rounded-xl border-[1.5px] border-[#1f1f23] bg-[#1f1f23] px-4 md:mt-2 md:h-[59px] md:px-[18px]">
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
              <div className="md:mt-3">
                <AceptoTerminos
                  id="registro-acepto-terminos"
                  aceptado={terminosAceptados}
                  onCambiar={setTerminosAceptados}
                />
              </div>
            </>
          )}

          {mensajeError && (
            <p
              role="alert"
              className="m-0 rounded-xl border border-red/40 bg-red/10 px-3 py-2 text-sm text-red md:mt-4"
            >
              {mensajeError}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="lgn-btn lgn-a-btn mt-1 flex h-14 cursor-pointer items-center justify-center gap-2.5 rounded-full border-0 bg-[#f5f5f4] text-base font-medium text-[#0b0b0c] shadow-[0_8px_20px_rgba(18,26,34,.16),0_2px_5px_rgba(18,26,34,.10)] disabled:cursor-default disabled:opacity-50 md:mt-[34px] md:h-[65px] md:text-[16.4px] md:tracking-[0.2px]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            <span>
              {esLogin
                ? enviando
                  ? 'Entrando...'
                  : 'Ingresar'
                : enviando
                  ? 'Creando cuenta...'
                  : 'Crear cuenta'}
            </span>
            <svg className="lgn-flecha" width="13" height="13" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M3 11h15.4M11 3.3l7.7 7.7-7.7 7.7" stroke="#0b0b0c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="lgn-a-div my-0.5 flex items-center gap-3.5 md:my-0 md:mt-[34px]" aria-hidden="true">
            <i className="h-[1.5px] flex-1 bg-[#3f3f46]" />
            <b className="text-[11px] font-bold tracking-[0.8px] text-[#a1a1aa]">O</b>
            <i className="h-[1.5px] flex-1 bg-[#3f3f46]" />
          </div>

          {/* Todavía sin implementar: a pedido, no hace nada al presionarlo. */}
          <button
            type="button"
            className="lgn-google lgn-a-g box-border flex h-[54px] cursor-pointer items-center justify-center gap-3.5 rounded-full border-[1.5px] border-[#3f3f46] bg-[#18181b] text-base text-[#f5f5f4] shadow-[0_1px_2px_rgba(0,0,0,.03)] md:mt-[34px] md:h-[59px] md:gap-[17px] md:text-[17px] md:tracking-[-0.2px]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>Continuar con Google</span>
          </button>

          <p className="lgn-a-bottom m-0 mt-2 text-center text-sm text-[#e4e4e7] md:mt-[17px] md:text-[16.4px] md:tracking-[-0.2px]">
            {esLogin ? '¿No tienes una cuenta? ' : '¿Ya tienes una cuenta? '}
            <button
              type="button"
              onClick={() => cambiarModo(esLogin ? 'registro' : 'login')}
              className="cursor-pointer border-0 bg-transparent p-0 font-bold text-[#f5f5f4] underline decoration-2 underline-offset-[3px] hover:text-[#a1a1aa]"
              style={{ font: 'inherit', fontWeight: 700 }}
            >
              {esLogin ? 'Regístrate' : 'Inicia sesión'}
            </button>
          </p>

          <p className="m-0 mt-2 text-center text-sm md:mt-4">
            <Link to="/inicio" className="text-[#a1a1aa] underline underline-offset-[3px] transition-colors hover:text-[#f5f5f4]">
              Seguir explorando sin cuenta
            </Link>
          </p>

          <p className="m-0 mt-auto hidden pt-8 text-center text-[10px] uppercase tracking-[0.2em] text-[#a1a1aa] md:block">
            Jaise Beauty Academy © 2026
          </p>
        </form>
      </section>
    </main>
  )
}
