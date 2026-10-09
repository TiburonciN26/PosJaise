import { Link, useLocation } from 'react-router-dom'

// Lo que ve un visitante (sin sesión) en el lugar de los controles personales —
// carrito, notificaciones y menú de la cuenta—. Ambos enlaces guardan la página
// actual en location.state.desde para volver aquí tras entrar o registrarse.
// `variante="menu"` es la versión vertical del menú móvil (MenuLateralCliente).
export default function AccionesVisitante({ variante = 'barra', onNavegar }) {
  const { pathname, search } = useLocation()
  const estado = { desde: `${pathname}${search}` }

  if (variante === 'menu') {
    return (
      <div className="flex flex-col gap-2 border-t border-white/10 px-4 pt-4">
        <Link
          to="/login"
          state={estado}
          onClick={onNavegar}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#3a3a3f] px-4 text-sm font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]"
        >
          Iniciar sesión
        </Link>
        <Link
          to="/login?modo=registro"
          state={estado}
          onClick={onNavegar}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          Crear cuenta
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/login"
        state={estado}
        className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-[#3a3a3f] px-3 text-xs font-semibold text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] sm:min-h-11 sm:px-5 sm:text-sm"
      >
        Iniciar sesión
      </Link>
      <Link
        to="/login?modo=registro"
        state={estado}
        className="hidden min-h-11 items-center whitespace-nowrap rounded-full bg-white px-5 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)] sm:inline-flex"
      >
        Crear cuenta
      </Link>
    </div>
  )
}
