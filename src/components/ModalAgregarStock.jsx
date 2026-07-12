import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

export default function ModalAgregarStock({ producto, onCerrar, onGuardado }) {
  const [cantidad, setCantidad] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  async function guardar(evento) {
    evento.preventDefault()

    const cantidadNumerica = parseInt(cantidad, 10)
    if (Number.isNaN(cantidadNumerica) || cantidadNumerica <= 0) {
      setError('La cantidad debe ser un número mayor a 0.')
      return
    }

    setGuardando(true)
    setError(null)

    const { error: errorRpc } = await supabase.rpc('agregar_stock', {
      p_producto_id: producto.id,
      p_cantidad: cantidadNumerica,
      p_nota: nota,
    })

    setGuardando(false)

    if (errorRpc) {
      setError('No se pudo agregar el stock. Intenta de nuevo.')
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">Agregar stock</h2>
        <p className="mt-1 text-sm text-ink">{producto.nombre}</p>
        <p className="font-mono text-xs text-ink/60">Stock actual: {producto.stock_actual}</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-ink/60">
              Cantidad a agregar<span className="text-red"> *</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={cantidad}
              onChange={(evento) => setCantidad(evento.target.value)}
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink/60">Nota</label>
            <input
              type="text"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder="Ej: Compra proveedor X"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </form>
    </div>
  )
}
