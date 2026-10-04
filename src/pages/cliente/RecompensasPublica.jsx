import { Suspense } from 'react'
import { Link } from 'react-router-dom'
import { pagina } from '../../config/paginasCliente.js'

const { RecompensasCliente } = pagina

// QA-037: "Canjear puntos" y "Cómo funciona" se pueden explorar sin
// iniciar sesión (docs/diseno-recompensas/README.md). El guard global
// (RutaProtegida) manda todo lo demás a /login, así que esta es una ruta
// APARTE, solo para /recompensas y solo cuando no hay usuario (ver
// App.jsx): no reutiliza PortalCliente a propósito, porque ese monta
// perfil, carrito, notificaciones y menú del avatar, todos con consultas
// personales. Acá solo hay un encabezado mínimo y la misma pantalla en
// modo `publico`: las secciones personales muestran la puerta de inicio
// de sesión y nunca consultan ni muestran datos de nadie.
export default function RecompensasPublica() {
  return (
    <div className="landing-web flex h-svh flex-col">
      <header className="fixed inset-x-0 top-0 z-50 flex h-12 items-center bg-[#0b0b0c] px-4 pt-2 sm:h-[72px] sm:px-6 md:px-8">
        <div className="mx-auto flex w-full max-w-[1700px] items-center justify-between gap-3">
          <Link
            to="/login"
            aria-label="Jaise Beauty Academy — iniciar sesión"
            className="flex flex-col items-center gap-0.5 leading-none"
          >
            <span
              className="pl-[0.15em] text-[14px] font-black tracking-[0.19em] text-white sm:text-[24px]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              JAISE
            </span>
            <span className="pl-[0.3em] text-[6px] font-bold tracking-[0.3em] text-white/50">BEAUTY ACADEMY</span>
          </Link>
          <Link
            to="/login"
            className="inline-flex min-h-11 items-center rounded-full border border-[#3a3a3f] px-5 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
          >
            Iniciar sesión
          </Link>
        </div>
      </header>

      <div className="relative flex flex-1 flex-col overflow-hidden pt-12 sm:pt-[72px]">
        <main className="flex flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-6">
                <p className="font-mono text-sm text-white/50">Cargando...</p>
              </div>
            }
          >
            <RecompensasCliente publico />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
