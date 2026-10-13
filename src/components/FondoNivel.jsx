import { useEffect, useRef } from 'react'
import { NIVELES_PUNTOS } from '../lib/nivelesPuntos.js'
import { crearBucle } from '../lib/bucleAnimacion.js'

// Superficie metálica de un nivel (Básico plata / Premium dorado /
// VIP diamante azul hielo) — la misma paleta (--tp-*) y las mismas capas (.tp-iri,
// .tp-glare, .tp-sheen) que la tarjeta de puntos (TarjetaPuntos.jsx), sin
// su física 3D: acá el brillo y el destello se desplazan solos con el
// mismo ritmo que el idle de la tarjeta (`despl` es la misma fórmula).
// Lo usan las tres tarjetas "Beneficios por nivel" de Recompensas.
//
// Fase 6: el movimiento corre SOLO mientras la tarjeta está en pantalla y la pestaña del navegador visible (crearBucle: sin rAF
// pendiente en cuanto sale del viewport), con referencias de capas buscadas una vez y desplazamiento por transform (sin layout ni
// repintado de gradientes). Con `prefers-reduced-motion` no hay movimiento, solo el color (brillo fijo); si la preferencia cambia
// en el sistema, la tarjeta reacciona.
export default function FondoNivel({ nivel, destacada = false, className = '', style, children }) {
  const ref = useRef(null)
  const config = NIVELES_PUNTOS[nivel] ?? NIVELES_PUNTOS.BASICO

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const glares = [...el.querySelectorAll('.tp-glare')]
    const sheens = [...el.querySelectorAll('.tp-sheen')]
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    let ancho = el.clientWidth || 1
    let alto = el.clientHeight || 1
    const observador = new ResizeObserver(() => {
      ancho = el.clientWidth || 1
      alto = el.clientHeight || 1
    })
    observador.observe(el)

    const pintarGlare = (k) => {
      const gx = `${(k * 0.4 * ancho).toFixed(1)}px`
      const gy = `${(-0.1 * alto).toFixed(1)}px`
      for (const g of glares) {
        g.style.setProperty('--gx', gx)
        g.style.setProperty('--gy', gy)
      }
    }
    const cuadro = (t) => {
      pintarGlare(Math.sin(t * 0.6) * 0.8)
      const despl = ((t * 0.28) % 1.6) - 0.3
      const transformacion = `translateX(${(despl * 1.6 * ancho).toFixed(1)}px) rotate(18deg)`
      for (const s of sheens) s.style.transform = transformacion
      return true
    }

    const bucle = crearBucle(el, cuadro)
    const aplicar = () => {
      if (consulta.matches) {
        bucle.querer(false)
        pintarGlare(0.4)
        for (const s of sheens) s.style.transform = 'translateX(0) rotate(18deg)'
      } else {
        bucle.querer(true)
      }
    }
    aplicar()
    consulta.addEventListener('change', aplicar)

    return () => {
      consulta.removeEventListener('change', aplicar)
      observador.disconnect()
      bucle.destruir()
    }
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
