import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones } from '../config/navegacion.js'

export default function Header({ menuAbierto, onToggleMenu }) {
  const { usuario, rol, cerrarSesion } = useAuth()
  const { pathname } = useLocation()
  const seccionesVisibles = secciones.filter((seccion) => seccion.roles.includes(rol))
  const seccionActual = seccionesVisibles.find((seccion) => pathname.startsWith(seccion.path))

  return (
    <header className="border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-4 px-4 py-[7px]">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuAbierto}
            className={`-ml-[7px] shrink-0 px-2.5 py-1.5 text-[24px] leading-none transition-colors duration-150 lg:hidden ${
              menuAbierto ? 'text-amber' : 'text-ink'
            }`}
          >
            ☰
          </button>

          <div className="hidden items-center gap-3 lg:flex">
            <img src={`${import.meta.env.BASE_URL}icon-512.png`} alt="" className="h-6 w-6 rounded-lg object-cover" />
            <span className="font-semibold text-ink">Pos Jaise</span>
          </div>

          <span
            key={pathname}
            className="animate-deslizar-pestana truncate font-semibold text-ink lg:hidden"
          >
            {seccionActual?.label}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}icon-512.png`} alt="" className="h-6 w-6 rounded-lg object-cover" />
          <span className="font-semibold text-ink">Pos Jaise</span>
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <div className="text-right leading-tight">
            <p className="text-sm text-ink">{usuario?.nombre_completo}</p>
            <p className="font-mono text-xs text-amber">{rol}</p>
          </div>
          <button
            type="button"
            onClick={cerrarSesion}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:border-red hover:text-red"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <nav className="hidden border-t border-border lg:flex">
        {seccionesVisibles.map((seccion) => {
          const esRosa = seccion.tema === 'rosa'
          return (
            <NavLink
              key={seccion.path}
              to={seccion.path}
              className={({ isActive }) =>
                `flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-sm transition-colors ${
                  esRosa
                    ? isActive
                      ? 'border-purple-300 text-purple-300'
                      : 'border-transparent text-purple-300/70 hover:text-purple-300'
                    : isActive
                      ? 'border-amber text-amber'
                      : 'border-transparent text-ink/60 hover:text-ink'
                }`
              }
            >
              {seccion.label}
            </NavLink>
          )
        })}
      </nav>
    </header>
  )
}
