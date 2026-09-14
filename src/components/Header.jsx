import { useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { secciones } from '../config/navegacion.js'
import MenuUsuario from './MenuUsuario.jsx'
import IconoMartillo from './IconoMartillo.jsx'

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
            className={`-ml-[7px] shrink-0 p-2.5 transition-colors duration-150 ${
              menuAbierto ? colorHamburguesaAbierta : 'text-ink'
            }`}
          >
            {menuAbierto ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          <span
            key={pathname}
            className="animate-deslizar-pestana flex min-w-0 items-center gap-1.5 truncate font-semibold text-ink"
          >
            {seccionActual?.icono &&
              (seccionActual.animado ? (
                <IconoMartillo animando className="h-4 w-4 shrink-0" />
              ) : (
                <seccionActual.icono className="h-4 w-4 shrink-0" />
              ))}
            {seccionActual?.label}
          </span>
        </div>

        {/* El logo/estado de negocio que antes vivía acá arriba (disparado
            por el logo) pasó al menú de usuario (avatar, esquina derecha) —
            el logo quedó como firma de marca al fondo de ese menú, no como
            disparador de nada. */}
        <MenuUsuario />
      </div>
    </header>
  )
}
