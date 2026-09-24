import { NavLink } from 'react-router-dom'
import { seccionesCliente } from '../config/navegacionCliente.js'

// Mismo patrón que MenuLateral.jsx (POS) — overlay + drawer que desliza
// desde la izquierda, solo visible en móvil (en desktop las pestañas
// siguen en la barra de PortalCliente). Acá siempre son las mismas dos
// (Inicio, Servicios); crece solo si seccionesCliente crece.
export default function MenuLateralCliente({ abierto, onCerrar }) {
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
        className={`absolute inset-y-0 left-0 flex w-48 flex-col border-r border-white/10 bg-[var(--lw-card)] py-3 transition-transform duration-300 ease-in-out ${
          abierto ? 'translate-x-0 shadow-[4px_0_16px_rgba(0,0,0,0.45)]' : '-translate-x-full pointer-events-none'
        }`}
      >
        {seccionesCliente.map((seccion) => (
          <NavLink
            key={seccion.path}
            to={seccion.path}
            tabIndex={abierto ? 0 : -1}
            onClick={onCerrar}
            className={({ isActive }) =>
              `flex items-center gap-2.5 border-l-2 px-4 py-2.5 text-sm transition-colors duration-150 ${
                isActive
                  ? 'border-[var(--lw-gold)] bg-white/5 text-[var(--lw-gold)]'
                  : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <seccion.icono className="h-4 w-4 shrink-0" />
            {seccion.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
