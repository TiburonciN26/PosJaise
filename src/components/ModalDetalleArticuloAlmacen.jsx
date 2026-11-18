import { useRef } from 'react'
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import BotonAccion from './BotonAccion.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import HistorialArticuloAlmacen from './HistorialArticuloAlmacen.jsx'

// Detalle de un artículo del Almacén en el CELULAR (en PC el historial se despliega dentro de la tabla). Para la
// administradora incluye el historial (HistorialArticuloAlmacen). Mismo esquema que ModalDetalleProducto: el cuerpo
// scrollea y las acciones quedan fijas abajo.

export default function ModalDetalleArticuloAlmacen({ articulo, esAdmin, onCerrar, onSacar, onIngresar, onEditar, onEliminar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

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
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{articulo.nombre}</h2>
            <BotonCerrarModal onClick={onCerrar} />
          </div>
          <p className="font-mono text-xs text-ink/60">
            {articulo.unidad}
            {!articulo.activo && ' · Inactivo'}
          </p>
          <p className="mt-2 font-mono text-sm text-ink/70">
            Stock <span className="text-ink">{articulo.stock_actual}</span>
          </p>

          {esAdmin && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Movimientos</h3>

              <div className="mt-2">
                <HistorialArticuloAlmacen articuloId={articulo.id} stockActual={articulo.stock_actual} />
              </div>
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
