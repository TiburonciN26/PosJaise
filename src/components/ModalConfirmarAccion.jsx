import { useRef } from 'react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'

// Confirmación breve de una acción que quita algo (p. ej. quitar un proveedor de un producto). Esc o «Cancelar» = no hacer nada.
// Va a z-40 para quedar sobre el modal de formulario (z-30) desde el que se abre. Hermano del <form>, nunca dentro de él.
export default function ModalConfirmarAccion({ titulo, texto, textoConfirmar = 'Quitar', onCancelar, onConfirmar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCancelar)

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">{titulo}</h2>
        {texto && <p className="mt-1 text-sm text-ink/60">{texto}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancelar}
            autoFocus
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
