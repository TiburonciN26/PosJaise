import { Link } from 'react-router-dom'
import { ArrowUpRight, Package } from 'lucide-react'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { formatearSoles } from '../lib/moneda.js'
import { degradadoServicio } from '../lib/serviciosVisual.js'

const BUCKET_FOTOS = 'fotos-productos'

export function stockTexto(producto) {
  if (producto.stock_actual <= 0) return 'Agotado'
  if (producto.stock_actual <= 5) return `Últimas ${producto.stock_actual} unidades`
  return 'En stock'
}

export function porcentajeDescuento(producto) {
  if (!producto.precio_antes) return null
  return Math.round((1 - Number(producto.precio) / Number(producto.precio_antes)) * 100)
}

// Tarjeta de producto del rediseño (docs/diseno-productos/README.md) —
// nace de TarjetaServicioCliente.jsx (misma foto cuadrada radio 10px,
// etiqueta abajo-izquierda, flecha ↗ circular blanca abajo-derecha) y le
// agrega lo propio de un producto: etiqueta "−X%" con puntito rosa si
// está en oferta, precio anterior tachado y una línea de stock. Si está
// agotado, la foto va atenuada y la etiqueta pasa a decir "Agotado". Sin
// corazón, compartir, selector de cantidad ni "Agregar" — todo eso vive
// en el Detalle (DetalleProductoCliente.jsx). Ya no usa la tarjeta
// iridiscente `.iri-*` (esas clases se quedan en index.css sin tocar,
// por si algo más las sigue usando). La usan ProductosCliente (catálogo
// agrupado y grilla plana), la cinta de Ofertas/Destacados y
// DetalleProductoCliente ("También te puede interesar").
export default function TarjetaProductoCliente({ producto }) {
  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url, 'm')
  const agotado = producto.stock_actual <= 0
  const descuento = porcentajeDescuento(producto)

  return (
    <article className="flex min-w-0 flex-col gap-2.5">
      <Link
        to={`/productos/${producto.id}`}
        className="group relative block aspect-square overflow-hidden rounded-[10px] bg-[#151517]"
      >
        {urlFoto ? (
          <img
            src={urlFoto}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045] ${agotado ? 'opacity-45' : ''}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center text-white/60 ${agotado ? 'opacity-45' : ''}`}
            style={{ background: degradadoServicio(producto) }}
          >
            <Package className="h-8 w-8" />
          </div>
        )}

        {descuento != null && !agotado && (
          <span className="absolute left-2.5 top-2.5 z-[2] inline-flex items-center gap-1.5 rounded-[5px] bg-black/80 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-white">
            <span className="h-[5px] w-[5px] rounded-full bg-[var(--lw-rose)]" />
            −{descuento}%
          </span>
        )}

        <div className="absolute bottom-2.5 left-2.5 right-[46px] z-[2] flex flex-wrap gap-1.5">
          {agotado && (
            <span className="rounded-[5px] bg-black/80 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-white">
              Agotado
            </span>
          )}
          {(producto.subcategoria || producto.categoria) && !agotado && (
            <span className="truncate rounded-[5px] bg-black/70 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-white">
              {producto.subcategoria || producto.categoria}
            </span>
          )}
        </div>

        <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </Link>

      <Link to={`/productos/${producto.id}`} className="flex items-baseline justify-between gap-2.5">
        <span className="truncate text-[15px] font-bold text-white">{producto.nombre}</span>
        <span className="shrink-0 text-xs text-white/65">
          {producto.precio_antes && <s className="mr-1.5 text-white/40">{formatearSoles(producto.precio_antes)}</s>}
          <b className="text-[13px] font-semibold text-white">{formatearSoles(producto.precio)}</b>
        </span>
      </Link>
      <span className="-mt-1.5 text-xs text-white/50">{stockTexto(producto)}</span>
    </article>
  )
}
