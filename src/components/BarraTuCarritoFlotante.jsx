import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCarritoCliente } from '../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../lib/moneda.js'

// Barra flotante "Tu carrito" de Productos y su Detalle
// (docs/diseno-productos/README.md, sección 6/11) — mismo patrón que
// BarraTuCitaFlotante.jsx (cita de servicios), pero sobre
// `productosCarrito` (Map id → cantidad) en vez de `serviciosCarrito`.
// `productos` es el catálogo que ya cargó la página, para sacar
// nombre/precio de cada id sin una consulta aparte.
export default function BarraTuCarritoFlotante({ productos }) {
  const { productosCarrito } = useCarritoCliente()

  const porId = new Map(productos.map((p) => [p.id, p]))
  let cantidadTotal = 0
  let total = 0
  for (const [id, cantidad] of productosCarrito) {
    const producto = porId.get(id)
    if (!producto) continue
    cantidadTotal += cantidad
    total += Number(producto.precio) * cantidad
  }
  if (cantidadTotal === 0) return null

  const plural = cantidadTotal === 1 ? 'producto' : 'productos'

  const contenido = (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#141417]/95 py-1.5 pl-5 pr-1.5 shadow-2xl backdrop-blur-xl">
        <span className="text-sm text-white">
          <b className="font-semibold">{cantidadTotal}</b> <span className="text-white/60">{plural} en tu carrito ·</span>{' '}
          <b className="font-semibold">{formatearSoles(total)}</b>
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
