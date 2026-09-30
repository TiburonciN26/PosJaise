import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../lib/moneda.js'

// Barra flotante "Tu cita" — Servicios y Detalle del servicio comparten el
// mismo cálculo y comportamiento (docs/diseno-servicios/README.md): cuenta
// y suma los servicios que ya están en el carrito de CITAS
// (serviciosCarrito), no el de productos (/carrito, aparte, con su propio
// ícono en el header). `servicios` es el catálogo que ya cargó la página
// (para sacar nombre/precio de cada id sin una consulta aparte).
export default function BarraTuCitaFlotante({ servicios }) {
  const { serviciosCarrito } = useCarritoCliente()

  const seleccionados = servicios.filter((s) => serviciosCarrito.has(s.id))
  if (seleccionados.length === 0) return null

  const total = seleccionados.reduce((suma, s) => suma + Number(s.precio), 0)
  const plural = seleccionados.length === 1 ? 'servicio' : 'servicios'

  const contenido = (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#141417]/95 py-1.5 pl-5 pr-1.5 shadow-2xl backdrop-blur-xl">
        <span className="text-sm text-white">
          <b className="font-semibold">{seleccionados.length}</b>{' '}
          <span className="text-white/60">{plural} en tu cita ·</span>{' '}
          <b className="font-semibold">{formatearSoles(total)}</b>
        </span>
        <Link
          to="/citas/carrito"
          className="flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-sm font-semibold text-black"
          style={{ background: 'var(--lw-gold)' }}
        >
          Reservar
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>
    </div>
  )

  // Portal directo a .landing-web (no a document.body): ServiciosCliente/
  // DetalleServicioCliente viven adentro del <main overflow-hidden> de
  // PortalCliente.jsx — un "fixed" ahí adentro queda recortado por ese
  // overflow (bug real de CSS, no de React: overflow-hidden en un
  // ancestro recorta a los descendientes fixed, aunque su containing
  // block sea el viewport). Portalear directo a .landing-web lo saca de
  // ese overflow y, a la vez, sigue heredando --lw-gold (declarada ahí,
  // no en :root).
  const objetivo = typeof document !== 'undefined' ? document.querySelector('.landing-web') : null
  return objetivo ? createPortal(contenido, objetivo) : contenido
}
