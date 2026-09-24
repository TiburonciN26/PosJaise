import { useEffect, useRef } from 'react'

// Colores/variables por nivel — recreación de la referencia animada que
// trajo el usuario ("Niveles de Tarjeta Rewards"), un nivel por cada uno
// de sus 3 estados de demo (silver/diamond/gold), renombrados a los
// nombres reales del programa (ver mis_puntos(), 88_puntos.sql).
const NIVELES = {
  BASICO: {
    etiqueta: 'BÁSICO',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#6f757b 0%,#b9bec4 18%,#f4f6f8 34%,#8e949a 50%,#dde1e5 66%,#747a80 84%,#c8cdd2 100%)',
      '--tp-gb': 'linear-gradient(225deg,#6f757b 0%,#b9bec4 18%,#f4f6f8 34%,#8e949a 50%,#dde1e5 66%,#747a80 84%,#c8cdd2 100%)',
      '--tp-ink': '#25292d',
      '--tp-inkhi': 'rgba(255,255,255,.6)',
      '--tp-glow': 'rgba(210,216,222,.16)',
      '--tp-franja': 'linear-gradient(180deg,#1c1f22,#3a3f44 50%,#1c1f22)',
      '--tp-iri': 0,
    },
  },
  PREMIUM: {
    etiqueta: 'PREMIUM',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#8ea6bd 0%,#cfe2f3 18%,#ffffff 34%,#a9c3da 50%,#eaf4ff 66%,#93adc6 84%,#d8e8f7 100%)',
      '--tp-gb': 'linear-gradient(225deg,#8ea6bd 0%,#cfe2f3 18%,#ffffff 34%,#a9c3da 50%,#eaf4ff 66%,#93adc6 84%,#d8e8f7 100%)',
      '--tp-ink': '#1b2a3b',
      '--tp-inkhi': 'rgba(255,255,255,.7)',
      '--tp-glow': 'rgba(190,225,255,.22)',
      '--tp-franja': 'linear-gradient(180deg,#132030,#2c4560 50%,#132030)',
      '--tp-iri': 0.55,
    },
  },
  VIP: {
    etiqueta: 'VIP',
    vars: {
      '--tp-g': 'linear-gradient(135deg,#6e5214 0%,#c9a24a 18%,#f6e1a1 34%,#b48a2e 50%,#e9c874 66%,#8c6a1c 84%,#d9b660 100%)',
      '--tp-gb': 'linear-gradient(225deg,#6e5214 0%,#c9a24a 18%,#f6e1a1 34%,#b48a2e 50%,#e9c874 66%,#8c6a1c 84%,#d9b660 100%)',
      '--tp-ink': '#3b2a06',
      '--tp-inkhi': 'rgba(255,240,195,.55)',
      '--tp-glow': 'rgba(233,200,116,.18)',
      '--tp-franja': 'linear-gradient(180deg,#2a1d04,#4a3509 50%,#2a1d04)',
      '--tp-iri': 0,
    },
  },
}

// Tarjeta 3D de "Mis puntos" — recreación de la referencia animada que
// trajo el usuario, con dos diferencias a propósito frente a la demo
// original: (1) sin selector manual de nivel (ahí era para previsualizar
// los 3 estados; acá el cliente siempre ve SU nivel real, calculado en
// el servidor por mis_puntos()) y (2) el "lienzo" de diseño fijo
// (1160×800, mismo truco que la referencia) se escala para caber en su
// contenedor en vez de en toda la ventana, porque esto vive adentro de
// una subpágina, no a pantalla completa. El resto — arrastrar para
// girar en 3D, flotación idle, brillo/destello que siguen la rotación,
// el "pop" de flash al cambiar de tarjeta — se porta tal cual.
export default function TarjetaPuntos({ nivel, puntos, progresoPct, siguienteEtiqueta, nombre }) {
  const stageRef = useRef(null)
  const lienzoRef = useRef(null)
  const cardRef = useRef(null)
  const pistaRef = useRef(null)
  const numRef = useRef(null)
  const barraRef = useRef(null)

  const config = NIVELES[nivel] ?? NIVELES.BASICO

  // Física de arrastre/flotación — imperativa a propósito (rAF a 60fps
  // no se lleva bien con el ciclo de render de React), mismo criterio
  // que ya usa el crossfade de video de InicioCliente (ver
  // implementacionesWed.md §6, "Inicio v2").
  useEffect(() => {
    const stage = stageRef.current
    const lienzo = lienzoRef.current
    const card = cardRef.current
    const pista = pistaRef.current
    if (!stage || !lienzo || !card) return undefined

    let escala = 1
    function ajustarEscala() {
      escala = stage.clientWidth / 1160 || 1
      lienzo.style.transform = `scale(${escala})`
      stage.style.height = `${800 * escala}px`
    }
    ajustarEscala()
    const observer = new ResizeObserver(ajustarEscala)
    observer.observe(stage)

    let yaw = 0
    let pitch = 0
    let ty = 0
    let tp = 0
    let arrastrando = false
    let px = 0
    let py = 0
    let peso = 1
    const SENS = 0.16
    const FOLLOW = 0.07
    const RETURN = 0.018

    function alPresionar(e) {
      arrastrando = true
      px = e.clientX
      py = e.clientY
      card.classList.add('tp-arrastrando')
      if (pista) pista.style.opacity = '0'
    }
    function alMover(e) {
      if (!arrastrando) return
      const dx = (e.clientX - px) / escala
      const dy = (e.clientY - py) / escala
      px = e.clientX
      py = e.clientY
      ty += dx * SENS
      tp -= dy * SENS
    }
    function alSoltar() {
      if (!arrastrando) return
      arrastrando = false
      card.classList.remove('tp-arrastrando')
      const sy = 360 * Math.round(ty / 360)
      const sp = 360 * Math.round(tp / 360)
      ty -= sy
      yaw -= sy
      tp -= sp
      pitch -= sp
    }

    stage.addEventListener('pointerdown', alPresionar)
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
    window.addEventListener('pointercancel', alSoltar)
    window.addEventListener('blur', alSoltar)

    const t0 = performance.now()
    let raf

    function loop(now) {
      const t = (now - t0) / 1000
      if (!arrastrando) {
        ty += (0 - ty) * RETURN
        tp += (0 - tp) * RETURN
        peso += (1 - peso) * 0.02
      } else {
        peso += (0 - peso) * 0.08
      }
      yaw += (ty - yaw) * FOLLOW
      pitch += (tp - pitch) * FOLLOW
      const fy = Math.sin(t * 1.1) * 22
      const frx = Math.sin(t * 0.8) * 6 + 4
      const fry = Math.cos(t * 0.6) * 11
      const frz = Math.sin(t * 0.5) * 1.5
      const rx = pitch + frx * peso
      const ry = yaw + fry * peso
      card.style.transform = `translateY(${fy}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${frz * peso}deg)`

      const k = Math.sin((ry * Math.PI) / 180)
      const brilloBg = `radial-gradient(circle at ${50 + k * 40}% ${40 + rx * 2}%, rgba(255,248,220,.7), rgba(255,248,220,0) 45%)`
      lienzo.querySelectorAll('.tp-glare').forEach((el) => {
        el.style.background = brilloBg
      })
      const despl = ((t * 0.28) % 1.6) - 0.3 + k * 0.15
      lienzo.querySelectorAll('.tp-sheen').forEach((el) => {
        el.style.left = `${despl * 160 - 60}%`
      })

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      stage.removeEventListener('pointerdown', alPresionar)
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      window.removeEventListener('pointercancel', alSoltar)
      window.removeEventListener('blur', alSoltar)
    }
  }, [])

  // Conteo de puntos + barra de progreso (revelado animado, igual que la
  // referencia) y flash "pop" — se re-disparan cada vez que cambian los
  // puntos o el nivel real (ej. el cliente sube de nivel).
  useEffect(() => {
    const numEl = numRef.current
    const barraEl = barraRef.current
    const card = cardRef.current
    if (!numEl || !barraEl) return undefined

    const c0 = performance.now()
    let raf
    function pasoConteo(now) {
      const p = Math.min(1, (now - c0) / 2600)
      const e = 1 - (1 - p) ** 3
      numEl.textContent = Math.round(puntos * e).toLocaleString('es-PE')
      barraEl.style.width = `${(progresoPct ?? 0) * e}%`
      if (p < 1) raf = requestAnimationFrame(pasoConteo)
    }
    raf = requestAnimationFrame(pasoConteo)

    if (card) {
      card.classList.remove('tp-pop')
      void card.offsetWidth
      card.classList.add('tp-pop')
    }

    return () => cancelAnimationFrame(raf)
  }, [puntos, progresoPct])

  return (
    <div>
      <div ref={stageRef} className="tp-stage">
        <div ref={lienzoRef} className="tp-lienzo">
          <div className="tp-wrap">
            <div ref={cardRef} className="tp-card" style={config.vars}>
              <div className="tp-cara">
                <div className="tp-glare" />
                <div className="tp-sheen" />
                <svg className="tp-estrella" viewBox="0 0 100 100" aria-hidden="true">
                  <g fill="none" style={{ stroke: 'var(--tp-ink)' }} strokeWidth="1.4">
                    <circle cx="50" cy="50" r="46" />
                    <circle cx="50" cy="50" r="36" />
                    <path d="M50 14 L58 42 L86 50 L58 58 L50 86 L42 58 L14 50 L42 42 Z" fill="rgba(0,0,0,.12)" />
                  </g>
                </svg>
                <div className="tp-tinta tp-marca">JAISE</div>
                <div className="tp-tinta tp-nivel-badge">{config.etiqueta}</div>
                <svg className="tp-chip" width="110" height="84" viewBox="0 0 110 84" aria-hidden="true">
                  <defs>
                    <linearGradient id="tp-chip-g" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#f7e2a4" />
                      <stop offset=".5" stopColor="#b8903a" />
                      <stop offset="1" stopColor="#ecd08a" />
                    </linearGradient>
                  </defs>
                  <rect
                    x="1"
                    y="1"
                    width="108"
                    height="82"
                    rx="14"
                    fill="url(#tp-chip-g)"
                    style={{ stroke: 'var(--tp-ink)' }}
                    strokeWidth="2"
                  />
                  <g style={{ stroke: 'var(--tp-ink)' }} strokeWidth="2" fill="none">
                    <path d="M1 30 H36 M1 54 H36 M74 30 H109 M74 54 H109 M36 1 V83 M74 1 V83" />
                    <rect x="36" y="22" width="38" height="40" rx="6" />
                  </g>
                </svg>
                <div className="tp-tinta tp-etiqueta">PUNTOS ACUMULADOS</div>
                <div className="tp-tinta tp-puntos">
                  <b ref={numRef}>0</b>
                  <span>PTS</span>
                </div>
                <div className="tp-barra">
                  <i ref={barraRef} />
                </div>
                {siguienteEtiqueta && <div className="tp-tinta tp-siguiente">{siguienteEtiqueta}</div>}
                {nombre && <div className="tp-tinta tp-nombre">{nombre}</div>}
              </div>

              <div className="tp-cara tp-dorso">
                <div className="tp-glare" />
                <div className="tp-sheen" />
                <div className="tp-franja" />
                <div className="tp-firma" />
                <div className="tp-tinta tp-info">
                  Suma puntos con cada visita y cada compra para subir de nivel y desbloquear más beneficios.
                </div>
                <svg className="tp-estrella-dorso" viewBox="0 0 100 100" aria-hidden="true">
                  <g fill="none" style={{ stroke: 'var(--tp-ink)' }} strokeWidth="1.4">
                    <circle cx="50" cy="50" r="46" />
                    <path d="M50 14 L58 42 L86 50 L58 58 L50 86 L42 58 L14 50 L42 42 Z" fill="rgba(0,0,0,.12)" />
                  </g>
                </svg>
                <div className="tp-tinta tp-marca-dorso">JAISE</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p ref={pistaRef} className="tp-pista">
        ARRASTRA PARA GIRAR 360°
      </p>
    </div>
  )
}
