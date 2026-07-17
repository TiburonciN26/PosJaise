import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { secciones } from '../config/navegacion.js'
import MenuUsuario from './MenuUsuario.jsx'

export default function Header({ menuAbierto, onToggleMenu }) {
  const { rol } = useAuth()
  const { tema } = useTheme()
  const { pathname } = useLocation()
  const seccionesVisibles = secciones.filter((seccion) => seccion.roles.includes(rol))
  const seccionActual = seccionesVisibles.find((seccion) => pathname.startsWith(seccion.path))
  // Pedido puntual: en claro, el botón hamburguesa abierto va en rosa
  // (como las pestañas rosadas) en vez de ámbar — solo en claro.
  const colorHamburguesaAbierta = tema === 'claro' ? 'text-purple-300' : 'text-amber'

  return (
    <header className="border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-4 px-4 py-[7px]">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuAbierto}
            className={`-ml-[7px] shrink-0 p-2.5 transition-colors duration-150 lg:hidden ${
              menuAbierto ? colorHamburguesaAbierta : 'text-ink'
            }`}
          >
            {menuAbierto ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          <span
            key={pathname}
            className="animate-deslizar-pestana truncate font-semibold text-ink lg:hidden"
          >
            {seccionActual?.label}
          </span>
        </div>

        {/* El logo/estado de negocio que antes vivía acá arriba (disparado
            por el logo) pasó al menú de usuario (avatar, esquina derecha) —
            el logo quedó como firma de marca al fondo de ese menú, no como
            disparador de nada. */}
        <MenuUsuario />
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
