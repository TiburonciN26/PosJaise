import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { mensajeErrorProveedor } from '../lib/proveedores.js'

// Confirmación + eliminar_proveedor(): con ingresos de stock registrados se desactiva (no se pierde el historial); si no,
// se borra junto con sus vínculos. Avisa el resultado con un toast. z-40: va encima del detalle del proveedor.
export default function ModalEliminarProveedor({ proveedor, onCerrar, onEliminado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)
  const { mostrarToast } = useToast()
  const [eliminando, setEliminando] = useState(false)

  async function eliminar() {
    setEliminando(true)
    const { data, error } = await supabase.rpc('eliminar_proveedor', { p_id: proveedor.id })
    setEliminando(false)
    if (error) {
      mostrarToast(mensajeErrorProveedor(error, 'No se pudo eliminar el proveedor.'), 'error')
      onCerrar()
      return
    }
    mostrarToast(
      data === 'ELIMINADO'
        ? 'Proveedor eliminado.'
        : 'Ese proveedor ya trajo stock: se desactivó para no perder el historial.',
      data === 'ELIMINADO' ? 'exito' : 'info',
    )
    onEliminado(data)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">¿Eliminar a «{proveedor.nombre}»?</h2>
        <p className="mt-1 text-sm text-ink/60">
          Si ya trajo stock, en vez de eliminarse se desactivará para no romper el historial. Si se elimina, también se
          quita de los productos a los que está vinculado.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={eliminando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={eliminar}
            disabled={eliminando}
            className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
          >
            {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}
