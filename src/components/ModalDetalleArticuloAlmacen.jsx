import { useEffect, useRef, useState } from 'react'
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import BotonAccion from './BotonAccion.jsx'

// Detalle de un artículo del Almacén. Para la administradora incluye el historial (quién sacó / ingresó qué, cuándo y,
// en los ingresos, a qué costo) vía historial_almacen_articulo(), que solo le responde a ella. Mismo esquema que
// ModalDetalleProducto: el cuerpo scrollea y las acciones quedan fijas abajo.

function formatearFechaHoraCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'numeric', timeZone: 'America/Lima' }).format(
    fecha,
  )
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
}

export default function ModalDetalleArticuloAlmacen({ articulo, esAdmin, onCerrar, onSacar, onIngresar, onEditar, onEliminar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(esAdmin)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  // stock_actual en las dependencias: tras un ingreso/salida hecho desde este modal, el historial se recarga solo.
  useEffect(() => {
    if (!esAdmin) return undefined
    let vigente = true
    setCargando(true)
    setError(null)
    supabase.rpc('historial_almacen_articulo', { p_articulo_id: articulo.id }).then(({ data, error: errorRpc }) => {
      if (!vigente) return
      if (errorRpc) setError('No se pudo cargar el historial del artículo.')
      else setHistorial(data ?? [])
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [articulo.id, articulo.stock_actual, esAdmin])

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4"
    >
      <div
        ref={panelRef}
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-border bg-surface"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <h2 className="text-base font-semibold text-ink">{articulo.nombre}</h2>
          <p className="font-mono text-xs text-ink/60">
            {articulo.categoria || 'Sin categoría'} · {articulo.unidad}
            {!articulo.activo && ' · Inactivo'}
          </p>
          <p className="mt-2 font-mono text-sm text-ink/70">
            Stock <span className="text-ink">{articulo.stock_actual}</span>
          </p>

          {esAdmin && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Movimientos</h3>

              {cargando ? (
                <p className="mt-2 text-center font-mono text-xs text-ink/60">Cargando...</p>
              ) : error ? (
                <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
              ) : historial.length === 0 ? (
                <p className="mt-2 text-center font-mono text-xs text-ink/60">Sin movimientos todavía.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {historial.map((mov, indice) => {
                    const esIngreso = mov.tipo === 'INGRESO'
                    return (
                      <li key={`${mov.fecha}-${indice}`} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                        <div className="flex items-center justify-between gap-2 font-mono text-sm">
                          {/* Solo cuánto entró o salió (pedido de la dueña); el stock que quedó se ve arriba. */}
                          <span className={esIngreso ? 'text-green' : 'text-red'}>
                            {esIngreso ? 'Ingresó' : 'Salió'} {mov.cantidad}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink/50">{formatearFechaHoraCorta(mov.fecha)}</span>
                        </div>
                        <p className="truncate text-[11px] text-ink/50">
                          {[
                            mov.usuario_nombre || 'Usuario eliminado',
                            esIngreso && mov.costo_total != null ? formatearSoles(mov.costo_total) : null,
                            mov.nota,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-1 px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-11 rounded-lg border border-border-strong px-3 text-xs text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
          >
            Cerrar
          </button>
          {articulo.activo && <BotonAccion icono={Minus} texto="Sacar" color="morado" onClick={onSacar} />}
          {esAdmin && (
            <>
              <BotonAccion icono={Plus} texto="Ingreso" color="verde" onClick={onIngresar} />
              <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={onEditar} />
              <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={onEliminar} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
