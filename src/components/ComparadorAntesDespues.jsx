import { useEffect, useRef, useState } from 'react'
import { MoveHorizontal, MoveVertical } from 'lucide-react'

// Slider de comparación "antes/después" — reconstruido a mano contra la
// TABLA DE PROPS del comparison-slider de ReactBits Pro (componente de
// pago; el usuario pasó una captura de esa tabla porque no hay forma de
// leer su código fuente desde acá) — esto replica el comportamiento que
// esa tabla describe, no su implementación real interna, que sigue sin
// conocerse. Los defaults de cada prop calzan con los de esa captura
// (initialPosition 50, dividerWidth 3, handleSize 48, dividerColor/
// handleColor blancos, showLabels/showPercentage/dragOnHover/autoAnimate
// apagados, enableInertia prendido). `titulo` es la única prop sin
// equivalente ahí: el pie de foto con el nombre del trabajo, dato real
// de `galeria_web.titulo`.
//
// Mecánica: "después" de fondo a ancho/alto completo, "antes" encima
// recortado con clip-path hasta la posición del divisor. Arrastre con
// setPointerCapture (no listeners en window) — no se corta si el cursor
// sale del contenedor a media pasada. Inercia y vaivén comparten el
// mismo loop de requestAnimationFrame (nunca los dos a la vez);
// arrancar un arrastre nuevo cancela cualquiera de los dos que esté
// corriendo.
//
// `mostrarDivisor`/`mostrarHandle` (§7.66): vuelven a `true` — un primer
// pedido de ocultarlos (§7.65) resultó ser un malentendido, la línea SÍ
// debía verse, solo que muy tenue. §7.68 es la versión final de esa
// línea: NO es una opacity fija sobre un ancho constante (eso, aunque
// tenue, seguía viéndose como "una raya rectangular cruda", reportado
// con una referencia real de una línea de luz horizontal) — es un
// `linear-gradient` de transparencia (transparent → color → transparent
// a lo largo del eje) en dos capas superpuestas: un núcleo fino y nítido
// + un resplandor más ancho con blur detrás. Como las dos capas comparten
// el MISMO degradado, el resplandor ancho nunca se nota en las puntas (el
// degradado ya vale ~0 ahí) y solo "florece" cerca del centro (el pico
// del degradado) — de ahí sale el efecto "se apaga en las puntas, se ve
// más gorda/brillante solo al medio" sin necesitar una forma aparte (la
// cápsula de §7.66, que además se sacó por verse como una mancha blanca
// al compararla contra una referencia real). El handle suma su propio
// halo chico (1.6× su tamaño, `blur-sm`, opacity 0.25) en el mismo punto
// donde el degradado de la línea ya está en su pico — ambos coinciden a
// propósito. `animarAutomatico` se queda en `true`:
// el vaivén es lo que hace que valga la pena tener esta línea siempre
// visible en vez de solo aparecer al arrastrar. Ese vaivén (`iniciarVaiven`,
// reemplaza al autoAnimate random de la v1) es intencionalmente
// determinístico, no aleatorio: suma de dos senos de distinta frecuencia
// (mismo período de 8s, uno el doble de rápido que el otro) alrededor del
// 50% — empieza siempre en el centro (los dos senos valen 0 en t=0),
// arranca hacia la derecha (la pendiente en t=0 es positiva), cruza de
// vuelta el centro, sigue un poco a la izquierda y se repite — pedido
// exacto del usuario ("cambios de velocidad irregulares pero suaves": la
// SUMA de dos senos da velocidad no constante en cada instante — eso es
// lo "irregular" — pero cada seno por sí solo es perfectamente continuo
// — eso es lo "suave"; un `Math.random()` hubiera dado lo irregular pero
// nunca lo suave).
// Duración del regreso "orgánico" al soltar el arrastre (§7.72-7.74) —
// ver el comentario de `iniciarRegresoOrganico` más abajo. 900 → 1400 →
// 1900ms ("más despacio" pedido dos veces).
const DURACION_REGRESO_MS = 1900

// Ease-in-out cúbico: lento al empezar, acelera hacia la mitad del
// recorrido, vuelve a frenar cerca de llegar — no un ease-in puro (que
// seguía acelerando hasta el final, reportado como "no lineal pero
// tampoco lo que pedí"). El usuario lo describió exacto: "comienza
// lento y aumenta gradualmente en su centro [de la animación] y cuando
// casi llega al centro [destino] nuevamente se hace lento" — la curva
// clásica lento-rápido-lento.
function facilEntradaSalida(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

// Paradas de un degradado lineal transparente→color→transparente, pero
// con caída EASED (varios stops de por medio vía `color-mix`) en vez de
// solo 3 puntos interpolados en línea recta — mismo problema que ya se
// resolvió en el halo del handle (§7.71): una caída lineal se percibe
// con un borde/bloque duro sobre fondo muy oscuro, aunque matemáticamente
// sí llegue a 0. Reusado para el núcleo Y el resplandor de la línea
// (§7.75) — antes cada uno tenía su propio degradado de 3 stops sin esta
// corrección, por eso seguía viéndose "en bloque" en las puntas pese al
// blur.
function paradasDesvanecidas(color) {
  return `transparent 0%,
    color-mix(in srgb, ${color} 4%, transparent) 12%,
    color-mix(in srgb, ${color} 14%, transparent) 26%,
    color-mix(in srgb, ${color} 38%, transparent) 40%,
    ${color} 50%,
    color-mix(in srgb, ${color} 38%, transparent) 60%,
    color-mix(in srgb, ${color} 14%, transparent) 74%,
    color-mix(in srgb, ${color} 4%, transparent) 88%,
    transparent 100%`
}

const ETIQUETA_POSICION_CLASES = {
  'top-left': 'top-3',
  'top-right': 'top-3',
  'bottom-left': 'bottom-3',
  'bottom-right': 'bottom-3',
}

export default function ComparadorAntesDespues({
  antes,
  despues,
  altAntes = 'Antes',
  altDespues = 'Después',
  posicionInicial = 50,
  orientacion = 'horizontal',
  inercia = false,
  arrastrarEnHover = false,
  animarAutomatico = true,
  grosorDivisor = 2,
  colorDivisor = '#ffffff',
  mostrarDivisor = true,
  mostrarHandle = true,
  tamanoHandle = 40,
  colorHandle = '#ffffff',
  iconoHandle: IconoHandlePersonalizado,
  alCambiarPosicion,
  className = '',
  imagenClassName = '',
  mostrarEtiquetas = false,
  textoEtiquetas = { antes: 'Antes', despues: 'Después' },
  posicionEtiquetas = 'top-left',
  etiquetaClassName = '',
  etiquetaAntesClassName = '',
  etiquetaDespuesClassName = '',
  mostrarPorcentaje = false,
  posicionPorcentaje = 'top',
  alIniciarArrastre,
  alTerminarArrastre,
  ariaLabel = 'Slider de comparación de imágenes',
  movimientoReducido = false,
  titulo,
}) {
  const contenedorRef = useRef(null)
  const [posicion, setPosicionEstado] = useState(posicionInicial)
  const posicionRef = useRef(posicionInicial)
  const arrastrandoRef = useRef(false)
  const velocidadRef = useRef(0)
  const ultimoRef = useRef({ pos: posicionInicial, t: 0 })
  const animRef = useRef(null)
  const inicioRelojRef = useRef(performance.now())

  const vertical = orientacion === 'vertical'
  const IconoHandle = IconoHandlePersonalizado ?? (vertical ? MoveVertical : MoveHorizontal)

  function actualizarPosicion(valor) {
    const acotado = Math.min(100, Math.max(0, valor))
    posicionRef.current = acotado
    setPosicionEstado(acotado)
    alCambiarPosicion?.(acotado)
  }

  function detenerAnimacion() {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = null
  }

  function coordenadaDesdeEvento(evento) {
    const rect = contenedorRef.current.getBoundingClientRect()
    return vertical
      ? ((evento.clientY - rect.top) / rect.height) * 100
      : ((evento.clientX - rect.left) / rect.width) * 100
  }

  // `inercia` (§7.74): default pasó de `true` a `false` — el usuario
  // reportó el "efecto pelota" (soltar con un toque chico y el divisor
  // se iba disparado hasta el extremo, en vez de quedarse cerca de donde
  // soltó). La causa de fondo ya se corrigió (tope de velocidad en
  // `alMover`), pero además de eso el propio concepto de "fling físico"
  // no es lo que se pidió — acá lo único que debe pasar al soltar es el
  // regreso orgánico (`iniciarRegresoOrganico`), nunca un envión. Sigue
  // existiendo como prop opcional (paridad con `enableInertia` de la
  // tabla de referencia) para quien la quiera prender a mano.
  function iniciarInercia() {
    let velocidad = velocidadRef.current * 16 // %/ms → %/frame aprox (frame ~16ms)
    function paso() {
      velocidad *= 0.94
      const siguiente = posicionRef.current + velocidad
      const fueraDeRango = siguiente <= 0 || siguiente >= 100
      actualizarPosicion(siguiente)
      if (fueraDeRango || Math.abs(velocidad) < 0.02) {
        if (animarAutomatico) iniciarRegresoOrganico()
        return
      }
      animRef.current = requestAnimationFrame(paso)
    }
    animRef.current = requestAnimationFrame(paso)
  }

  // Vaivén determinístico (no random): suma de dos senos, período base de
  // 8s, el segundo al doble de frecuencia — ver el comentario grande de
  // arriba del archivo para el porqué. `t` corre en reloj real desde que
  // se montó el componente (no se reinicia al retomar tras un arrastre),
  // así el "bucle" sigue existiendo en el tiempo aunque se interrumpa.
  function valorVaiven(tAbsolutoMs) {
    const t = (tAbsolutoMs - inicioRelojRef.current) / 1000
    return 50 + 9 * Math.sin((2 * Math.PI * t) / 8) + 3 * Math.sin((2 * Math.PI * t) / 4)
  }

  function iniciarVaiven() {
    function paso() {
      if (arrastrandoRef.current) return
      const objetivo = valorVaiven(performance.now())
      actualizarPosicion(posicionRef.current + (objetivo - posicionRef.current) * 0.05)
      animRef.current = requestAnimationFrame(paso)
    }
    animRef.current = requestAnimationFrame(paso)
  }

  // Regreso "orgánico" al soltar (§7.72-7.73): antes, soltar el arrastre
  // encadenaba directo a `iniciarVaiven()`, que persigue el objetivo con
  // un lerp por frame (`pos += (objetivo - pos) * 0.05`) — eso es
  // matemáticamente una curva ease-OUT (salto grande al principio, cada
  // vez más lento a medida que se acerca). Se resuelve con un tween de
  // duración fija (`DURACION_REGRESO_MS`) en vez de un lerp infinito:
  // interpola entre la posición donde se soltó y hacia dónde va a estar
  // el vaivén CUANDO ese tween termine (`valorVaiven` evaluado en el
  // futuro, no en el presente) usando `facilEntradaSalida` — así el
  // empalme con `iniciarVaiven()` al final es exacto, sin salto.
  function iniciarRegresoOrganico() {
    const inicio = posicionRef.current
    const tInicio = performance.now()
    const objetivo = valorVaiven(tInicio + DURACION_REGRESO_MS)

    function paso() {
      if (arrastrandoRef.current) return
      const progreso = Math.min(1, (performance.now() - tInicio) / DURACION_REGRESO_MS)
      actualizarPosicion(inicio + (objetivo - inicio) * facilEntradaSalida(progreso))
      if (progreso >= 1) {
        iniciarVaiven()
        return
      }
      animRef.current = requestAnimationFrame(paso)
    }
    animRef.current = requestAnimationFrame(paso)
  }

  function continuarTrasSoltar() {
    if (inercia && !movimientoReducido && Math.abs(velocidadRef.current) > 0.02) {
      iniciarInercia()
    } else if (animarAutomatico && !movimientoReducido) {
      iniciarRegresoOrganico()
    }
  }

  function alBajar(evento) {
    detenerAnimacion()
    evento.currentTarget.setPointerCapture(evento.pointerId)
    arrastrandoRef.current = true
    const pos = coordenadaDesdeEvento(evento)
    ultimoRef.current = { pos, t: performance.now() }
    velocidadRef.current = 0
    actualizarPosicion(pos)
    alIniciarArrastre?.()
  }

  function alMover(evento) {
    const enHover = !arrastrandoRef.current && arrastrarEnHover && evento.pointerType !== 'touch'
    if (!arrastrandoRef.current && !enHover) return

    const ahora = performance.now()
    const pos = coordenadaDesdeEvento(evento)
    const dt = Math.max(1, ahora - ultimoRef.current.t)
    // Tope a la velocidad medida (±0.3 %/ms): sin esto, un par de eventos
    // de pointermove muy pegados en el tiempo (dt chico, a veces 1-2ms)
    // podían dar una velocidad instantánea absurda — es la causa real del
    // "efecto pelota" reportado (§7.74): con `inercia` prendida, esa
    // velocidad se multiplicaba y sumaba en cadena hasta mandar el
    // divisor de un toque hasta el extremo (0 o 100) en vez de quedarse
    // cerca de donde se soltó.
    velocidadRef.current = Math.min(0.3, Math.max(-0.3, (pos - ultimoRef.current.pos) / dt))
    ultimoRef.current = { pos, t: ahora }
    actualizarPosicion(pos)
  }

  function alSoltar() {
    if (!arrastrandoRef.current) return
    arrastrandoRef.current = false
    alTerminarArrastre?.()
    continuarTrasSoltar()
  }

  function alSalirDelArea() {
    if (arrastrandoRef.current || !arrastrarEnHover) return
    continuarTrasSoltar()
  }

  function alPresionarTecla(evento) {
    const teclaMenos = vertical ? 'ArrowUp' : 'ArrowLeft'
    const teclaMas = vertical ? 'ArrowDown' : 'ArrowRight'
    if (evento.key !== teclaMenos && evento.key !== teclaMas) return
    evento.preventDefault()
    detenerAnimacion()
    velocidadRef.current = 0
    actualizarPosicion(posicionRef.current + (evento.key === teclaMas ? 2 : -2))
    continuarTrasSoltar()
  }

  useEffect(() => {
    if (animarAutomatico && !movimientoReducido) {
      iniciarVaiven()
    } else {
      detenerAnimacion()
    }
    return () => detenerAnimacion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animarAutomatico, movimientoReducido])

  const clipDesdeAntes = vertical
    ? `inset(0 0 ${100 - posicion}% 0)`
    : `inset(0 ${100 - posicion}% 0 0)`
  const posicionEtiquetasClase = ETIQUETA_POSICION_CLASES[posicionEtiquetas] ?? ETIQUETA_POSICION_CLASES['top-left']

  return (
    <div className={`overflow-hidden rounded-2xl ${className}`}>
      <div
        ref={contenedorRef}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerLeave={alSalirDelArea}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-orientation={orientacion}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(posicion)}
        onKeyDown={alPresionarTecla}
        className="relative aspect-[4/3] w-full touch-none select-none outline-none"
      >
        <img
          src={despues}
          alt={altDespues}
          draggable={false}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${imagenClassName}`}
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: clipDesdeAntes }}>
          <img
            src={antes}
            alt={altAntes}
            draggable={false}
            className={`absolute inset-0 h-full w-full object-cover ${imagenClassName}`}
          />
        </div>

        {/* §7.79: `.liquid-glass` (index.css) define su propio `position:
            relative` bajo el selector `.landing-web .liquid-glass` —
            especificidad (0,2,0), más alta que la clase `.absolute` de
            Tailwind (0,1,0) — así que ganaba y pisaba silenciosamente
            el `position: absolute` de estos 3 elementos. El bug real:
            sin `position: absolute` de verdad, las etiquetas dejaban de
            posicionarse contra el contenedor y pasaban a flujo normal
            del documento — por eso "Antes" y "Después" aparecían
            pegadas una junto a la otra cerca de donde arranca el
            contenido, sin importar qué digan `left-3`/`right-3`/`top-*`
            (esas clases sí se siguen aplicando, pero como OFFSETS desde
            la posición en flujo, no como coordenadas absolutas reales
            del contenedor). Fix: `style={{ position: 'absolute' }}`
            inline — un estilo en línea siempre gana por especificidad a
            cualquier selector de clase, sin tener que tocar
            `.liquid-glass` (usado en decenas de lugares más). */}
        {mostrarEtiquetas && (
          <>
            <span
              style={{ position: 'absolute' }}
              className={`liquid-glass pointer-events-none left-3 rounded-full px-3 py-1 text-xs font-medium text-white ${posicionEtiquetasClase} ${etiquetaClassName} ${etiquetaAntesClassName}`}
            >
              {textoEtiquetas.antes}
            </span>
            <span
              style={{ position: 'absolute' }}
              className={`liquid-glass pointer-events-none right-3 rounded-full px-3 py-1 text-xs font-medium text-white ${posicionEtiquetasClase} ${etiquetaClassName} ${etiquetaDespuesClassName}`}
            >
              {textoEtiquetas.despues}
            </span>
          </>
        )}

        {mostrarPorcentaje && (
          <span
            style={{ position: 'absolute' }}
            className={`liquid-glass pointer-events-none left-1/2 -translate-x-1/2 rounded-full px-3 py-1 font-mono text-xs text-white ${
              posicionPorcentaje === 'bottom' ? 'bottom-3' : 'top-3'
            }`}
          >
            {Math.round(posicion)}%
          </span>
        )}

        {/* Ancla de posición pura (sin fondo propio) — la línea y el
            handle se dibujan como capas propias adentro, centradas en
            este mismo punto. §7.68: opacidad plana constante (§7.67) se
            veía como una raya rectangular cruda, nada parecida a la
            referencia real (una línea de luz que se APAGA en las dos
            puntas y se nota más ancha/brillante solo cerca del centro).
            §7.75: el degradado de 3 stops de §7.68 (transparent → color
            → transparent) seguía viéndose "en bloque" sobre fondos MUY
            oscuros — mismo problema que ya se había corregido en el halo
            del handle (§7.71): una caída lineal se percibe con un borde
            duro cerca del negro aunque el número sí llegue a 0. Ahora
            usa `paradasDesvanecidas()` (varios stops vía `color-mix`,
            mismo mecanismo que el handle) tanto en el núcleo como en el
            resplandor, y el blur del resplandor subió de `blur-md` a
            `blur-xl` para que se disuelva del todo. */}
        <div
          className="pointer-events-none absolute z-10"
          style={vertical ? { left: 0, right: 0, top: `${posicion}%` } : { top: 0, bottom: 0, left: `${posicion}%` }}
        >
          {mostrarDivisor && (
            <>
              {/* Resplandor: capa ancha y difuminada detrás del núcleo,
                  mismo degradado — se ve solo cerca del centro. */}
              <div
                className="absolute blur-xl"
                style={
                  vertical
                    ? {
                        left: 0,
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        height: grosorDivisor * 4,
                        background: `linear-gradient(to right, ${paradasDesvanecidas(colorDivisor)})`,
                        opacity: 0.4,
                      }
                    : {
                        top: 0,
                        bottom: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: grosorDivisor * 4,
                        background: `linear-gradient(to bottom, ${paradasDesvanecidas(colorDivisor)})`,
                        opacity: 0.4,
                      }
                }
              />
              {/* Núcleo: fino y nítido, sin blur, mismo degradado. */}
              <div
                className="absolute"
                style={
                  vertical
                    ? {
                        left: 0,
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        height: grosorDivisor,
                        background: `linear-gradient(to right, ${paradasDesvanecidas(colorDivisor)})`,
                        opacity: 0.9,
                      }
                    : {
                        top: 0,
                        bottom: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: grosorDivisor,
                        background: `linear-gradient(to bottom, ${paradasDesvanecidas(colorDivisor)})`,
                        opacity: 0.9,
                      }
                }
              />
            </>
          )}

          {mostrarHandle && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              {/* Halo del handle (§7.71/§7.75/§7.76/§7.77): cada ronda
                  estiró más la cola del degradado porque, sobre negro
                  puro, el ojo sigue notando dónde "termina" el brillo
                  mucho antes de que el número llegue matemáticamente a
                  0. §7.76 además subió el radio (2.3× → 2.6×) pensando
                  que la cola larga necesitaba más caja donde disolverse
                  — el usuario pidió mantener el radio en 2.3× (le
                  gustaba ese tamaño) y preguntó si igual se podía. Sí: el
                  filtro `blur()` de CSS no se recorta en el borde de su
                  propio elemento (solo lo recorta un ancestro con
                  `overflow: hidden` — acá el único es el borde de la
                  foto), así que la cola larga + el blur fuerte se siguen
                  viendo bien sobre una caja más chica sin ningún corte.
                  7 stops (antes 6), caída mucho más lenta y larga desde
                  el 40% del radio en adelante, terminando en 1%/0.5% de
                  color mucho antes del borde, + `blur-2xl` (40px, antes
                  `blur-xl`/24px). */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
                style={{
                  width: tamanoHandle * 2.3,
                  height: tamanoHandle * 2.3,
                  background: `radial-gradient(circle,
                    ${colorHandle} 0%,
                    ${colorHandle} 6%,
                    color-mix(in srgb, ${colorHandle} 45%, transparent) 20%,
                    color-mix(in srgb, ${colorHandle} 22%, transparent) 34%,
                    color-mix(in srgb, ${colorHandle} 10%, transparent) 48%,
                    color-mix(in srgb, ${colorHandle} 4%, transparent) 62%,
                    color-mix(in srgb, ${colorHandle} 1%, transparent) 78%,
                    transparent 100%)`,
                  opacity: 0.32,
                }}
              />
              <div
                className="relative flex items-center justify-center rounded-full shadow-lg"
                style={{ width: tamanoHandle, height: tamanoHandle, background: colorHandle }}
              >
                <IconoHandle className="h-4 w-4 text-black" />
              </div>
            </div>
          )}
        </div>
      </div>

      {titulo && (
        <p className="liquid-glass rounded-none rounded-b-2xl px-4 py-2.5 text-sm text-white/80">{titulo}</p>
      )}
    </div>
  )
}
