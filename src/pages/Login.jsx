import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { usuario, iniciarSesion } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (usuario) {
    return <Navigate to="/" replace />
  }

  async function manejarSubmit(evento) {
    evento.preventDefault()
    setError('')
    setEnviando(true)
    try {
      await iniciarSesion(email, password)
    } catch {
      setError('Correo o contraseña incorrectos.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-bg p-4">
      <form
        onSubmit={manejarSubmit}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-8"
      >
        <h1 className="mb-1 text-center text-xl font-semibold text-ink">
          POS Negocio 2
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
          autoComplete="email"
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
          autoComplete="current-password"
          value={password}
          onChange={(evento) => setPassword(evento.target.value)}
          placeholder="••••••••"
          className="mb-4 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-ink outline-none focus:border-amber"
        />

        {error && (
          <p className="mb-4 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
            {error}
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
