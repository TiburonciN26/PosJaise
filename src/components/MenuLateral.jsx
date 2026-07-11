import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones } from '../config/navegacion.js'

export default function MenuLateral({ abierto, onCerrar }) {
  const { rol, usuario, cerrarSesion } = useAuth()
  const seccionesVisibles = secciones.filter((seccion) => seccion.roles.includes(rol))

  return (
    <div
      className={`absolute inset-0 z-20 lg:hidden ${abierto ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!abierto}
    >
      <button
        type="button"
        aria-label="Cerrar menú"
        tabIndex={abierto ? 0 : -1}
        onClick={onCerrar}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ease-in-out ${
          abierto ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <nav
        className={`absolute inset-y-0 left-0 flex w-48 flex-col border-r border-border bg-surface py-3 shadow-[4px_0_16px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-in-out ${
          abierto ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        {seccionesVisibles.map((seccion) => {
          const esRosa = seccion.tema === 'rosa'
          return (
            <NavLink
              key={seccion.path}
              to={seccion.path}
              tabIndex={abierto ? 0 : -1}
              onClick={onCerrar}
              className={({ isActive }) =>
                `flex items-center gap-2.5 border-l-2 px-4 py-2.5 text-sm transition-colors duration-150 ${
                  esRosa
                    ? isActive
                      ? 'border-purple-300 bg-surface-2 text-purple-300'
                      : 'border-transparent text-purple-300/70 hover:bg-surface-2 hover:text-purple-300'
                    : isActive
                      ? 'border-amber bg-surface-2 text-amber'
                      : 'border-transparent text-ink/70 hover:bg-surface-2 hover:text-ink'
                }`
              }
            >
              <seccion.icono className="h-4 w-4 shrink-0" />
              {seccion.label}
            </NavLink>
          )
        })}

        <div className="mt-auto border-t border-border px-4 pt-3">
          <p className="truncate text-sm text-ink">{usuario?.nombre_completo}</p>
          <p className="font-mono text-xs text-amber">{rol}</p>
          <p className="mt-1 truncate font-mono text-xs text-ink/60">{usuario?.email}</p>
          <button
            type="button"
            onClick={cerrarSesion}
            className="mt-3 w-full rounded-lg border border-border-strong py-1.5 text-sm text-ink transition-colors hover:border-red hover:text-red"
          >
            Cerrar sesión
          </button>
        </div>
      </nav>
    </div>
  )
}
