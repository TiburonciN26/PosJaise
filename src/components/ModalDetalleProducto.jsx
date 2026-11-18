import { useRef, useState } from 'react'
import { ImageOff, Pencil, Plus, Trash2, ZoomIn } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { formatearSoles } from '../lib/moneda.js'
import BotonAccion from './BotonAccion.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import ModalVisorFoto from './ModalVisorFoto.jsx'
import HistorialStockProducto from './HistorialStockProducto.jsx'
import ProveedoresDelProducto from './ProveedoresDelProducto.jsx'

const BUCKET_FOTOS = 'fotos-productos'

// Solo escritorio: la tabla conserva su columna de Acciones y este modal se abre como vista de solo lectura (foto;
// el historial de stock es admin-only, igual que Editar/Eliminar) al hacer clic en la fila. En móvil las tarjetas de
// Inventario ya no abren este modal: su detalle vive en el propio registro desplegable.
export default function ModalDetalleProducto({
  producto,
  esAdmin,
  mostrarAcciones,
  onCerrar,
  onEditar,
  onEliminar,
  onAgregarStock,
}) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [fotoExpandida, setFotoExpandida] = useState(false)

  useCerrarConEscape(onCerrar)

  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)

  return (
    <div onClick={onCerrar} className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      {/* flex-col + footer shrink-0: con muchos movimientos de stock, el
          contenido del medio scrollea pero las acciones y "Cerrar" quedan
          siempre visibles abajo, en vez de que la lista los empuje fuera
          de la pantalla. */}
      <div
        ref={panelRef}
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-border bg-surface"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          {urlFoto ? (
            <button
              type="button"
              onClick={() => setFotoExpandida(true)}
              className="relative block h-48 w-full rounded-lg"
            >
              <div className="foto-borde-luz h-full w-full rounded-lg">
                <div className="h-full w-full overflow-hidden rounded-[6px] bg-surface-2">
                  <img
                    src={urlFoto}
                    alt={producto.nombre}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white">
                <ZoomIn className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
              <ImageOff className="h-10 w-10 text-ink/40" />
            </div>
          )}

          <div className="mt-4 flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{producto.nombre}</h2>
            <BotonCerrarModal onClick={onCerrar} />
          </div>
          <p className="font-mono text-xs text-ink/60">
            {producto.codigo_barras || 'Sin código'}
            {producto.categoria ? ` · ${producto.categoria}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-ink/70">
            <span>
              Venta <span className="text-amber">{formatearSoles(producto.precio)}</span>
            </span>
            <span>
              Stock <span className="text-ink">{producto.stock_actual}</span>
            </span>
          </div>

          <ProveedoresDelProducto producto={producto} esAdmin={esAdmin} />
          <HistorialStockProducto productoId={producto.id} esAdmin={esAdmin} proveedorHabitualId={producto.proveedor_id} />
        </div>

        {/* Sin bg/border propio: los botones quedan "flotando" sobre el
            mismo fondo del modal, no en una barra separada. */}
        <div className="flex shrink-0 items-center justify-between gap-1 px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-11 rounded-lg border border-border-strong px-3 text-xs text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Cerrar
          </button>

          {mostrarAcciones && (
            <>
              <BotonAccion icono={Plus} texto="Agregar stock" color="morado" onClick={onAgregarStock} />
              {esAdmin && (
                <>
                  <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={onEditar} />
                  <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={onEliminar} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {fotoExpandida && urlFoto && (
        <ModalVisorFoto
          url={urlFoto}
          alt={producto.nombre}
          onCerrar={() => setFotoExpandida(false)}
        />
      )}
    </div>
  )
}
