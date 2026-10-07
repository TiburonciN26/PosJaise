import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowBigDown, Search, X } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

// Barra fija del catálogo de Servicios y Productos: botón "Categorías"
// (despliega hacia abajo, dentro de la propia barra, la lista completa con
// su conteo), chips "Todos" + la categoría elegida, búsqueda y total. Al
// elegir una categoría la lista se pliega con la misma animación y la
// elegida queda marcada al lado de "Todos".
// `categorias` incluye 'todos' primero; `conteos` es { categoria: n }.
export default function BarraCatalogo({
  categorias,
  conteos,
  categoriaActiva,
  onElegirCategoria,
  busqueda,
  onBusqueda,
  placeholder,
  etiquetaTotal,
  className = '',
  style,
}) {
  const [abierto, setAbierto] = useState(false)
  const barraRef = useRef(null)

  useCerrarConEscape(() => setAbierto(false), abierto)

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

  const claseChip = (activa) =>
    `lw-chip-cat inline-flex h-[34px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
      activa
        ? 'lw-chip-cat-on border-transparent bg-white text-black'
        : 'border-transparent bg-[#18181b] text-[#d6d6da] hover:text-white'
    }`

  return (
    <div
      ref={barraRef}
      className={`sticky top-0 z-10 border-y border-white/10 bg-[#0b0b0c]/90 lw-gutter pb-3 pt-5 backdrop-blur sm:pt-[26px] ${className}`}
      style={style}
    >
      <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => setAbierto((anterior) => !anterior)}
            aria-expanded={abierto}
            aria-controls="lista-categorias"
            className="inline-flex h-[34px] shrink-0 items-center gap-2 pr-2 text-[11px] font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-70"
          >
            Categorías
            <span className="text-white/50">{reales.length}</span>
            <ArrowBigDown className={`h-3.5 w-3.5 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <button type="button" onClick={() => elegir('todos')} className={claseChip(categoriaActiva === 'todos')}>
              Todos
            </button>
            {categoriaActiva !== 'todos' && (
              <button
                key={categoriaActiva}
                type="button"
                onClick={() => setAbierto(true)}
                aria-label={`Categoría elegida: ${categoriaActiva}. Abrir lista de categorías`}
                className={`${claseChip(true)} animate-entrada-dropdown`}
              >
                {categoriaActiva}
              </button>
            )}
          </div>
        </div>
        <label className="lw-buscador flex h-[38px] w-full items-center gap-2 rounded-full bg-[#18181b] px-3.5 text-white/50 sm:w-[230px]">
          <Search className="h-[15px] w-[15px] shrink-0" />
          <input
            type="text"
            value={busqueda}
            onChange={(evento) => onBusqueda(evento.target.value)}
            placeholder={placeholder}
            aria-label={placeholder.replace('…', '')}
            className="w-full min-w-0 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
          />
          {busqueda && (
            <button type="button" onClick={() => onBusqueda('')} aria-label="Limpiar" className="shrink-0 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <span className="hidden shrink-0 text-[11px] uppercase tracking-wider text-white/50 sm:inline">
          {etiquetaTotal}
        </span>
      </div>

      {/* Lista desplegable: la fila crece de 0fr a 1fr (animación suave de
          alto, sin medir píxeles) y `inert` la saca del foco mientras está
          plegada. */}
      <div
        id="lista-categorias"
        inert={!abierto}
        className={`mx-auto grid w-full max-w-[1700px] transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${
          abierto ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3">
            <div className="flex max-h-[40svh] flex-wrap gap-2 overflow-y-auto pb-1">
              {reales.map((categoria) => (
                <button
                  key={categoria}
                  type="button"
                  onClick={() => elegir(categoria)}
                  className={claseChip(categoriaActiva === categoria)}
                >
                  {categoria} <span className="opacity-60">· {conteos[categoria] ?? 0}</span>
                </button>
              ))}
                          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
