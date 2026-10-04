import { useMemo, useState } from 'react'
import { AvisoError, Cargando, Encabezado, Filtro, AvisoProximamente } from './ui.jsx'
import { fechaHoraLima, formatearMonedas } from './lib.js'

const TIPOS = ['Todos', 'Ganados', 'Gastados', 'Ajustes']
const PERIODOS = ['30 días', '90 días', '12 meses', 'Todo']

// Movimientos — el backend todavía no guarda un libro de movimientos de
// puntos (ganados / gastados / ajustados con saldo posterior), así que no
// hay nada real que listar y NO se inventan filas. Se deja el diseño de
// filtros y la explicación de las anulaciones; la lista llega con la
// Fase 2 (docs/diseno-recompensas).
function MovimientosPendiente() {
  const [tipo, setTipo] = useState('Todos')
  const [periodo, setPeriodo] = useState('Todo')

  return (
    <section className="flex flex-col gap-5">
      <Encabezado
        titulo="Movimientos"
        texto="Cada punto que ganas, gastas o se ajusta, con su motivo y tu saldo después."
      />

      <AvisoProximamente>
        Todavía no registramos el detalle de cada movimiento de puntos. Cuando esté listo lo verás aquí, con su
        fecha, motivo y tu saldo después de cada uno.
      </AvisoProximamente>

      <div className="flex flex-wrap gap-x-6 gap-y-3 opacity-60">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/50">Tipo</span>
          {TIPOS.map((t) => (
            <Filtro key={t} activo={tipo === t} onClick={() => setTipo(t)}>
              {t}
            </Filtro>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/50">Período</span>
          {PERIODOS.map((p) => (
            <Filtro key={p} activo={periodo === p} onClick={() => setPeriodo(p)}>
              {p}
            </Filtro>
          ))}
        </div>
      </div>

      <div className="liquid-glass rounded-none p-8 text-center text-sm leading-relaxed text-white/50">
        Aún no hay movimientos para mostrar.
      </div>

      <div className="liquid-glass rounded-none px-5 py-4 text-[13px] leading-relaxed text-white/60">
        <strong className="text-white">Si anulan una venta:</strong> se revierten los puntos que dio. Si esa venta
        usó un cupón, el cupón se rehabilita según sus condiciones; no se te devuelven además los puntos del canje
        mientras el cupón siga disponible, porque duplicaría el beneficio.
      </div>
    </section>
  )
}

const TIPOS_REAL = [
  { clave: 'todos', label: 'Todos' },
  { clave: 'ganados', label: 'Ganados' },
  { clave: 'gastados', label: 'Gastados' },
  { clave: 'reversiones', label: 'Reversiones' },
]
const PERIODOS_REAL = [
  { clave: '30', label: '30 días', dias: 30 },
  { clave: '90', label: '90 días', dias: 90 },
  { clave: '365', label: '12 meses', dias: 365 },
  { clave: 'todo', label: 'Todo', dias: null },
]

// Movimientos reales de monedas (programa activo): acreditaciones por venta, canjes,
// reversiones por anulación y saldo después de cada uno, con fechas en hora de Perú.
function MovimientosReales({ movimientos, onReintentar }) {
  const [tipo, setTipo] = useState('todos')
  const [periodo, setPeriodo] = useState('todo')

  const visibles = useMemo(() => {
    if (movimientos.estado !== 'ok') return []
    const dias = PERIODOS_REAL.find((p) => p.clave === periodo)?.dias
    const desde = dias ? Date.now() - dias * 86400000 : null
    return movimientos.datos.filter((m) => {
      if (desde && new Date(m.fecha).getTime() < desde) return false
      if (tipo === 'ganados') return m.tipo === 'VENTA' || m.tipo === 'APERTURA'
      if (tipo === 'gastados') return m.tipo === 'CANJE'
      if (tipo === 'reversiones') return m.tipo === 'VENTA_REVERSION'
      return true
    })
  }, [movimientos, tipo, periodo])

  return (
    <section className="flex flex-col gap-5">
      <Encabezado
        titulo="Movimientos"
        texto="Cada moneda que ganas, gastas o se revierte, con su motivo y tu saldo después. Fechas en hora de Perú."
      />

      {movimientos.estado === 'cargando' && <Cargando />}
      {movimientos.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar tus movimientos"
          texto="Tu saldo no cambió; solo no pudimos leer el detalle ahora."
          onReintentar={onReintentar}
        />
      )}

      {movimientos.estado === 'ok' && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/50">Tipo</span>
              {TIPOS_REAL.map((t) => (
                <Filtro key={t.clave} activo={tipo === t.clave} onClick={() => setTipo(t.clave)}>
                  {t.label}
                </Filtro>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/50">Período</span>
              {PERIODOS_REAL.map((p) => (
                <Filtro key={p.clave} activo={periodo === p.clave} onClick={() => setPeriodo(p.clave)}>
                  {p.label}
                </Filtro>
              ))}
            </div>
          </div>

          {visibles.length === 0 ? (
            <div className="liquid-glass rounded-none p-8 text-center text-sm leading-relaxed text-white/50">
              {movimientos.datos.length === 0 ? 'Aún no tienes movimientos.' : 'No hay movimientos con estos filtros.'}
            </div>
          ) : (
            <ul className="liquid-glass divide-y divide-white/10 rounded-none">
              {visibles.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3.5 text-[13px]">
                  <span className="min-w-0 flex-1 text-white/80">
                    {m.descripcion}
                    <span className="block text-xs text-white/40">{fechaHoraLima(m.fecha)}</span>
                  </span>
                  <span className="text-right">
                    <strong className={Number(m.monedas) < 0 ? 'text-white' : 'text-[var(--lw-gold)]'}>
                      {Number(m.monedas) > 0 ? '+' : ''}
                      {formatearMonedas(m.monedas)}
                    </strong>
                    <span className="block text-xs text-white/40">saldo {formatearMonedas(m.saldo)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="liquid-glass rounded-none px-5 py-4 text-[13px] leading-relaxed text-white/60">
        <strong className="text-white">Si anulan una venta:</strong> se revierten las monedas que dio, una sola vez. Si
        ya las habías gastado, tu saldo puede quedar negativo y se compensa con tus próximas compras (no es una deuda de
        dinero). Si esa venta usó un cupón, vuelve a estar disponible si sigue vigente; no se devuelven además las
        monedas del canje original.
      </div>
    </section>
  )
}

export default function SeccionMovimientos({ real = false, movimientos, onReintentar }) {
  return real ? <MovimientosReales movimientos={movimientos} onReintentar={onReintentar} /> : <MovimientosPendiente />
}
