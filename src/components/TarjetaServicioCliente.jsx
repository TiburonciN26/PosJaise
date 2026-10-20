import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { formatearSoles } from '../lib/moneda.js'
import { degradadoServicio, formatearDuracion } from '../lib/serviciosVisual.js'

const BUCKET_FOTOS = 'fotos-servicios'

// Tarjeta de servicio del rediseño (docs/diseno-servicios/README.md):
// foto cuadrada radio 10px, etiqueta de categoría abajo a la izquierda,
// flecha ↗ circular blanca abajo a la derecha. Sin corazón, sin "Agregar"
// y sin compartir — eso pasó a vivir en el Detalle del servicio. Toda la
// tarjeta (foto y nombre) es un solo link a /servicios/:id. La usan
// ServiciosCliente (catálogo agrupado y grilla plana) y
// DetalleServicioCliente ("También te puede interesar").
// memo: el carrusel del héroe repinta la página entera cada 5 s; sin esto repintaba también hasta 40 tarjetas sin necesidad.
export default memo(function TarjetaServicioCliente({ servicio, mostrarCategoria = true, precioPrimero = false }) {
  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, servicio.foto_url, 'm')
  const duracion = formatearDuracion(servicio.duracion_min)
  // Si la foto no carga (borrada, sin red) se muestra el degradado de siempre en vez de una imagen rota.
  const [urlFallida, setUrlFallida] = useState(null)

  return (
    <article className="flex min-w-0 flex-col gap-2.5">
      <Link
        to={`/servicios/${servicio.id}`}
        className="group relative block aspect-square overflow-hidden rounded-[10px] bg-[#151517]"
      >
        {urlFoto && urlFoto !== urlFallida ? (
          <img
            src={urlFoto}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setUrlFallida(urlFoto)}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045]"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-white/60"
            style={{ background: degradadoServicio(servicio) }}
          >
            <Sparkles className="h-8 w-8" />
          </div>
        )}

        {mostrarCategoria && servicio.categoria && (
          <span className="absolute bottom-2.5 left-2.5 right-[46px] truncate rounded-[5px] bg-black/70 px-2.5 py-1 text-[9.5px] sm:text-xs font-bold uppercase tracking-wider text-white">
            {servicio.categoria}
          </span>
        )}

        <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </Link>

      {precioPrimero ? (
        <>
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="text-xs text-white/65">desde <b className="text-[13px] sm:text-sm font-semibold text-white">{formatearSoles(servicio.precio)}</b></span>
            {duracion && <span className="shrink-0 text-xs text-white/50">{duracion}</span>}
          </div>
          <Link to={`/servicios/${servicio.id}`} className="text-[15px] sm:text-base font-bold text-white">{servicio.nombre}</Link>
        </>
      ) : (
        <>
      <Link to={`/servicios/${servicio.id}`} className="flex items-baseline justify-between gap-2.5">
        <span className="truncate text-[15px] sm:text-base font-bold text-white">{servicio.nombre}</span>
        <span className="shrink-0 text-xs text-white/65">
          desde <b className="text-[13px] sm:text-sm font-semibold text-white">{formatearSoles(servicio.precio)}</b>
        </span>
      </Link>
      {duracion && <span className="-mt-1.5 text-xs text-white/50">{duracion}</span>}
        </>
      )}
    </article>
  )
})
