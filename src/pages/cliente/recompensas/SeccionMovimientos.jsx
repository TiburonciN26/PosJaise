import { useState } from 'react'
import { Encabezado, Filtro, AvisoProximamente } from './ui.jsx'

const TIPOS = ['Todos', 'Ganados', 'Gastados', 'Ajustes']
const PERIODOS = ['30 días', '90 días', '12 meses', 'Todo']

// Movimientos — el backend todavía no guarda un libro de movimientos de
// puntos (ganados / gastados / ajustados con saldo posterior), así que no
// hay nada real que listar y NO se inventan filas. Se deja el diseño de
// filtros y la explicación de las anulaciones; la lista llega con la
// Fase 2 (docs/diseno-recompensas).
export default function SeccionMovimientos() {
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
