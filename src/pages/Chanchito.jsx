import { useCallback, useEffect, useState } from 'react'
import { PiggyBank, Plus, Minus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatearFechaISO, formatearFechaSoloDia } from '../lib/fechas.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import ModalChanchito from '../components/ModalChanchito.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

// Ahorro del negocio (solo admin). El saldo es la suma de los movimientos
// (depósitos − retiros); la tabla es de solo-insertar, ver la migración
// 20261013000002_chanchito_movimientos.sql.
export default function Chanchito() {
  const { mostrarToast } = useToast()
  const [movimientos, setMovimientos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [modal, setModal] = useState(null) // 'DEPOSITO' | 'RETIRO' | null

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('chanchito_movimientos')
      .select('id, tipo, monto, nota, creado_en')
      .order('creado_en', { ascending: false })
    if (error) {
      setErrorCarga(true)
    } else {
      setErrorCarga(false)
      setMovimientos(data)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const saldo = sumarMontos(movimientos, (m) => (m.tipo === 'DEPOSITO' ? Number(m.monto) : -Number(m.monto)))

  function alGuardar(mensaje) {
    setModal(null)
    mostrarToast(mensaje, 'exito')
    cargar()
  }

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-(--separador-horizontal) lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <TarjetaResumen
        etiqueta="Ahorrado en el chanchito"
        valor={cargando ? '—' : formatearSoles(saldo)}
        claseValor="text-purple-300"
        padding="p-4"
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setModal('DEPOSITO')}
          disabled={cargando || errorCarga}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Agregar dinero
        </button>
        <button
          type="button"
          onClick={() => setModal('RETIRO')}
          disabled={cargando || errorCarga || saldo <= 0}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
          Sacar dinero
        </button>
      </div>

      <h2 className="mt-5 text-sm font-semibold text-ink">Movimientos</h2>

      {errorCarga ? (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          No se pudieron cargar los movimientos.{' '}
          <button type="button" onClick={cargar} className="underline">
            Reintentar
          </button>
        </p>
      ) : !cargando && movimientos.length === 0 ? (
        <EstadoVacio icono={PiggyBank} mensaje="Todavía no hay movimientos en el chanchito." tema="purple-300" />
      ) : (
        <ul className="mt-2 space-y-2">
          {movimientos.map((m) => {
            const esDeposito = m.tipo === 'DEPOSITO'
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{m.nota || (esDeposito ? 'Depósito' : 'Retiro')}</p>
                  <p className="text-xs text-ink/60">
                    {formatearFechaSoloDia(formatearFechaISO(new Date(m.creado_en)))}
                  </p>
                </div>
                <p className={`shrink-0 font-mono text-sm font-semibold ${esDeposito ? 'text-purple-300' : 'text-red'}`}>
                  {esDeposito ? '+' : '−'} {formatearSoles(Number(m.monto))}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {modal && (
        <ModalChanchito tipo={modal} saldo={saldo} onCerrar={() => setModal(null)} onGuardado={alGuardar} />
      )}
    </div>
  )
}
