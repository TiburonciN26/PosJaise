import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { usePreciosSeleccion } from '../hooks/usePreciosSeleccion.js'
import { formatearSoles, redondear2 } from '../lib/moneda.js'

// Barra flotante "Tu carrito" de Productos y su Detalle
// (docs/diseno-productos/README.md, sección 6/11) — mismo patrón que
// BarraTuCitaFlotante.jsx (cita de servicios), pero sobre
// `productosCarrito` (Map id → cantidad) en vez de `serviciosCarrito`.
// `productos` son los que la página ya tiene en memoria (no el catálogo completo: desde la Fase 4 los catálogos se leen por
// páginas). El precio del resto se resuelve por id con usePreciosSeleccion (ver ese hook: caché por sesión, reconciliada con lo que
// muestra la página y con vigencia). La cantidad cuenta TODO lo seleccionado aunque aún no se conozca su precio; mientras falte alguno
// el total NO se presenta como completo: dice «calculando…» o, si la lectura falló, ofrece reintentar.
export default function BarraTuCarritoFlotante({ productos }) {
  const { productosCarrito } = useCarritoCliente()
  const ids = useMemo(() => [...productosCarrito.keys()].sort(), [productosCarrito])
  const refrescarCon = useMemo(() => [...productosCarrito].sort().join('|'), [productosCarrito])
  const { precioDe, estado, reintentar } = usePreciosSeleccion({ tabla: 'productos', ids, conocidos: productos, refrescarCon })

  let cantidadTotal = 0
  let total = 0
  let pendiente = false
  for (const [id, cantidad] of productosCarrito) {
    const precio = precioDe(id)
    if (precio === null) continue // la lectura funcionó y ese producto ya no está disponible
    cantidadTotal += cantidad
    if (precio === undefined) pendiente = true
    else total += precio * cantidad
  }
  if (cantidadTotal === 0) return null

  const plural = cantidadTotal === 1 ? 'producto' : 'productos'

  const contenido = (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="lw-barra-flotante pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#141417]/95 py-1.5 pl-5 pr-1.5 shadow-2xl backdrop-blur-xl">
        <span className="text-sm text-white">
          <b className="font-semibold">{cantidadTotal}</b> <span className="text-white/60">{plural} en tu carrito ·</span>{' '}
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
          to="/carrito"
          className="flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-sm font-semibold text-black"
          style={{ background: 'var(--lw-gold)' }}
        >
          Ver carrito
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>
    </div>
  )

  // Portal directo a .landing-web (no document.body) — mismo motivo que
  // BarraTuCitaFlotante.jsx: el <main overflow-hidden> de PortalCliente.jsx
  // recorta cualquier "fixed" adentro, y .landing-web es donde vive --lw-gold.
  const objetivo = typeof document !== 'undefined' ? document.querySelector('.landing-web') : null
  return objetivo ? createPortal(contenido, objetivo) : contenido
}
