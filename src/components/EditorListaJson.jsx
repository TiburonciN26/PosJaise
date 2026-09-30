import { Plus, X } from 'lucide-react'
import Etiqueta from './Etiqueta.jsx'

// Editor genérico de listas jsonb (pasos, especificaciones, herramientas,
// materiales, cuidados) — una fila por ítem, un campo por dato definido
// en `campos`, "+ Agregar" al final. El orden en pantalla ES el orden
// que se guarda (el índice del array); no hace falta un campo "orden"
// aparte. Usado por ModalServicio.jsx para las columnas jsonb del
// rediseño de Servicios/Detalle (docs/diseno-servicios/README.md,
// "Backend que falta", migración 113).
export default function EditorListaJson({ etiqueta, items, campos, vacio, onCambiar, textoAgregar = '+ Agregar' }) {
  function actualizarCampo(indice, clave, valor) {
    onCambiar(items.map((item, i) => (i === indice ? { ...item, [clave]: valor } : item)))
  }

  function quitar(indice) {
    onCambiar(items.filter((_, i) => i !== indice))
  }

  function agregar() {
    onCambiar([...items, { ...vacio }])
  }

  return (
    <div>
      <Etiqueta>{etiqueta}</Etiqueta>
      <div className="space-y-2">
        {items.map((item, indice) => (
          <div key={indice} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2">
            <div className="flex-1 space-y-1.5">
              {campos.map((campo) =>
                campo.tipo === 'textarea' ? (
                  <textarea
                    key={campo.clave}
                    rows={2}
                    value={item[campo.clave] ?? ''}
                    onChange={(evento) => actualizarCampo(indice, campo.clave, evento.target.value)}
                    placeholder={campo.placeholder}
                    className="w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink/60 focus:border-amber"
                  />
                ) : (
                  <input
                    key={campo.clave}
                    type="search"
                    inputMode={campo.tipo === 'numero' ? 'numeric' : 'text'}
                    autoComplete="new-password"
                    value={item[campo.clave] ?? ''}
                    onChange={(evento) => actualizarCampo(indice, campo.clave, evento.target.value)}
                    placeholder={campo.placeholder}
                    className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink/60 focus:border-amber"
                  />
                ),
              )}
            </div>
            <button
              type="button"
              onClick={() => quitar(indice)}
              aria-label="Quitar"
              className="shrink-0 p-1.5 text-ink/60 transition-colors hover:text-red"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={agregar}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber"
        >
          <Plus className="h-3.5 w-3.5" />
          {textoAgregar}
        </button>
      </div>
    </div>
  )
}
