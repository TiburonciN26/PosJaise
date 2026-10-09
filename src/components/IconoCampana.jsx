import { useLayoutEffect, useRef } from 'react'

// Campana de notificaciones — recorte del "BellToggle" real de React
// Bits (registro @react-bits, `npx shadcn view @react-bits/BellToggle-JS-TW`).
// El componente original es un SWITCH de encendido/apagado (píldora con
// texto "Notify me"/"You'll be notified" que se ensancha al tocarla) —
// no lo que hace falta acá, que es un simple ícono de header que ABRE un
// panel de notificaciones al tocarlo. Por pedido explícito del usuario,
// de ahí solo se trae el ícono + el repique + el badge de conteo, sin la
// píldora ni el estado de encendido/apagado.
//
// El repique en sí NO usa `framer-motion` en el original — usa
// `element.animate()` nativo del navegador (Web Animations API) con
// keyframes calculados a mano (`ringKeyframes`), así que este recorte
// tampoco necesita ninguna librería nueva. Tampoco se trajo la
// dependencia de íconos `@hugeicons/*` que usa el original por
// default — acá siempre se dibuja el SVG de campana con badajo
// (equivalente a su prop `clapper`), que ya viene sin esa dependencia.
const AMPLITUD_REPIQUE = 17
const PASADAS_REPIQUE = 5
const DECAIMIENTO_REPIQUE = 1
const DURACION_REPIQUE_MS = 820

function desplazamientoPasada(k, pasadas) {
  return 1 - Math.pow(1 - (k + 2 / 3) / (pasadas + 1), 0.6)
}

function fotogramasRepique(desde, amplitud, pasadas, decaimiento) {
  const fotogramas = [{ transform: `rotate(${desde}deg)`, offset: 0 }]
  for (let k = 0; k < pasadas; k++) {
    const angulo = amplitud * Math.pow(1 - k / pasadas, decaimiento) * (k % 2 ? 1 : -1)
    fotogramas.push({ transform: `rotate(${angulo.toFixed(2)}deg)`, offset: desplazamientoPasada(k, pasadas) })
  }
  fotogramas.push({ transform: 'rotate(0deg)', offset: 1 })
  return fotogramas
}

function anguloActual(el) {
  const tf = getComputedStyle(el).transform
  if (!tf || tf === 'none') return 0
  const m = new DOMMatrix(tf)
  return (Math.atan2(m.b, m.a) * 180) / Math.PI
}

export default function IconoCampana({
  contador = 0,
  onClick,
  className = '',
  ariaLabel = 'Notificaciones',
  grande = false,
  estiloBadge = { background: '#ef4444', color: '#ffffff' },
}) {
  const tam = grande ? 'h-6 w-6' : 'h-5 w-5'
  const glifoRef = useRef(null)
  const badajoRef = useRef(null)
  const ondaIzqRef = useRef(null)
  const ondaDerRef = useRef(null)
  const contadorAnteriorRef = useRef(contador)

  function repicar() {
    const el = glifoRef.current
    if (!el) return
    el.getAnimations().forEach((a) => a.cancel())
    el.animate(fotogramasRepique(anguloActual(el), AMPLITUD_REPIQUE, PASADAS_REPIQUE, DECAIMIENTO_REPIQUE), {
      duration: DURACION_REPIQUE_MS,
      easing: 'linear',
    })

    const badajo = badajoRef.current
    if (badajo) {
      badajo.getAnimations().forEach((a) => a.cancel())
      badajo.animate(
        fotogramasRepique(anguloActual(badajo), AMPLITUD_REPIQUE * 1.6, PASADAS_REPIQUE, DECAIMIENTO_REPIQUE),
        { duration: DURACION_REPIQUE_MS, delay: 70, easing: 'linear' },
      )
    }

    for (let k = 0; k < PASADAS_REPIQUE; k++) {
      const lado = k % 2 ? ondaDerRef.current : ondaIzqRef.current
      if (!lado) continue
      const fuerza = Math.pow(1 - k / PASADAS_REPIQUE, DECAIMIENTO_REPIQUE)
      lado.animate(
        [
          { opacity: 0, transform: 'scale(0.55)' },
          { opacity: 0.9 * fuerza, offset: 0.3 },
          { opacity: 0, transform: 'scale(1.25)' },
        ],
        { duration: 380, delay: desplazamientoPasada(k, PASADAS_REPIQUE) * DURACION_REPIQUE_MS, easing: 'ease-out' },
      )
    }
  }

  // Repica solo — sin abrir nada — cuando llega una notificación nueva
  // (el contador sube) mientras el usuario no tocó la campana; repicar
  // AL TOCARLA es un plus aparte, en el onClick de abajo.
  useLayoutEffect(() => {
    const anterior = contadorAnteriorRef.current
    contadorAnteriorRef.current = contador
    if (contador > anterior) repicar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contador])

  function alTocar() {
    repicar()
    onClick?.()
  }

  const conBadge = contador > 0

  return (
    <button
      type="button"
      onClick={alTocar}
      aria-label={contador > 0 ? `${ariaLabel} (${contador} sin leer)` : ariaLabel}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${className}`}
    >
      <span className={`relative inline-grid ${tam} place-items-center`} aria-hidden="true">
        <span
          ref={glifoRef}
          className={`inline-grid ${tam} place-items-center [transform-origin:50%_16%]`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={tam}>
            <path d="M6 16.5V10a6 6 0 0 1 12 0v6.5l1.6 2.3H4.4L6 16.5z" />
            <path d="M12 2.5V4" />
          </svg>
        </span>
        <span ref={badajoRef} className="pointer-events-none absolute inset-0 [transform-origin:50%_16%]">
          <svg viewBox="0 0 24 24" className={tam}>
            <circle cx="12" cy="20.4" r="1.7" fill="currentColor" />
          </svg>
        </span>

        <svg
          ref={ondaIzqRef}
          className="pointer-events-none absolute -top-[3px] right-[calc(100%-2px)] h-3.5 w-3.5 origin-bottom-right fill-none stroke-current opacity-0"
          viewBox="0 0 14 14"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M14 8a6 6 0 0 0-6 6" />
          <path d="M14 4A10 10 0 0 0 4 14" />
        </svg>
        <svg
          ref={ondaDerRef}
          className="pointer-events-none absolute -top-[3px] left-[calc(100%-2px)] h-3.5 w-3.5 origin-bottom-left fill-none stroke-current opacity-0"
          viewBox="0 0 14 14"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M0 8a6 6 0 0 1 6 6" />
          <path d="M0 4a10 10 0 0 1 10 10" />
        </svg>

        {conBadge && (
          <span
            key={contador}
            className="pointer-events-none absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-[7px] px-[3px] text-[9.5px] font-semibold leading-none"
            style={estiloBadge}
          >
            {contador > 9 ? '9+' : contador}
          </span>
        )}
      </span>
    </button>
  )
}
