import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

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
  const { usuario, iniciarSesion, bloqueoLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (usuario) {
    return <Navigate to="/" replace />
  }

  // El aviso de "negocio cerrado" no lo lanza iniciarSesion (no hay forma
  // de esperarlo ahí sin reabrir la condición de carrera que causaba el
  // bug de "entra un segundo y lo bota" — ver el comentario en
  // AuthContext.cargarPerfil) — llega solo, un instante después, como
  // bloqueoLogin del contexto. Se muestra igual que un error local.
  const mensajeError = error || bloqueoLogin

  async function manejarSubmit(evento) {
    evento.preventDefault()
    setError('')
    setEnviando(true)
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
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-bg p-4">
      <form
        onSubmit={manejarSubmit}
        autoComplete="off"
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-8"
      >
        <h1 className="mb-1 text-center text-xl font-semibold text-ink">
          Pos Jaise
        </h1>
        <p className="mb-6 text-center font-mono text-sm text-ink/60">
          Iniciar sesión
        </p>

        <label htmlFor="email" className="mb-1 block text-sm text-ink/80">
          Correo
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className="mb-4 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-ink outline-none focus:border-amber"
        />

        <label htmlFor="password" className="mb-1 block text-sm text-ink/80">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(evento) => setPassword(evento.target.value)}
          placeholder="••••••••"
          className="mb-4 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-ink outline-none focus:border-amber"
        />

        {mensajeError && (
          <p className="mb-4 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
            {mensajeError}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-amber px-4 py-2 font-medium text-bg disabled:opacity-50"
        >
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
