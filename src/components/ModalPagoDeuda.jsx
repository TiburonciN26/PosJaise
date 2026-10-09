import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, leerImporte, redondear2 } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'

export default function ModalPagoDeuda({ deuda, saldo, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const [monto, setMonto] = useState(String(saldo))
  const [fecha, setFecha] = useState(() => formatearFechaISO(new Date()))
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const montoNumero = leerImporte(monto)
  const restante = Number.isNaN(montoNumero) ? saldo : redondear2(saldo - montoNumero)

  async function guardar(evento) {
    evento.preventDefault()
    if (Number.isNaN(montoNumero) || montoNumero <= 0) {
      setError('El monto debe ser mayor a 0.')
      return
    }
    if (montoNumero > saldo) {
      setError(`El pago no puede superar el saldo (${formatearSoles(saldo)}).`)
      return
    }
    if (!fecha) {
      setError('Selecciona la fecha del pago.')
      return
    }

    setGuardando(true)
    setError(null)
    const { error: errorGuardado } = await supabase.rpc('registrar_pago_deuda', {
      p_deuda_id: deuda.id,
      p_monto: montoNumero,
      p_fecha: fecha,
      p_nota: nota.trim() || null,
    })
    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo registrar el pago. Intenta de nuevo.')
      return
    }
    onGuardado(restante <= 0)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">Registrar pago</h2>
        <p className="mt-1 text-sm text-ink/60">
          {deuda.clientes.nombre} · debe{' '}
          <span className="font-mono font-semibold text-purple-300">{formatearSoles(saldo)}</span>
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-monto`}>Monto pagado</Etiqueta>
              <input
                id={`${idBase}-monto`}
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={monto}
                onChange={(evento) => setMonto(evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha de pago</Etiqueta>
              <input
                id={`${idBase}-fecha`}
                type="date"
                value={fecha}
                onChange={(evento) => setFecha(evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>
          </div>

          <p className="text-xs text-ink/60">
            {restante > 0 ? (
              <>
                Quedará debiendo{' '}
                <span className="font-mono font-semibold text-amber">{formatearSoles(restante)}</span>
              </>
            ) : (
              'Con este pago la deuda queda cobrada.'
            )}
          </p>

          <div>
            <Etiqueta htmlFor={`${idBase}-nota`}>Notas</Etiqueta>
            <textarea
              id={`${idBase}-nota`}
              autoComplete="off"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder="Opcional"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
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
            {guardando ? 'Guardando...' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </div>
  )
}
