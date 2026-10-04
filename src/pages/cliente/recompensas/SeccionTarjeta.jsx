import { Check, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import TarjetaPuntos from '../../../components/TarjetaPuntos.jsx'
import FondoNivel from '../../../components/FondoNivel.jsx'
import { BENEFICIOS_NIVEL } from './datos.js'
import { Pildora } from './ui.jsx'

// Mi tarjeta — la tarjeta 3D de puntos tal cual (TarjetaPuntos.jsx, con
// todas sus animaciones), con la etiqueta "PUNTOS DISPONIBLES". Datos
// reales de mis_puntos(). OJO: hoy el backend NO separa puntos
// disponibles de puntos de clasificación (es un solo saldo), así que la
// barra y "faltan N pts" siguen ese saldo; la separación llega con la
// Fase 2 (ver docs/diseno-recompensas).
export default function SeccionTarjeta({ datos, nombre }) {
  const puntos = datos?.puntos ?? 0
  const nivel = datos?.nivel ?? 'BASICO'
  const umbralPremium = datos?.umbral_premium ?? 10
  const umbralVip = datos?.umbral_vip ?? 30
  const faltan = datos?.puntos_para_siguiente ?? 0
  const umbrales = { BASICO: 0, PREMIUM: umbralPremium, VIP: umbralVip }

  let piso = 0
  let techo = umbralPremium
  let siguienteEtiqueta = `FALTAN ${faltan} PTS · PREMIUM`
  if (nivel === 'PREMIUM') {
    piso = umbralPremium
    techo = umbralVip
    siguienteEtiqueta = `FALTAN ${faltan} PTS · VIP`
  } else if (nivel === 'VIP') {
    piso = umbralVip
    techo = umbralVip
    siguienteEtiqueta = 'NIVEL MÁXIMO'
  }
  const progresoPct = techo > piso ? Math.min(100, Math.max(0, ((puntos - piso) / (techo - piso)) * 100)) : 100
  const barraPct = Math.min(100, Math.round((puntos / umbralVip) * 100))
  const tickPremium = Math.min(100, Math.round((umbralPremium / umbralVip) * 100))
  const siguiente = nivel === 'BASICO' ? 'Premium' : nivel === 'PREMIUM' ? 'VIP' : null

  return (
    <section className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
        <TarjetaPuntos
          nivel={nivel}
          puntos={puntos}
          progresoPct={progresoPct}
          siguienteEtiqueta={siguienteEtiqueta}
          nombre={nombre}
          etiqueta="PUNTOS DISPONIBLES"
        />

        <div className="liquid-glass flex items-start gap-3 rounded-none p-4">
          <Info className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
          <p className="text-xs leading-relaxed text-white/60">
            {siguiente
              ? `Te faltan ${faltan} ${faltan === 1 ? 'punto' : 'puntos'} de clasificación para subir a ${siguiente}. `
              : 'Ya alcanzaste el nivel más alto. ¡Gracias por tu preferencia! '}
            <strong className="text-white">Usar tus puntos no hace bajar tu nivel.</strong>
          </p>
        </div>
      </div>

      <div className="liquid-glass mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-none p-6">
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Progreso de clasificación</span>
        <p className="text-lg font-semibold leading-snug text-white">
          {siguiente ? `${puntos} de ${umbralVip} puntos hacia VIP` : `${puntos} puntos · nivel máximo alcanzado`}
        </p>
        <div className="relative pb-9">
          <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--lw-gold)] transition-[width] duration-700"
              style={{ width: `${barraPct}%` }}
            />
          </div>
          <span className="absolute left-0 top-[18px] text-xs text-white/50">0 · Básico</span>
          <span
            className="absolute top-[18px] -translate-x-1/2 whitespace-nowrap text-xs text-white/50"
            style={{ left: `${tickPremium}%` }}
          >
            {umbralPremium} · Premium
          </span>
          <span className="absolute right-0 top-[18px] whitespace-nowrap text-xs text-white/50">
            {umbralVip} · VIP
          </span>
        </div>
        <p className="text-xs leading-relaxed text-white/50">
          Por ahora tu clasificación usa tu saldo de puntos. Cuando se separen los puntos disponibles de los de
          clasificación, canjear no los moverá.
        </p>
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <h3 className="text-lg font-semibold text-white">Beneficios por nivel</h3>
          <Pildora>Propuesta; premios y precios en revisión económica</Pildora>
        </div>

        <div className="grid items-stretch justify-center gap-5 pb-3 pt-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),340px))]">
          {BENEFICIOS_NIVEL.map((n) => {
            const actual = n.clave === nivel
            return (
              <FondoNivel key={n.clave} nivel={n.clave} destacada={actual} className={actual ? '-translate-y-4' : ''}>
                <article className="flex h-full flex-col gap-4 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-lg font-bold">{n.nombre}</span>
                    {actual && (
                      <span className="rounded-full bg-[var(--tp-ink)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white/90 [text-shadow:none]">
                        TU NIVEL
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[34px] font-bold leading-tight">{umbrales[n.clave]} pts</span>
                    <span className="text-xs opacity-75">
                      {n.clave === 'BASICO' ? 'Desde que te registras' : 'puntos de clasificación'}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed opacity-80">{n.descripcion}</p>
                  {actual ? (
                    <span className="flex min-h-11 items-center justify-center rounded-full bg-[var(--tp-ink)]/55 text-sm font-bold text-white/90 [text-shadow:none]">
                      Tu nivel actual
                    </span>
                  ) : (
                    <Link
                      to="/recompensas?seccion=canje"
                      className="flex min-h-11 items-center justify-center rounded-full bg-[var(--tp-ink)] text-sm font-bold text-white/90 [text-shadow:none] transition-opacity hover:opacity-85"
                    >
                      Ver recompensas
                    </Link>
                  )}
                  <span className="text-[13px] font-bold">Qué incluye:</span>
                  <ul className="flex flex-col gap-2.5">
                    {n.beneficios.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13px] leading-snug">
                        <span
                          aria-hidden="true"
                          className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--tp-ink)] text-white/90"
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </article>
              </FondoNivel>
            )
          })}
        </div>
        <p className="text-center text-xs leading-relaxed text-white/50">
          No hay descuentos permanentes ni regalos automáticos por nivel: los beneficios son acceso a recompensas
          que se canjean con puntos.
        </p>
      </div>
    </section>
  )
}
