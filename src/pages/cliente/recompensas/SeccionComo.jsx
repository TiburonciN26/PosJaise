import { Link } from 'react-router-dom'
import { Encabezado, Pildora } from './ui.jsx'

const PASOS = [
  ['Compras y reservas', 'Usa tu cuenta al reservar y comprar para que todo quede vinculado a ti.'],
  ['Sumas puntos y sellos', 'Los puntos salen de lo que pagas. Los sellos, de tus visitas reservadas en la web.'],
  ['Canjeas por un cupón', 'Eliges una recompensa y gastas tus puntos disponibles. Obtienes un cupón con su código.'],
  ['Usas el cupón', 'En una compra posterior lo muestras en caja y se aplica el beneficio.'],
]

const CONDICIONES = [
  'La compra está vinculada a tu cuenta.',
  'Cuenta el importe elegible pagado, después de descuentos.',
  'Servicios: completados y cobrados.',
  'Productos: con venta confirmada.',
  'No dan puntos: envío, recargos, partidas gratuitas ni compras anuladas.',
  'Una misma operación nunca da puntos dos veces.',
  'No hay puntos extra por visita: las visitas elegibles ya generan sellos.',
]

// Cómo funciona — texto explicativo del programa. Las tasas son
// PROPUESTA (5 pts por S/20 en servicios, 5 por S/40 en productos): hoy
// el sistema usa sus propios multiplicadores (panel "Puntos Web" del
// POS), por eso van marcadas como "Tasas propuestas".
export default function SeccionComo() {
  return (
    <section className="flex flex-col gap-6">
      <Encabezado titulo="Cómo funciona Club Jaise" texto="En cuatro pasos." />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
        {PASOS.map(([titulo, texto], i) => (
          <div key={titulo} className="liquid-glass flex flex-col gap-2 rounded-none p-5">
            <span className="text-[28px] font-bold text-[var(--lw-gold)]">{i + 1}</span>
            <strong className="text-white">{titulo}</strong>
            <span className="text-[13px] leading-relaxed text-white/60">{texto}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className="liquid-glass flex flex-col gap-3.5 rounded-none p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Cómo se ganan los puntos</span>
            <Pildora>Tasas propuestas</Pildora>
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-1.5 border-b border-white/10 pb-2.5">
              <span className="font-semibold text-white">Servicios</span>
              <span>
                <strong className="text-xl text-white">5 puntos</strong>{' '}
                <span className="text-white/60">por cada S/20 pagados</span>
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-1.5">
              <span className="font-semibold text-white">Productos</span>
              <span>
                <strong className="text-xl text-white">5 puntos</strong>{' '}
                <span className="text-white/60">por cada S/40 pagados</span>
              </span>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-white/60">
            Las compras pequeñas también acumulan avance: no se pierden las fracciones entre compras. Te mostramos
            tus puntos enteros y cuánto llevas del siguiente.
          </p>
        </div>

        <div className="liquid-glass flex flex-col gap-3 rounded-none p-6">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Condiciones para sumar</span>
          <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-snug text-white/80">
            {CONDICIONES.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="liquid-glass flex flex-col gap-2.5 rounded-none p-6">
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Si anulan una compra</span>
        <p className="text-sm leading-relaxed text-white/80">
          Se revierten los puntos que esa compra te dio y lo verás en «Movimientos». Si usaste un cupón en esa
          compra, se rehabilita según sus condiciones. Si el ajuste deja tu saldo en negativo, lo verás claro y los
          canjes se bloquean hasta compensarlo con nuevas compras. No es una deuda de dinero.
        </p>
      </div>

      <div>
        <Link
          to="/recompensas?seccion=canje"
          className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          Ver recompensas
        </Link>
      </div>
    </section>
  )
}
