import { useRef, useState } from 'react'
import { X, ClipboardCheck } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import IconoBuscar from './IconoBuscar.jsx'
import EstadoVacio from './EstadoVacio.jsx'

// Corta a propósito (día/mes + hora, sin año) — alcanza para notar de un
// vistazo que una atención quedó de un día anterior (se olvidaron de
// cobrarla) en vez de ser de la visita de hoy, sin la carga visual de una
// fecha completa en una lista que ya agrupa por cliente.
function formatearFechaCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Lima',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} · ${horaStr}`
}

// Reemplaza al viejo ModalBuscarServicio: ya no se elige de un catálogo
// libre, sino de las atenciones que una asistente ya registró en su Panel
// (o que quedaron listas al completar una cita) y todavía no se cobraron.
// No se muestra de qué asistente es cada una — a la cajera solo le hace
// falta identificar cuál pidió el cliente, no quién la atendió.
export default function ModalBuscarAtencion({ atenciones, cargando, onSeleccionar, onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [busqueda, setBusqueda] = useState('')
  const [indiceActivo, setIndiceActivo] = useState(-1)

  useCerrarConEscape(onCerrar)

  const filtradas = atenciones.filter((atencion) => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return true
    return (
      (atencion.servicios?.nombre ?? '').toLowerCase().includes(texto) ||
      (atencion.clientes?.nombre ?? '').toLowerCase().includes(texto)
    )
  })

  // Agrupadas por cliente para que la cajera vea de un vistazo todo lo
  // pendiente de la misma persona, en vez de buscarla entre atenciones de
  // otros clientes intercaladas. El índice plano (sobre `filtradas`) se
  // conserva para que la navegación con flechas/Enter siga funcionando
  // igual, solo que ahora dibujado agrupado.
  const indicePorId = new Map(filtradas.map((atencion, indice) => [atencion.id, indice]))
  const gruposFiltrados = (() => {
    const mapa = new Map()
    for (const atencion of filtradas) {
      const clave = atencion.cliente_id ?? atencion.clientes?.nombre ?? 'sin-cliente'
      if (!mapa.has(clave)) {
        mapa.set(clave, { clienteNombre: atencion.clientes?.nombre ?? 'Cliente', atenciones: [] })
      }
      mapa.get(clave).atenciones.push(atencion)
    }
    return Array.from(mapa.values()).sort((a, b) => a.clienteNombre.localeCompare(b.clienteNombre))
  })()

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
      if (filtradas.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice + 1) % filtradas.length)
      return
    }

    if (evento.key === 'ArrowUp') {
      if (filtradas.length === 0) return
      evento.preventDefault()
      setIndiceActivo((indice) => (indice - 1 + filtradas.length) % filtradas.length)
      return
    }

    if (evento.key !== 'Enter') return
    evento.preventDefault()

    if (indiceActivo >= 0 && filtradas[indiceActivo]) {
      onSeleccionar(filtradas[indiceActivo])
      return
    }
    if (filtradas.length === 1) {
      onSeleccionar(filtradas[0])
    }
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={panelRef}
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h2 className="text-base font-semibold text-ink">Atención a cobrar</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-3.5 rounded-lg p-3.5 text-ink/60 transition-colors hover:bg-surface-2 hover:text-ink"
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
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              autoFocus
              value={busqueda}
              onChange={(evento) => manejarCambioBusqueda(evento.target.value)}
              onKeyDown={manejarKeyDown}
              placeholder="Buscar por servicio o cliente..."
              className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/60 focus:border-amber"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => manejarCambioBusqueda('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2.5 text-ink/60 transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cargando ? (
            <p className="p-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : filtradas.length === 0 ? (
            <EstadoVacio
              icono={ClipboardCheck}
              mensaje={
                busqueda.trim()
                  ? 'No hay atenciones pendientes con ese nombre.'
                  : 'No hay atenciones pendientes por cobrar. Pide a la asistente que la registre en su Panel primero.'
              }
            />
          ) : (
            gruposFiltrados.map((grupo) => (
              <div
                key={grupo.clienteNombre}
                className="border-b border-border py-1.5 last:border-b-0"
              >
                <p className="truncate px-3 pb-1 pt-1 text-sm font-semibold text-ink">
                  {grupo.clienteNombre}
                </p>
                <div className="pl-3">
                  {grupo.atenciones.map((atencion) => {
                    const indice = indicePorId.get(atencion.id)
                    return (
                      <button
                        key={atencion.id}
                        type="button"
                        onMouseEnter={() => setIndiceActivo(indice)}
                        onClick={() => onSeleccionar(atencion)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                          indice === indiceActivo
                            ? 'bg-amber/15 text-amber'
                            : 'text-ink/80 hover:bg-surface-2'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate">{atencion.servicios?.nombre ?? 'Servicio'}</p>
                          <p className="truncate font-mono text-[10px] text-ink/40">
                            {formatearFechaCorta(atencion.fecha)}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-amber">
                          {formatearSoles(atencion.precio)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
