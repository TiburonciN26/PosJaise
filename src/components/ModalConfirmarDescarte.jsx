import { useRef } from 'react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'

// Aviso al salir de un formulario con cambios sin guardar (X, «Cancelar» o Esc). Convención para todos los modales con
// formulario: si el usuario escribió, cambió o borró algo, NO se cierra de golpe — se pregunta y se dice qué se perdería.
// `cambios`: lista de textos ya redactados («Nombre: Shampoo → Shampoo Pro»). Esc aquí equivale a «Seguir editando».
// `variante="web"`: estilo del portal de clientas (panel `lw-bar`, texto blanco, acento dorado) en vez del del POS.
const ESTILOS = {
  pos: {
    capa: 'fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-40 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4',
    panel: 'flex max-h-full w-full max-w-sm flex-col rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)',
    titulo: 'text-base font-semibold text-ink',
    texto: 'mt-1 text-sm text-ink/60',
    lista: 'mt-3 min-h-0 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-ink/80',
    seguir: 'flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber',
  },
  web: {
    capa: 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4',
    panel: 'lw-bar flex max-h-[90dvh] w-full max-w-sm flex-col rounded-lg border border-white/10 p-5',
    titulo: 'text-base font-semibold text-white',
    texto: 'mt-1 text-sm text-white/60',
    lista: 'mt-3 min-h-0 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80',
    seguir: 'flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)]',
  },
}

export default function ModalConfirmarDescarte({ cambios = [], onSeguir, onDescartar, variante = 'pos' }) {
  const estilo = ESTILOS[variante] ?? ESTILOS.pos
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onSeguir)

  return (
    <div className={estilo.capa}>
      <div ref={panelRef} className={estilo.panel}>
        <h2 className={estilo.titulo}>¿Descartar los cambios?</h2>
        <p className={estilo.texto}>
          Si sales ahora, se perderá lo que no has guardado
          {cambios.length > 0 ? ':' : '.'}
        </p>

        {cambios.length > 0 && (
          <ul className={estilo.lista}>
            {cambios.map((cambio) => (
              <li key={cambio} className="break-words">
                • {cambio}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onSeguir}
            autoFocus
            className={estilo.seguir}
          >
            Seguir editando
          </button>
          <button
            type="button"
            onClick={onDescartar}
            className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  )
}
