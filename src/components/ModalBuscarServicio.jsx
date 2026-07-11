import { useState } from 'react'
import { X } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { formatearSoles } from '../lib/moneda.js'
import IconoBuscar from './IconoBuscar.jsx'

export default function ModalBuscarServicio({ servicios, onSeleccionar, onCerrar }) {
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('')
  const [indiceActivo, setIndiceActivo] = useState(-1)

  useCerrarConEscape(onCerrar)

  const categorias = [...new Set(servicios.map((s) => s.categoria).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )

  const filtrados = servicios.filter((servicio) => {
    const coincideCategoria = !categoriaActiva || servicio.categoria === categoriaActiva
    const coincideNombre = servicio.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
    return coincideCategoria && coincideNombre
  })

  function elegirCategoria(categoria) {
    setCategoriaActiva(categoria)
    setIndiceActivo(-1)
  }

  function manejarCambioBusqueda(valor) {
    setBusqueda(valor)
    setIndiceActivo(-1)
  }

  function manejarKeyDown(evento) {
    if (evento.key === 'Escape') {
      if (busqueda) {
        evento.preventDefault()
        evento.stopPropagation()
        manejarCambioBusqueda('')
      }
      return
    }

    if (evento.key === 'ArrowDown') {
      if (filtrados.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice + 1) % filtrados.length)
      return
    }

    if (evento.key === 'ArrowUp') {
      if (filtrados.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice - 1 + filtrados.length) % filtrados.length)
      return
    }

    if (evento.key !== 'Enter') return
    evento.preventDefault()

    if (indiceActivo >= 0 && filtrados[indiceActivo]) {
      onSeleccionar(filtrados[indiceActivo])
      return
    }
    if (filtrados.length === 1) {
      onSeleccionar(filtrados[0])
    }
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h2 className="text-base font-semibold text-ink">Agregar servicio</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-ink/60 transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/60">
              <IconoBuscar />
            </span>
            <input
              type="text"
              autoFocus
              value={busqueda}
              onChange={(evento) => manejarCambioBusqueda(evento.target.value)}
              onKeyDown={manejarKeyDown}
              placeholder="Buscar servicio..."
              className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 focus:border-amber"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => manejarCambioBusqueda('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {categorias.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => elegirCategoria('')}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  categoriaActiva === ''
                    ? 'bg-amber font-semibold text-bg'
                    : 'border border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                }`}
              >
                Todas
              </button>
              {categorias.map((categoria) => (
                <button
                  key={categoria}
                  type="button"
                  onClick={() => elegirCategoria(categoria)}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    categoriaActiva === categoria
                      ? 'bg-amber font-semibold text-bg'
                      : 'border border-border-strong text-ink/70 hover:border-amber hover:text-amber'
                  }`}
                >
                  {categoria}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="p-6 text-center font-mono text-sm text-ink/30">
              No se encontraron servicios.
            </p>
          ) : (
            filtrados.map((servicio, indice) => (
              <button
                key={servicio.id}
                type="button"
                onMouseEnter={() => setIndiceActivo(indice)}
                onClick={() => onSeleccionar(servicio)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                  indice === indiceActivo ? 'bg-amber/15 text-amber' : 'text-ink hover:bg-surface-2'
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{servicio.nombre}</p>
                  {servicio.categoria && (
                    <p className="truncate text-xs text-ink/60">{servicio.categoria}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-sm text-amber">
                  {formatearSoles(servicio.precio)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
