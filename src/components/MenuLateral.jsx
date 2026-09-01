import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ArrowBigDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { secciones } from '../config/navegacion.js'
import IconoMartillo from './IconoMartillo.jsx'

function clasesFila(seccion, isActive, opacidadRosaInactiva, opacidadRojoInactiva) {
  const esRosa = seccion.tema === 'rosa'
  const esRojo = seccion.tema === 'rojo'
  if (esRojo) {
    return isActive
      ? 'border-red bg-surface-2 text-red'
      : `border-transparent ${opacidadRojoInactiva} hover:bg-surface-2 hover:text-red`
  }
  if (esRosa) {
    return isActive
      ? 'border-purple-300 bg-surface-2 text-purple-300'
      : `border-transparent ${opacidadRosaInactiva} hover:bg-surface-2 hover:text-purple-300`
  }
  return isActive
    ? 'border-amber bg-surface-2 text-amber'
    : 'border-transparent text-ink/70 hover:bg-surface-2 hover:text-ink'
}

export default function MenuLateral({ abierto, onCerrar }) {
  const { rol } = useAuth()
  const { tema } = useTheme()
  const seccionesVisibles = secciones.filter((seccion) => seccion.roles.includes(rol))
  // Las pestañas con "padre" (ej. Deudas -> Clientes) no aparecen sueltas
  // en la lista — solo se revelan al desplegar la pestaña de la que
  // cuelgan (ver abajo, seccionesAbiertas).
  const seccionesTop = seccionesVisibles.filter((seccion) => !seccion.padre)
  const [seccionesAbiertas, setSeccionesAbiertas] = useState(() => new Set())

  // El cajón queda montado siempre (solo se traslada fuera de pantalla al
  // cerrar, ver el nav de abajo) — sin esto, un desplegable como Deudas
  // seguía expandido la próxima vez que se abría el menú.
  useEffect(() => {
    if (!abierto) setSeccionesAbiertas(new Set())
  }, [abierto])

  function alternarSeccionAbierta(path) {
    setSeccionesAbiertas((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(path)) siguiente.delete(path)
      else siguiente.add(path)
      return siguiente
    })
  }

  // En claro, el rosa pastel a 70% quedaba poco legible sobre el fondo
  // claro — un poco más de opacidad, solo acá (pestañas inactivas del
  // menú lateral) y solo en este tema; en oscuro se deja como estaba.
  const opacidadRosaInactiva = tema === 'claro' ? 'text-purple-300/90' : 'text-purple-300/70'
  const opacidadRojoInactiva = tema === 'claro' ? 'text-red/90' : 'text-red/70'

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
        className={`absolute inset-0 bg-black/35 transition-opacity duration-300 ease-in-out ${
          abierto ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <nav
        className={`absolute inset-y-0 left-0 flex w-48 flex-col border-r border-border bg-surface py-3 transition-transform duration-300 ease-in-out ${
          abierto
            ? 'translate-x-0 shadow-[4px_0_16px_rgba(0,0,0,0.45)]'
            : '-translate-x-full pointer-events-none'
        }`}
      >
        {seccionesTop.map((seccion) => {
          const hijos = seccionesVisibles.filter((otra) => otra.padre === seccion.path)
          const tieneHijos = hijos.length > 0
          const expandido = tieneHijos && seccionesAbiertas.has(seccion.path)

          return (
            <div key={seccion.path}>
              <div className="relative">
                <NavLink
                  to={seccion.path}
                  tabIndex={abierto ? 0 : -1}
                  onClick={onCerrar}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 border-l-2 py-2.5 pl-4 text-sm transition-colors duration-150 ${
                      tieneHijos ? 'pr-9' : 'pr-4'
                    } ${clasesFila(seccion, isActive, opacidadRosaInactiva, opacidadRojoInactiva)}`
                  }
                >
                  {seccion.animado ? (
                    <IconoMartillo animando={abierto} className="h-4 w-4 shrink-0" />
                  ) : (
                    <seccion.icono className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{seccion.label}</span>
                </NavLink>

                {tieneHijos && (
                  <button
                    type="button"
                    onClick={() => alternarSeccionAbierta(seccion.path)}
                    aria-label={expandido ? `Ocultar ${hijos[0].label}` : `Mostrar ${hijos[0].label}`}
                    aria-expanded={expandido}
                    tabIndex={abierto ? 0 : -1}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-ink/40 transition-colors hover:text-ink"
                  >
                    <ArrowBigDown
                      className={`h-3.5 w-3.5 transition-transform duration-300 ${
                        expandido ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                )}
              </div>

              {tieneHijos &&
                expandido &&
                hijos.map((hijo) => (
                  <NavLink
                    key={hijo.path}
                    to={hijo.path}
                    tabIndex={abierto ? 0 : -1}
                    onClick={onCerrar}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 border-l-2 py-2.5 pl-8 pr-4 text-sm transition-colors duration-150 ${clasesFila(hijo, isActive, opacidadRosaInactiva, opacidadRojoInactiva)}`
                    }
                  >
                    <hijo.icono className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{hijo.label}</span>
                  </NavLink>
                ))}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
