import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowBigDown, Search, X } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

// Barra fija del catálogo de Servicios y Productos: etiqueta "Categorías n",
// el chip de la categoría activa («Todos» por defecto) que abre una lista
// vertical con su conteo (mismo estilo que el selector de Recompensas),
// búsqueda y total. Al elegir una categoría la lista se pliega.
// `categorias` incluye 'todos' primero; `conteos` es { categoria: n }.
//
// El texto de búsqueda vive AQUÍ mientras se escribe: teclear solo vuelve a pintar esta barra, no toda la página del catálogo
// (héroe, cintas, filas), que en un móvil lento costaba cientos de ms por tecla. La página recibe `onBusqueda` recién tras una
// pausa (RETARDO_BUSQUEDA_MS), una petición por pausa y no por tecla; vaciar el campo avisa al instante para volver a «Todos».
const RETARDO_BUSQUEDA_MS = 250

export default function BarraCatalogo({
  categorias,
  conteos,
  categoriaActiva,
  onElegirCategoria,
  busqueda,
  onBusqueda,
  placeholder,
  etiquetaTotal,
  selectorCategoriasMovil,
  className = '',
  style,
}) {
  const [abierto, setAbierto] = useState(false)
  const barraRef = useRef(null)
  const [texto, setTexto] = useState(busqueda)
  const ultimoEnviado = useRef(busqueda)

  // Si la página cambia el texto por su cuenta (no es el eco de lo que enviamos), la caja lo sigue.
  useEffect(() => {
    if (busqueda !== ultimoEnviado.current) {
      ultimoEnviado.current = busqueda
      setTexto(busqueda)
    }
  }, [busqueda])

  useEffect(() => {
    if (texto === ultimoEnviado.current) return undefined
    const enviar = () => {
      ultimoEnviado.current = texto
      startTransition(() => onBusqueda(texto)) // la página reacomoda su contenido en rebanadas, sin bloquear la caja
    }
    if (!texto.trim()) {
      enviar()
      return undefined
    }
    const id = setTimeout(enviar, RETARDO_BUSQUEDA_MS)
    return () => clearTimeout(id)
  }, [texto, onBusqueda])

  useCerrarConEscape(() => setAbierto(false), abierto, { trabajoPendiente: false })

  // Clic fuera de la barra: pliega la lista (mismo patrón que el menú del avatar).
  useEffect(() => {
    if (!abierto) return undefined
    function alClicFuera(evento) {
      if (barraRef.current && !barraRef.current.contains(evento.target)) setAbierto(false)
    }
    document.addEventListener('pointerdown', alClicFuera)
    return () => document.removeEventListener('pointerdown', alClicFuera)
  }, [abierto])

  const reales = useMemo(() => categorias.filter((c) => c !== 'todos'), [categorias])

  function elegir(categoria) {
    setAbierto(false)
    onElegirCategoria(categoria)
  }

  return (
    <div
      ref={barraRef}
      className={`sticky top-0 z-10 border-y border-white/10 bg-[#0b0b0c]/90 lw-gutter pb-3 backdrop-blur ${className}`}
      style={style}
    >
      <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-3">
        {selectorCategoriasMovil}
        <div className={`min-w-0 flex-1 items-center gap-2 ${selectorCategoriasMovil ? 'hidden sm:flex' : 'flex'}`}>
          <span className="inline-flex h-[34px] shrink-0 items-center gap-2 pr-1 text-[11px] font-semibold uppercase tracking-wider text-white">
            Categorías
            <span className="text-white/50">{reales.length}</span>
          </span>
          {/* El chip de la categoría activa («Todos» por defecto) es el que abre la lista. */}
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setAbierto((anterior) => !anterior)}
              aria-expanded={abierto}
              aria-controls="lista-categorias"
              aria-label={`Categoría elegida: ${categoriaActiva}. ${abierto ? 'Cerrar' : 'Abrir'} lista de categorías`}
              className="inline-flex h-[34px] max-w-full items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--lw-fg)] transition-opacity hover:opacity-70"
            >
              <span className="truncate">{categoriaActiva}</span>
              <ArrowBigDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${abierto ? 'rotate-180' : ''}`} />
            </button>

            {/* Lista (no botones-chip): filas planas como el selector de Recompensas. */}
            <div
              id="lista-categorias"
              role="group"
              aria-label="Categorías"
              aria-hidden={!abierto}
              inert={!abierto}
              data-abierto={abierto}
              className="recompensas-selector__lista absolute left-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-20px)]"
            >
              <div className="max-h-[40svh] space-y-[2px] overflow-y-auto bg-[var(--lw-card)] px-(--pading-horizontal-boton) py-(--pading-vertical-boton) shadow-lg">
                {categorias.map((categoria) => (
                  <button
                    key={categoria}
                    type="button"
                    aria-pressed={categoriaActiva === categoria}
                    onClick={() => elegir(categoria)}
                    className={`flex w-full items-center justify-between gap-3 rounded-none border-0 px-(--pading-horizontal-boton) py-(--pading-vertical-boton) text-left text-[13px] leading-normal transition-colors hover:bg-[var(--lw-border)] ${
                      categoriaActiva === categoria
                        ? 'bg-[var(--lw-border)] font-semibold text-[var(--lw-gold)]'
                        : 'bg-transparent text-[var(--lw-fg)]'
                    }`}
                  >
                    <span className="truncate capitalize">{categoria}</span>
                    {categoria !== 'todos' && <span className="shrink-0 opacity-60">{conteos[categoria] ?? 0}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <label className={`lw-buscador flex h-[38px] items-center gap-2 rounded-full bg-[#18181b] px-3.5 text-white/50 sm:w-[230px] ${selectorCategoriasMovil ? 'min-w-0 flex-1 sm:flex-none' : 'w-full'}`}>
          <Search className="h-[15px] w-[15px] shrink-0" />
          <input
            type="text"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            placeholder={placeholder}
            aria-label={placeholder.replace('…', '')}
            className="w-full min-w-0 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
          />
          {texto && (
            <button type="button" onClick={() => setTexto('')} aria-label="Limpiar" className="shrink-0 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <span className="hidden shrink-0 text-[11px] uppercase tracking-wider text-white/50 sm:inline">
          {etiquetaTotal}
        </span>
      </div>
    </div>
  )
}
