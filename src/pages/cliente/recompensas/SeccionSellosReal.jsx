import { useMemo, useState } from 'react'
import { Gift, Stamp } from 'lucide-react'
import { AvisoError, Cargando, Encabezado } from './ui.jsx'
import { REGLA_SELLOS, fechaHoraLima, premioAItem, textoPagoMinimo } from './lib.js'
import ConfirmarCanje from './ConfirmarCanje.jsx'

// Mis sellos (Fase 2, programa activo). Los sellos salen del libro del servidor:
// un sello por clienta y día de Perú cuando una compra confirmada incluye servicios
// (con o sin cita web); los productos solos no dan sello. Cada premio cuesta 5; se
// acumulan hasta 20 (los saldos heredados mayores a 20 se conservan íntegros y se
// bajan canjeando de a 5). Una anulación o la apertura (reclamadas > visitas) pueden dejar sellos negativos: nunca se
// trunca a cero ni se borra un premio ya reclamado.
export default function SeccionSellosReal({
  saldo,
  catalogo,
  movimientos,
  userId,
  onReintentarCatalogo,
  onReintentarMovimientos,
  onCanjeExitoso,
}) {
  const [confirmando, setConfirmando] = useState(null)
  const cfg = { max: saldo.sellos_max, costo: saldo.sellos_por_premio }
  const sellos = saldo.sellos
  const enTarjeta = ((sellos % cfg.costo) + cfg.costo) % cfg.costo
  const premiosDisponibles = Math.max(0, Math.floor(sellos / cfg.costo))
  const lleno = sellos >= cfg.max
  const negativo = sellos < 0

  const premios = useMemo(
    () => (catalogo.estado === 'ok' ? catalogo.datos.map((p) => premioAItem(p)) : []),
    [catalogo],
  )

  return (
    <section className="flex flex-col gap-6">
      <Encabezado
        titulo="Mis sellos"
        texto={`Un sello por cada día que compras servicios. Con ${cfg.costo} sellos reclamas un premio.`}
      />

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className="flex w-full max-w-sm flex-col gap-3 justify-self-center lg:justify-self-end">
          <div className="liquid-glass rounded-none p-5 text-center">
            <div className="flex justify-center gap-2">
              {Array.from({ length: cfg.costo }, (_, i) => {
                // Con la tarjeta recién llenada (múltiplo exacto) se muestran los 5 llenos.
                const completa = sellos > 0 && enTarjeta === 0
                const lleno5 = completa || i < enTarjeta
                return (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${
                      lleno5 ? 'bg-[var(--lw-gold)] text-black' : 'border-2 border-dashed border-white/20 text-white/20'
                    }`}
                  >
                    <Stamp className="h-5 w-5" />
                  </span>
                )
              })}
            </div>
            <p className="mt-3 text-lg font-semibold text-white">
              {sellos} {Math.abs(sellos) === 1 ? 'sello' : 'sellos'}
            </p>
            <p className="mt-1 text-xs text-white/60">
              {premiosDisponibles > 0
                ? `Tienes ${premiosDisponibles} ${premiosDisponibles === 1 ? 'premio disponible' : 'premios disponibles'} para reclamar.`
                : negativo
                  ? 'Tu saldo de sellos es negativo.'
                  : `Te ${cfg.costo - sellos === 1 ? 'falta' : 'faltan'} ${cfg.costo - sellos} ${cfg.costo - sellos === 1 ? 'sello' : 'sellos'} para tu primer premio.`}
            </p>
          </div>

          {lleno && (
            <p
              role="status"
              className="border border-green/50 bg-green/10 px-4 py-3 text-center text-sm font-semibold text-green"
            >
              Tienes {sellos} sellos. Canjea una recompensa para seguir acumulando.
            </p>
          )}

          {negativo && (
            <p role="status" className="border border-white/20 px-4 py-3 text-[13px] leading-relaxed text-white/80">
              Tienes {Math.abs(sellos)} {Math.abs(sellos) === 1 ? 'sello' : 'sellos'} por recuperar. Cada día con una
              venta de servicios válida recuperas un sello, hasta volver a 0. Después puedes seguir acumulando. Los
              premios que ya reclamaste se conservan.
            </p>
          )}
        </div>

        <div className="liquid-glass flex flex-col gap-3 self-start rounded-none p-5">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Cómo se ganan los sellos</span>
          <ul className="flex list-disc flex-col gap-2 pl-[18px] text-sm leading-relaxed text-white/80">
            <li>Un sello por día de Perú cuando una compra confirmada incluye servicios, venga o no de una cita web.</li>
            <li>Varias compras o varios servicios el mismo día dan un solo sello.</li>
            <li>Los productos solos no dan sello.</li>
            <li>Acumulas hasta {cfg.max} sellos. Con {cfg.max} no se suman más hasta que reclames un premio; no se acreditan visitas anteriores omitidas.</li>
            <li>Cada premio cuesta {cfg.costo} sellos. Si anulan una compra, el sello de ese día se retira solo si no queda otra compra con servicios ese día.</li>
          </ul>
          <p className="border-t border-white/10 pt-3 text-[13px] leading-relaxed text-white/50">{REGLA_SELLOS}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-white">Premios por sellos</h3>
        {catalogo.estado === 'cargando' && <Cargando />}
        {catalogo.estado === 'error' && (
          <AvisoError
            titulo="No pudimos cargar los premios"
            texto="Tus sellos no cambiaron; solo no pudimos leer los premios ahora."
            onReintentar={onReintentarCatalogo}
          />
        )}
        {catalogo.estado === 'ok' && premios.length === 0 && (
          <div className="liquid-glass rounded-none p-5 text-sm text-white/50">
            Todavía no hay premios de sellos publicados. Tus sellos se conservan.
          </div>
        )}
        {premios.length > 0 && (
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
            {premios.map((r) => (
              <li key={r.id} className="liquid-glass flex flex-col gap-2 rounded-none p-4">
                <span className="flex items-center gap-2 font-semibold text-white">
                  <Gift className="h-4 w-4 shrink-0 text-[var(--lw-gold)]" aria-hidden="true" />
                  {r.nombre}
                </span>
                <span className="text-[13px] text-white/70">{r.beneficio}</span>
                <span className="text-xs text-white/50">
                  {r.aplica} · {r.minimo} · {r.vigencia}
                </span>
                {textoPagoMinimo(r.premio) && <span className="text-xs text-white/70">{textoPagoMinimo(r.premio)}</span>}
                {!r.canjeable && r.motivo && <span className="text-xs text-white/60">{r.motivo}</span>}
                <button
                  type="button"
                  disabled={!r.canjeable}
                  onClick={() => setConfirmando(r.premio)}
                  className="mt-1 flex w-fit items-center gap-1.5 rounded-lg border border-[var(--lw-gold)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--lw-gold)] disabled:opacity-40"
                >
                  Reclamar por {cfg.costo} sellos
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-white">Historial de sellos</h3>
        {movimientos.estado === 'cargando' && <Cargando />}
        {movimientos.estado === 'error' && (
          <AvisoError
            titulo="No pudimos cargar tu historial de sellos"
            texto="Tus sellos no cambiaron; solo no pudimos leer el detalle ahora."
            onReintentar={onReintentarMovimientos}
          />
        )}
        {movimientos.estado === 'ok' && movimientos.datos.length === 0 && (
          <div className="liquid-glass rounded-none p-5 text-sm text-white/50">Aún no tienes movimientos de sellos.</div>
        )}
        {movimientos.estado === 'ok' && movimientos.datos.length > 0 && (
          <ul className="liquid-glass divide-y divide-white/10 rounded-none">
            {movimientos.datos.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-[13px]">
                <span className="min-w-0 flex-1 text-white/80">
                  {m.descripcion}
                  <span className="block text-xs text-white/40">{fechaHoraLima(m.fecha)}</span>
                </span>
                <span className="text-right">
                  <strong className={m.delta < 0 ? 'text-white' : 'text-[var(--lw-gold)]'}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </strong>
                  <span className="block text-xs text-white/40">saldo {m.saldo}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmando && (
        <ConfirmarCanje
          premio={confirmando}
          origen="SELLOS"
          saldo={saldo}
          userId={userId}
          onCerrar={() => setConfirmando(null)}
          onExito={onCanjeExitoso}
        />
      )}
    </section>
  )
}
