import { useState } from 'react'
import { ArrowBigDown, Gift, Sparkles, Stamp, Ticket } from 'lucide-react'
import CampoColapsable from '../../../components/CampoColapsable.jsx'
import { formatearFechaSoloDia } from '../../../lib/fechas.js'
import { AvisoError, Pildora } from './ui.jsx'

const VISITAS_POR_RECOMPENSA = 5

// Mis sellos — mismo diseño que tenía Fidelización (FidelizacionCliente),
// con el sello (Stamp, el mismo de la pestaña Citas) en vez de la
// estrella. Datos reales: mi_fidelizacion() + mi_historial_fidelizacion().
// "Generar cupón" no gasta puntos y crea un cupón de % de verdad
// (generar_cupon_fidelizacion()); el botón solo aparece mientras haya una
// tarjeta completa sin reclamar. La fecha bajo cada sello sale del
// historial de visitas (1 visita = 1 sello, mismo criterio del servidor).
export default function SeccionSellos({ datos, historial: recursoHistorial, generando, onGenerarCupon, onReintentarHistorial }) {
  const [historialAbierto, setHistorialAbierto] = useState(false)

  // QA-039: si el historial no llegó (error o aún cargando) no se inventa
  // uno vacío: se avisa y se omiten solo las fechas y la lista de visitas.
  const historialOk = recursoHistorial.estado === 'ok'
  const historial = historialOk ? recursoHistorial.datos : []

  const sellos = datos?.sellos_actuales ?? 0
  const visitasTotales = datos?.visitas_totales ?? 0
  const recompensas = datos?.recompensas_disponibles ?? 0
  // Justo al completar un múltiplo de 5, el módulo da 0 — sin este caso
  // especial se leería como "recién empezaste" en vez de "¡la llenaste!".
  const tarjetaLlena = visitasTotales > 0 && sellos === 0
  const sellosEnTarjeta = tarjetaLlena ? VISITAS_POR_RECOMPENSA : sellos
  const faltan = VISITAS_POR_RECOMPENSA - sellosEnTarjeta

  // `historial` viene del más nuevo al más viejo; la tarjeta actual
  // muestra las últimas `sellosEnTarjeta` visitas, de la más vieja a la
  // más nueva.
  const cronologico = [...historial].reverse()
  const fechasTarjeta = sellosEnTarjeta > 0 ? cronologico.slice(-sellosEnTarjeta) : []

  // Tarjetas ya completadas: una por cada 5 visitas. Las reclamadas son
  // las completas menos las que siguen disponibles.
  const completadas = Math.floor(visitasTotales / VISITAS_POR_RECOMPENSA)
  const reclamadas = Math.max(0, completadas - recompensas)
  const tarjetas = Array.from({ length: completadas }, (_, i) => ({
    numero: i + 1,
    cierre: cronologico[(i + 1) * VISITAS_POR_RECOMPENSA - 1]?.fecha ?? null,
    reclamada: i + 1 <= reclamadas,
  })).reverse()

  return (
    <section className="flex flex-col gap-6">
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className="flex w-full max-w-sm flex-col gap-3 justify-self-center lg:justify-self-end">
          <div className="liquid-glass rounded-none p-5 text-center">
            <p className="text-sm text-white/60">
              Cada {VISITAS_POR_RECOMPENSA} visitas completadas ganas{' '}
              <span className="font-semibold text-[var(--lw-gold)]">20% de descuento</span> en tu próximo servicio.
            </p>
            <p className="mt-2">
              <Pildora envolver>Recompensa de la nueva tarjeta: propuesta (20 %, máx. S/5)</Pildora>
            </p>

            <div className="mt-4 flex justify-center gap-2">
              {Array.from({ length: VISITAS_POR_RECOMPENSA }, (_, i) => {
                const lleno = i < sellosEnTarjeta
                const fecha = fechasTarjeta[i]?.fecha
                return (
                  <div key={i} className="flex w-14 flex-col items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        lleno
                          ? 'bg-[var(--lw-gold)] text-black'
                          : 'border-2 border-dashed border-white/20 text-white/20'
                      }`}
                    >
                      <Stamp className="h-5 w-5" />
                    </span>
                    <span className="text-center text-[11px] leading-tight text-white/50">
                      {fecha ? formatearFechaSoloDia(fecha) : ''}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className="mt-3 text-sm font-medium text-white">
              {tarjetaLlena ? '¡Tarjeta completa!' : `${sellos} de ${VISITAS_POR_RECOMPENSA} visitas`}
            </p>
            <p className="mt-1 text-xs text-white/60">
              {visitasTotales === 0
                ? 'Todavía no tienes visitas registradas.'
                : `${visitasTotales} ${visitasTotales === 1 ? 'visita completada' : 'visitas completadas'} en total.`}
            </p>
            {visitasTotales > 0 && !tarjetaLlena && (
              <p className="mt-2 text-xs text-white/50">
                Te {faltan === 1 ? 'falta' : 'faltan'} {faltan} {faltan === 1 ? 'visita' : 'visitas'} para tu
                recompensa.
              </p>
            )}
          </div>

          {recompensas > 0 && (
            <div className="liquid-glass flex items-start gap-3 rounded-none p-3.5">
              <Gift className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--lw-gold)]">
                  Tienes {recompensas} {recompensas === 1 ? 'recompensa disponible' : 'recompensas disponibles'}
                </p>
                <p className="mt-0.5 text-xs text-white/60">
                  Se reclama sin gastar puntos. Genera tu cupón y muéstralo en tu próxima visita para que te apliquen
                  el descuento.
                </p>
                <button
                  type="button"
                  onClick={onGenerarCupon}
                  disabled={generando}
                  className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--lw-gold)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--lw-gold)] disabled:opacity-40"
                >
                  <Ticket className="h-3.5 w-3.5" />
                  {generando ? 'Generando...' : 'Generar cupón'}
                </button>
              </div>
            </div>
          )}

          {recursoHistorial.estado === 'error' && (
            <AvisoError
              titulo="No pudimos cargar el historial de visitas"
              texto="Tus sellos y visitas no cambiaron; solo no pudimos leer el detalle de fechas ahora."
              onReintentar={onReintentarHistorial}
            />
          )}

          {historial.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setHistorialAbierto((anterior) => !anterior)}
                aria-expanded={historialAbierto}
                className="flex w-full items-center justify-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
              >
                Ver historial de visitas
                <ArrowBigDown
                  className={`h-3 w-3 transition-transform duration-300 ${historialAbierto ? 'rotate-180' : ''}`}
                />
              </button>
              <CampoColapsable abierto={historialAbierto} margen>
                <div className="liquid-glass space-y-1.5 rounded-none p-3">
                  {historial.map((visita, indice) => (
                    <div key={visita.fecha} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white/70">Visita {historial.length - indice}</span>
                      <span className="text-white/40">{formatearFechaSoloDia(visita.fecha)}</span>
                    </div>
                  ))}
                </div>
              </CampoColapsable>
            </div>
          )}

          {visitasTotales === 0 && (
            <div className="flex items-center gap-2 text-xs text-white/50">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Agenda tu primera cita para empezar a sumar sellos.
            </div>
          )}
        </div>

        <div className="liquid-glass flex flex-col gap-3 self-start rounded-none p-5">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Cómo se ganan los sellos</span>
          <ul className="flex list-disc flex-col gap-2 pl-[18px] text-sm leading-relaxed text-white/80">
            <li>Una cita que reservaste en la web genera un sello cuando se completa.</li>
            <li>Máximo un sello por día (fecha de Perú), aunque tengas varios servicios en la misma visita.</li>
            <li>Las reservas canceladas o no atendidas no dan sello.</li>
            <li>Una compra de productos no da sello.</li>
            <li>Con cinco sellos reclamas una recompensa; no gastas puntos.</li>
          </ul>
          <p className="border-t border-white/10 pt-3 text-[13px] leading-relaxed text-white/50">
            Los cupones de tarjetas anteriores conservan las condiciones con las que se emitieron: no se les aplican
            retroactivamente nuevos topes.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-white">Tarjetas completadas</h3>
        {tarjetas.length === 0 ? (
          <div className="liquid-glass rounded-none p-5 text-sm text-white/50">Aún no has completado ninguna tarjeta.</div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
            {tarjetas.map((t) => (
              <div key={t.numero} className="liquid-glass flex flex-col gap-1 rounded-none p-4">
                <span className="font-semibold text-white">
                  Tarjeta {t.numero}
                  {t.cierre ? ` · completada el ${formatearFechaSoloDia(t.cierre)}` : ''}
                </span>
                <span className="text-[13px] text-white/60">Recompensa: 20% de descuento en un servicio</span>
                <span className="text-[13px] text-white/60">
                  {t.reclamada ? 'Recompensa reclamada' : 'Recompensa por reclamar'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
