import { useEffect, useRef } from 'react'
import { NIVELES_PUNTOS } from '../lib/nivelesPuntos.js'

// Superficie metálica de un nivel (Básico plata / Premium azul hielo /
// VIP dorado) — la misma paleta (--tp-*) y las mismas capas (.tp-iri,
// .tp-glare, .tp-sheen) que la tarjeta de puntos (TarjetaPuntos.jsx), sin
// su física 3D: acá el brillo y el destello se desplazan solos con el
// mismo ritmo que el idle de la tarjeta (`despl` es la misma fórmula).
// Lo usan las tres tarjetas "Beneficios por nivel" de Recompensas.
//
// Con `prefers-reduced-motion` no hay movimiento, solo el color.
export default function FondoNivel({ nivel, destacada = false, className = '', style, children }) {
  const ref = useRef(null)
  const config = NIVELES_PUNTOS[nivel] ?? NIVELES_PUNTOS.BASICO

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const glares = el.querySelectorAll('.tp-glare')
    const sheens = el.querySelectorAll('.tp-sheen')
    const pintarGlare = (k) => {
      const fondo = `radial-gradient(circle at ${50 + k * 40}% 40%, rgba(255,248,220,.7), rgba(255,248,220,0) 45%)`
      glares.forEach((g) => {
        g.style.background = fondo
      })
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pintarGlare(0.4)
      return undefined
    }

    const t0 = performance.now()
    let raf
    function loop(now) {
      const t = (now - t0) / 1000
      pintarGlare(Math.sin(t * 0.6) * 0.8)
      const despl = ((t * 0.28) % 1.6) - 0.3
      sheens.forEach((s) => {
        s.style.left = `${despl * 160 - 60}%`
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={ref}
      className={`tn-fondo tp-tinta ${destacada ? 'tn-destacada' : ''} ${className}`}
      style={{ ...config.vars, ...style }}
    >
      <div className="tp-iri" aria-hidden="true" />
      <div className="tp-glare" aria-hidden="true" />
      <div className="tp-sheen" aria-hidden="true" />
      <div className="tn-contenido h-full">{children}</div>
    </div>
  )
}
