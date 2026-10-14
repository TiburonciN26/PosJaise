import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles, leerImporte } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'

// tipo: 'DEPOSITO' (agregar al chanchito) | 'RETIRO' (sacar). Los movimientos
// no se editan ni se borran (la tabla solo permite INSERT): un error se corrige
// con un movimiento contrario.
export default function ModalChanchito({ tipo, saldo, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const esRetiro = tipo === 'RETIRO'
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function guardar(evento) {
    evento.preventDefault()

    const valor = leerImporte(monto)
    if (Number.isNaN(valor) || valor <= 0) {
      setError('El monto debe ser un número mayor a 0 (hasta 2 decimales).')
      return
    }
    if (esRetiro && valor > saldo) {
      setError(`No puedes sacar más de lo que hay ahorrado (${formatearSoles(saldo)}).`)
      return
    }

    setGuardando(true)
    setError(null)

    const { error: errorGuardado } = await supabase
      .from('chanchito_movimientos')
      .insert({ tipo, monto: valor, nota: nota.trim() || null })

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar el movimiento. Intenta de nuevo.')
      return
    }

    onGuardado(esRetiro ? 'Retiro registrado.' : 'Depósito registrado.')
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">
          {esRetiro ? 'Sacar del chanchito' : 'Agregar al chanchito'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-monto`}>Monto</Etiqueta>
            <input
              id={`${idBase}-monto`}
              type="search"
              inputMode="decimal"
              autoComplete="new-password"
              value={monto}
              onChange={(evento) => setMonto(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
            {esRetiro && (
              <p className="mt-1 text-xs text-ink/60">Disponible: {formatearSoles(saldo)}</p>
            )}
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-nota`}>Nota</Etiqueta>
            <input
              id={`${idBase}-nota`}
              type="search"
              autoComplete="new-password"
              value={nota}
              maxLength={120}
              onChange={(evento) => setNota(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
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
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
