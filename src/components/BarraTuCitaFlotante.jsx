import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { usePreciosSeleccion } from '../hooks/usePreciosSeleccion.js'
import { formatearSoles, redondear2 } from '../lib/moneda.js'

// Barra flotante "Tu cita" — Servicios y Detalle del servicio comparten el
// mismo cálculo y comportamiento (docs/diseno-servicios/README.md): cuenta
// y suma los servicios que ya están en el carrito de CITAS
// (serviciosCarrito), no el de productos (/carrito, aparte, con su propio
// ícono en el header). `servicios` son los que la página ya tiene en memoria (desde la Fase 4 el catálogo se lee por páginas, no
// completo): el precio del resto se resuelve por id con usePreciosSeleccion. Cada servicio seleccionado cuenta UNA vez y suma su
// precio una vez, aunque aparezca en varias piezas de la página (héroe, fila, resultados). La cantidad cuenta toda la selección
// aunque falte algún precio; mientras falte el total no se presenta como completo («calculando…» o «Reintentar» si la lectura falló).
export default function BarraTuCitaFlotante({ servicios }) {
  const { serviciosCarrito } = useCarritoCliente()
  const ids = useMemo(() => [...serviciosCarrito].sort(), [serviciosCarrito])
  const refrescarCon = ids.join('|')
  const { precioDe, estado, reintentar } = usePreciosSeleccion({ tabla: 'servicios', ids, conocidos: servicios, refrescarCon })

  let cantidad = 0
  let total = 0
  let pendiente = false
  for (const id of ids) {
    const precio = precioDe(id)
    if (precio === null) continue // la lectura funcionó y ese servicio ya no está disponible
    cantidad += 1
    if (precio === undefined) pendiente = true
    else total += precio
  }
  if (cantidad === 0) return null

  const plural = cantidad === 1 ? 'servicio' : 'servicios'

  const contenido = (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="lw-barra-flotante pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#141417]/95 py-1.5 pl-5 pr-1.5 shadow-2xl backdrop-blur-xl">
        <span className="text-sm text-white">
          <b className="font-semibold">{cantidad}</b>{' '}
          <span className="text-white/60">{plural} en tu cita ·</span>{' '}
          {!pendiente ? (
            <b className="font-semibold">{formatearSoles(redondear2(total))}</b>
          ) : estado === 'error' ? (
            <button type="button" onClick={reintentar} className="font-semibold text-[var(--lw-gold)] underline underline-offset-2">
              Total no disponible · Reintentar
            </button>
          ) : (
            <span className="text-white/60">calculando total…</span>
          )}
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
