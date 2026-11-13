import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, leerImporte, redondear2 } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'

// Tres usos con los mismos campos (monto, fecha, nota):
//   · modo 'pago'      → la administradora registra un pago (registrar_pago_deuda).
//   · modo 'nota'      → Cajera/Encargada anotan un cobro recibido; la deuda NO cambia hasta que la admin lo confirme
//                        (crear_nota_cobro_deuda, migración 20261112000001).
//   · modo 'confirmar' → la administradora revisa una nota de cobro: monto y fecha vienen de la nota y puede ajustar el
//                        monto (cobro total o parcial) antes de registrarlo (confirmar_nota_cobro_deuda).
const TEXTOS = {
  pago: { titulo: 'Registrar pago', boton: 'Registrar pago', error: 'No se pudo registrar el pago. Intenta de nuevo.' },
  nota: { titulo: 'Nota de cobro', boton: 'Enviar nota', error: 'No se pudo guardar la nota de cobro. Intenta de nuevo.' },
  confirmar: { titulo: 'Confirmar cobro', boton: 'Confirmar cobro', error: 'No se pudo confirmar el cobro. Intenta de nuevo.' },
}

export default function ModalPagoDeuda({
  deuda,
  saldo,
  modo = 'pago',
  notaCobro = null,
  notasPendientes = [],
  onConfirmarNota,
  onCerrar,
  onGuardado,
}) {
  const textos = TEXTOS[modo]
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  // Al confirmar se propone lo que anotó la cajera, sin pasar del saldo actual (pudo cobrarse algo entretanto).
  const [monto, setMonto] = useState(() => String(notaCobro ? Math.min(Number(notaCobro.monto), saldo) : saldo))
  const [fecha, setFecha] = useState(() => notaCobro?.fecha ?? formatearFechaISO(new Date()))
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
    const { error: errorGuardado } =
      modo === 'nota'
        ? await supabase.rpc('crear_nota_cobro_deuda', {
            p_deuda_id: deuda.id,
            p_monto: montoNumero,
            p_fecha: fecha,
            p_nota: nota.trim() || null,
          })
        : modo === 'confirmar'
          ? await supabase.rpc('confirmar_nota_cobro_deuda', {
              p_nota_id: notaCobro.id,
              p_monto: montoNumero,
              p_fecha: fecha,
            })
          : await supabase.rpc('registrar_pago_deuda', {
              p_deuda_id: deuda.id,
              p_monto: montoNumero,
              p_fecha: fecha,
              p_nota: nota.trim() || null,
            })
    setGuardando(false)

    if (errorGuardado) {
      // P0001 = validación del servidor con un mensaje pensado para mostrarse (saldo superado, ya revisada…).
      setError(errorGuardado.code === 'P0001' ? errorGuardado.message : textos.error)
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
        <h2 className="text-base font-semibold text-ink">{textos.titulo}</h2>
        <p className="mt-1 text-sm text-ink/60">
          {deuda.clientes.nombre} · debe{' '}
          <span className="font-mono font-semibold text-purple-300">{formatearSoles(saldo)}</span>
        </p>
        {modo === 'pago' && notasPendientes.length > 0 && (
          // Cobro directo de la admin con notas pendientes: si este cobro es el que anotó la cajera, conviene
          // confirmarlo desde la nota para que el pago quede a nombre de quien cobró. Si la deuda termina cobrada por
          // aquí, las notas pendientes se cierran solas como «sin efecto» (trigger deudas_descartar_notas_cobro).
          <div className="mt-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-xs text-ink/80">
            <p className="font-medium">
              {notasPendientes.length === 1 ? 'Hay una nota de cobro pendiente' : 'Hay notas de cobro pendientes'}
            </p>
            <p className="mt-0.5 text-ink/70">
              Si este cobro es el que anotaron, confírmalo desde la nota para que quede a nombre de quien cobró.
            </p>
            <ul className="mt-1.5 space-y-1">
              {notasPendientes.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {n.creado_por_nombre ?? 'Personal'} ·{' '}
                    <span className="font-mono font-semibold">{formatearSoles(n.monto)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onConfirmarNota?.(n)}
                    className="shrink-0 rounded-lg border border-green/50 px-2 py-1 font-medium text-green transition-colors hover:bg-green/10"
                  >
                    Confirmar nota
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {modo === 'nota' && (
          <p className="mt-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink/70">
            La deuda no cambia todavía: la administradora revisará esta nota y, al confirmarla, se descontará del saldo.
          </p>
        )}
        {modo === 'confirmar' && (
          <div className="mt-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-xs text-ink/80">
            <p>
              <span className="font-semibold">{notaCobro.creado_por_nombre ?? 'Personal'}</span> anotó{' '}
              <span className="font-mono font-semibold">{formatearSoles(notaCobro.monto)}</span>
            </p>
            {notaCobro.nota && <p className="mt-0.5 text-ink/70">«{notaCobro.nota}»</p>}
            <p className="mt-0.5 text-ink/70">Ajusta el monto si recibiste menos (cobro parcial).</p>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-monto`}>{modo === 'nota' ? 'Monto recibido' : 'Monto pagado'}</Etiqueta>
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
            {modo === 'nota' && restante > 0 ? (
              <>
                Si se confirma, quedará debiendo{' '}
                <span className="font-mono font-semibold text-amber">{formatearSoles(restante)}</span>
              </>
            ) : modo === 'nota' ? (
              'Si se confirma, la deuda queda cobrada.'
            ) : restante > 0 ? (
              <>
                Quedará debiendo{' '}
                <span className="font-mono font-semibold text-amber">{formatearSoles(restante)}</span>
              </>
            ) : (
              'Con este pago la deuda queda cobrada.'
            )}
          </p>

          {modo !== 'confirmar' && (
          <div>
            <Etiqueta htmlFor={`${idBase}-nota`}>Notas</Etiqueta>
            <textarea
              id={`${idBase}-nota`}
              autoComplete="off"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder={modo === 'nota' ? 'Ej.: pagó por Yape' : 'Opcional'}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>
          )}
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
            {guardando ? 'Guardando...' : textos.boton}
          </button>
        </div>
      </form>
    </div>
  )
}
