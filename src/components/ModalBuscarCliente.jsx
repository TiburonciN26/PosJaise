import { useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import IconoBuscar from './IconoBuscar.jsx'

export default function ModalBuscarCliente({ clientes, onSeleccionar, onCerrar }) {
  const [busqueda, setBusqueda] = useState('')
  const [indiceActivo, setIndiceActivo] = useState(-1)

  useCerrarConEscape(onCerrar)

  const filtrados = clientes.filter((cliente) => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return true
    return (
      cliente.nombre.toLowerCase().includes(texto) ||
      (cliente.telefono ?? '').toLowerCase().includes(texto)
    )
  })

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
      return
    }
    if (filtrados.length === 0 && busqueda.trim()) {
      onSeleccionar({ id: null, nombre: busqueda.trim() })
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
          <h2 className="text-base font-semibold text-ink">Seleccionar cliente</h2>
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
              placeholder="Buscar por nombre o teléfono..."
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
        </div>

        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {busqueda.trim() && (
            <button
              type="button"
              onClick={() => onSeleccionar({ id: null, nombre: busqueda.trim() })}
              className="flex w-full items-center gap-2 bg-amber/5 px-3 py-2.5 text-left text-amber transition-colors hover:bg-amber/10"
            >
              <UserPlus className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm">
                Usar "{busqueda.trim()}" (venta rápida, sin guardar)
              </span>
            </button>
          )}

          {filtrados.length === 0 ? (
            <p className="p-6 text-center font-mono text-sm text-ink/30">
              {busqueda.trim()
                ? 'No hay clientes registrados con ese nombre.'
                : 'No se encontraron clientes.'}
            </p>
          ) : (
            filtrados.map((cliente, indice) => (
              <button
                key={cliente.id}
                type="button"
                onMouseEnter={() => setIndiceActivo(indice)}
                onClick={() => onSeleccionar(cliente)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                  indice === indiceActivo ? 'bg-amber/15 text-amber' : 'text-ink hover:bg-surface-2'
                }`}
              >
                <span className="truncate text-sm">{cliente.nombre}</span>
                {cliente.telefono && (
                  <span className="shrink-0 font-mono text-xs text-ink/60">
                    {cliente.telefono}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
