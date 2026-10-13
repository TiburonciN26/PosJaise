import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'

// Fase 8 (PERF-11): el iframe de Google Maps descargaba ~470 kB y ~16 peticiones al abrir Inicio aunque el mapa estuviera a varias
// pantallas de distancia: `loading="lazy"` solo depende de la distancia que decida el navegador (más amplia en redes rápidas).
// Aquí el iframe NO existe hasta que ocurre una de dos cosas:
//   · la sección entra de verdad en el viewport (IntersectionObserver con un margen corto, `margen`), o
//   · la persona pulsa «Ver mapa».
// Con «ahorrar datos» (Save-Data) o sin IntersectionObserver se exige el botón. Mientras tanto se muestra un marcador con la
// dirección y el enlace «Cómo llegar» de la página sigue funcionando sin cargar nada de Google.
//
// `contenedorClase` va en el contenedor que ocupa el hueco (para no cambiar el diseño); el iframe conserva sus atributos originales.
export default function MapaDiferido({ direccion, titulo = 'Ubicación en el mapa', margen = '150px', contenedorClase = 'h-full w-full' }) {
  const refCaja = useRef(null)
  const [activo, setActivo] = useState(false)

  useEffect(() => {
    if (activo || !direccion) return undefined
    const ahorrar = typeof navigator !== 'undefined' && navigator.connection?.saveData === true
    if (ahorrar || typeof IntersectionObserver === 'undefined') return undefined
    const nodo = refCaja.current
    if (!nodo) return undefined
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setActivo(true)
          observador.disconnect()
        }
      },
      { rootMargin: margen },
    )
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [activo, direccion, margen])

  if (!direccion) {
    return (
      <div className="flex h-full items-center justify-center text-white/25">
        <MapPin className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div ref={refCaja} data-mapa-diferido={activo ? 'activo' : 'pendiente'} className={contenedorClase}>
      {activo ? (
        <iframe
          title={titulo}
          src={`https://www.google.com/maps?q=${encodeURIComponent(direccion)}&output=embed`}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <button
          type="button"
          onClick={() => setActivo(true)}
          className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-white/60 transition-colors hover:text-white/90"
        >
          <MapPin className="h-8 w-8" />
          <span className="text-sm">Ver mapa</span>
          <span className="max-w-full truncate text-xs text-white/40">{direccion}</span>
        </button>
      )}
    </div>
  )
}
