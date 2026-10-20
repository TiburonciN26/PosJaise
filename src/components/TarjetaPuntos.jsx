import { useEffect, useRef } from 'react'
import { NIVELES_PUNTOS as NIVELES } from '../lib/nivelesPuntos.js'
import { crearBucle } from '../lib/bucleAnimacion.js'

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
// `etiqueta` cambia solo el rótulo sobre el número (Recompensas usa
// "PUNTOS DISPONIBLES"); `unidad` y `textoDorso` cambian solo esos dos textos (Recompensas con el programa activo usa «MONEDAS»
// y un dorso que no mezcla monedas con clasificación); el resto de la tarjeta no se toca.
export default function TarjetaPuntos({
  nivel,
  puntos,
  progresoPct,
  siguienteEtiqueta,
  nombre,
  etiqueta = 'PUNTOS ACUMULADOS',
  unidad = 'PTS',
  textoDorso = 'Suma puntos con cada visita y cada compra para subir de nivel y desbloquear más beneficios.',
}) {
  const stageRef = useRef(null)
  const lienzoRef = useRef(null)
  const cardRef = useRef(null)
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
    if (!stage || !lienzo || !card) return undefined

    let escala = 1
    let ajustarEscalaRef = () => {}
    const observer = new ResizeObserver(() => ajustarEscalaRef())
    observer.observe(stage)

    // Fase 6: el bucle solo corre cuando la tarjeta está en pantalla y la pestaña visible (crearBucle). Con «movimiento reducido»
    // no hay flotación ni giro automático: la tarjeta queda quieta y el bucle solo despierta mientras se arrastra o vuelve a su
    // posición de reposo (el arrastre es una acción de la persona, no animación automática). Las capas de brillo y destello se
    // buscan UNA vez y se mueven con transform (compuesto), sin recalcular layout ni rehacer el gradiente en cada cuadro.
    const consultaReducido = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducido = consultaReducido.matches
    const brillos = [...lienzo.querySelectorAll('.tp-glare')]
    const destellos = [...lienzo.querySelectorAll('.tp-sheen')]
    let ancho = lienzo.clientWidth || 1160

    let yaw = 0
    let pitch = 0
    let ty = 0
    let tp = 0
    let arrastrando = false
    let px = 0
    let py = 0
    let peso = reducido ? 0 : 1
    const SENS = 0.16
    const FOLLOW = 0.07
    const RETURN = 0.018
    let bucle = null

    function alPresionar(e) {
      arrastrando = true
      px = e.clientX
      py = e.clientY
      card.classList.add('tp-arrastrando')
      bucle?.querer(true)
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

    let ultimoBrillo = ''
    function cuadro(t) {
      if (!arrastrando) {
        // Con movimiento reducido vuelve al reposo más rápido (sin la deriva lenta del modo normal).
        const retorno = reducido ? 0.08 : RETURN
        ty += (0 - ty) * retorno
        tp += (0 - tp) * retorno
        peso += ((reducido ? 0 : 1) - peso) * 0.02
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
      card.style.transform = `translateY(${reducido ? 0 : fy}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${frz * peso}deg)`

      // Brillo y destello: se desplazan con transform (el gradiente es fijo, ver .tp-glare::before y .tp-sheen en index.css).
      const k = Math.sin((ry * Math.PI) / 180)
      const gx = `${(k * 0.4 * ancho).toFixed(1)}px`
      const gy = `${((-0.1 + rx * 0.02) * ancho * 0.69).toFixed(1)}px`
      const clave = gx + gy
      if (clave !== ultimoBrillo) {
        ultimoBrillo = clave
        for (const el of brillos) {
          el.style.setProperty('--gx', gx)
          el.style.setProperty('--gy', gy)
        }
      }
      const despl = ((t * 0.28) % 1.6) - 0.3 + k * 0.15
      const dx = `translateX(${(despl * 1.6 * ancho).toFixed(1)}px) rotate(18deg)`
      for (const el of destellos) el.style.transform = dx

      // En reposo con movimiento reducido el bucle se duerme solo.
      if (reducido && !arrastrando && Math.abs(ty) + Math.abs(tp) + Math.abs(yaw) + Math.abs(pitch) + Math.abs(peso) < 0.1) return false
      return true
    }

    function ajustarEscala() {
      escala = stage.clientWidth / 1160 || 1
      lienzo.style.transform = `scale(${escala})`
      stage.style.height = `${800 * escala}px`
      ancho = lienzo.clientWidth || 1160
    }
    ajustarEscala()
    ajustarEscalaRef = ajustarEscala

    bucle = crearBucle(stage, cuadro)
    cuadro(0) // primer cuadro estático (también con movimiento reducido)
    bucle.querer(!reducido)
    const alCambiarReducido = () => {
      reducido = consultaReducido.matches
      bucle.querer(!reducido)
    }
    consultaReducido.addEventListener('change', alCambiarReducido)

    return () => {
      bucle.destruir()
      consultaReducido.removeEventListener('change', alCambiarReducido)
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
  //
  // Fase 6: el conteo usa el MISMO bucle que la física (crearBucle): corre solo con la tarjeta en pantalla y la pestaña visible (si
  // se oculta a mitad, se pausa y CONTINÚA al volver hasta el valor final), y con «movimiento reducido» —desde el montaje o activado
  // durante el conteo— salta al valor final sin animar (ni conteo, ni barra, ni «pop»).
  useEffect(() => {
    const numEl = numRef.current
    const barraEl = barraRef.current
    const card = cardRef.current
    const stage = stageRef.current
    if (!numEl || !barraEl || !stage) return undefined

    const mostrarFinal = () => {
      numEl.textContent = Math.round(puntos).toLocaleString('es-PE')
      barraEl.style.width = `${progresoPct ?? 0}%`
    }
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (consulta.matches) {
      mostrarFinal()
    }
    let bucle = null
    const alCambiarPreferencia = () => {
      if (consulta.matches) {
        bucle?.destruir()
        bucle = null
        mostrarFinal()
      }
    }
    consulta.addEventListener('change', alCambiarPreferencia)

    if (!consulta.matches) {
      bucle = crearBucle(stage, (t) => {
        const p = Math.min(1, (t * 1000) / 2600)
        const e = 1 - (1 - p) ** 3
        numEl.textContent = Math.round(puntos * e).toLocaleString('es-PE')
        barraEl.style.width = `${(progresoPct ?? 0) * e}%`
        return p < 1
      })
      bucle.querer(true)
      if (card) {
        card.classList.remove('tp-pop')
        void card.offsetWidth
        card.classList.add('tp-pop')
      }
    }

    return () => {
      consulta.removeEventListener('change', alCambiarPreferencia)
      bucle?.destruir()
    }
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
                <div className="tp-tinta tp-etiqueta">{etiqueta}</div>
                <div className="tp-tinta tp-puntos">
                  <b ref={numRef}>0</b>
                  <span>{unidad}</span>
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
                  {textoDorso}
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
    </div>
  )
}
