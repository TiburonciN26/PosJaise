import { ChevronLeft, Menu, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { PerfilClienteProvider } from '../context/PerfilClienteContext.jsx'
import { seccionesCliente, titulosSubpaginasCliente } from '../config/navegacionCliente.js'
import MenuUsuarioCliente from '../components/MenuUsuarioCliente.jsx'
import MenuLateralCliente from '../components/MenuLateralCliente.jsx'

// Shell de la pestaña Web para clientes: deliberadamente NO usa Layout ni
// MenuLateral del POS (ni su config de navegacion.js) — un cliente con
// rol 'CLIENTE' (ver AuthContext.cargarPerfilCliente) nunca llega a montar
// esos componentes.
//
// Mismo patrón responsive que Header.jsx/MenuLateral.jsx del POS: en
// móvil, el hamburguesa abre un drawer (MenuLateralCliente) con las
// pestañas principales, y la fila 2 del header muestra el título de dónde
// estás en vez de la barra; en desktop no hay hamburguesa, la fila 2 es
// la barra de pestañas de siempre.
export default function PortalCliente() {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [errorLogo, setErrorLogo] = useState(false)

  const esPestanaPrincipal = seccionesCliente.some((seccion) => seccion.path === location.pathname)
  const tituloActual = esPestanaPrincipal
    ? seccionesCliente.find((seccion) => seccion.path === location.pathname)?.label
    : titulosSubpaginasCliente[location.pathname]

  return (
    <PerfilClienteProvider>
      <div className="flex h-svh flex-col bg-bg text-ink">
        <header className="border-b border-border bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMenuAbierto((valorAnterior) => !valorAnterior)}
                aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
                aria-expanded={menuAbierto}
                className="-ml-1.5 shrink-0 p-1.5 text-ink lg:hidden"
              >
                {menuAbierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <Link to="/inicio" className="flex min-w-0 items-center gap-2">
                {!errorLogo && (
                  <img
                    src={`${import.meta.env.BASE_URL}icon-192.png`}
                    alt=""
                    onError={() => setErrorLogo(true)}
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                )}
                <span className="nombre-marca-web truncate">Jaise Beauty Academy</span>
              </Link>
            </div>

            <MenuUsuarioCliente />
          </div>

          {/* Móvil: título de dónde estás (con flecha de volver si es una
              subpágina, ver titulosSubpaginasCliente). Desktop: barra de
              pestañas completa — ver clases lg: de cada bloque. */}
          <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center border-t border-border px-2 py-2.5 lg:hidden">
            {esPestanaPrincipal ? (
              <span aria-hidden="true" />
            ) : (
              <button
                type="button"
                onClick={() => navigate('/inicio')}
                aria-label="Volver"
                className="flex h-9 w-9 items-center justify-center text-ink/70 transition-colors hover:text-amber"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <span className="text-center text-sm font-semibold text-ink">{tituloActual}</span>
            <span aria-hidden="true" />
          </div>

          <nav className="hidden border-t border-border lg:flex">
            {seccionesCliente.map((seccion) => (
              <NavLink
                key={seccion.path}
                to={seccion.path}
                className={({ isActive }) =>
                  `flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-amber text-amber'
                      : 'border-transparent text-ink/60 hover:text-ink'
                  }`
                }
              >
                <seccion.icono className="h-4 w-4 shrink-0" />
                {seccion.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <div className="relative flex flex-1 overflow-hidden">
          <main className="flex flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
          <MenuLateralCliente abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
        </div>
      </div>
    </PerfilClienteProvider>
  )
}
