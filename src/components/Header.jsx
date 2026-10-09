import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { secciones } from '../config/navegacion.js'
import MenuUsuario from './MenuUsuario.jsx'
import IconoMartillo from './IconoMartillo.jsx'
import IconoCampana from './IconoCampana.jsx'

export default function Header({ menuAbierto, onToggleMenu }) {
  const { rol } = useAuth()
  const { tema } = useTheme()
  const { mostrarToast } = useToast()
  const { pathname } = useLocation()
  const seccionesVisibles = secciones.filter((seccion) => seccion.roles.includes(rol))
  const seccionActual = seccionesVisibles.find((seccion) => pathname.startsWith(seccion.path))
  // Migaja: una subpestaña (con `padre`) muestra "Padre | Hija", con el padre
  // como enlace para volver sin abrir el menú lateral.
  const seccionPadre = seccionActual?.padre
    ? seccionesVisibles.find((seccion) => seccion.path === seccionActual.padre)
    : null
  // Pedido puntual: en claro, el botón hamburguesa abierto va en rosa
  // (como las pestañas rosadas) en vez de ámbar — solo en claro.
  const colorHamburguesaAbierta = tema === 'claro' ? 'text-purple-300' : 'text-amber'

  return (
    <header className="border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-4 px-4 py-[7px]">
        <div className="flex min-w-0 items-center">
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
            className="animate-deslizar-pestana flex min-w-0 items-center gap-1.5 font-semibold text-ink"
          >
            {seccionPadre && (
              <>
                <Link
                  to={seccionPadre.path}
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink/60 transition-colors hover:text-amber"
                >
                  {seccionPadre.icono &&
                    (seccionPadre.animado ? (
                      <IconoMartillo animando className="h-3 w-3 shrink-0" />
                    ) : (
                      <seccionPadre.icono className="h-3 w-3 shrink-0" />
                    ))}
                  {seccionPadre.label}
                </Link>
                <span aria-hidden="true" className="shrink-0 text-ink/40">
                  |
                </span>
              </>
            )}
            <span className={`flex min-w-0 items-center gap-1.5 ${seccionPadre ? 'text-amber' : ''}`}>
              {seccionActual?.icono &&
                (seccionActual.animado ? (
                  <IconoMartillo animando className="h-4 w-4 shrink-0" />
                ) : (
                  <seccionActual.icono className="h-4 w-4 shrink-0" />
                ))}
              <span className="truncate">{seccionActual?.label}</span>
            </span>
          </span>
        </div>

        {/* El logo/estado de negocio que antes vivía acá arriba (disparado
            por el logo) pasó al menú de usuario (avatar, esquina derecha) —
            el logo quedó como firma de marca al fondo de ese menú, no como
            disparador de nada. */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Campana de notificaciones para el personal — solo el ícono
              por ahora (sin badge real: todavía no existe ningún sistema
              de notificaciones para el staff, esa es una tarea aparte,
              futura — ver implementacionesWed.md). Tocarla no abre nada
              todavía, a propósito. */}
          <IconoCampana
            grande
            contador={0}
            className="mr-1.5 text-ink hover:text-amber"
            onClick={() => mostrarToast('Notificaciones del personal — próximamente.', 'info')}
          />
          <MenuUsuario />
        </div>
      </div>
    </header>
  )
}
