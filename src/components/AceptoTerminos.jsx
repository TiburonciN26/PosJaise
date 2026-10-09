import { Link } from 'react-router-dom'
import { RUTAS_LEGALES } from '../config/legal.js'

// Casilla obligatoria «He leído y acepto…» (la pasarela exige que la clienta acepte,
// no solo que los textos existan). Los enlaces abren en pestaña nueva para no perder
// el carrito. `incluirCambios` agrega la Política de cambios y devoluciones (compras
// y reservas); en el registro de cuenta se usa Términos + Privacidad.
// Pensado para fondos oscuros (portal y tarjeta del login).
const ENLACE = 'underline text-[var(--lw-gold)] hover:text-white'

export default function AceptoTerminos({ id, aceptado, onCambiar, incluirCambios = false }) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={aceptado}
        onChange={(evento) => onCambiar(evento.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#3ECF6A]"
      />
      <label htmlFor={id} className="cursor-pointer text-[13px] leading-snug text-white/70">
        He leído y acepto los{' '}
        <Link to={RUTAS_LEGALES.terminos} target="_blank" rel="noopener noreferrer" className={ENLACE}>
          Términos y condiciones
        </Link>
        {incluirCambios ? (
          <>
            {' '}y la{' '}
            <Link to={RUTAS_LEGALES.cambios} target="_blank" rel="noopener noreferrer" className={ENLACE}>
              Política de cambios y devoluciones
            </Link>
          </>
        ) : (
          <>
            {' '}y la{' '}
            <Link to={RUTAS_LEGALES.privacidad} target="_blank" rel="noopener noreferrer" className={ENLACE}>
              Política de privacidad
            </Link>
          </>
        )}
        <span className="text-red-500" aria-hidden="true"> *</span>
      </label>
    </div>
  )
}
