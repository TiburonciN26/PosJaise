import { useCallback, useEffect, useRef, useState } from 'react'

// Animación por scroll de "Resultados reales" (docs/diseno-inicio/README.md,
// sección "Animación de Resultados reales" — la pieza más delicada del
// rediseño de Inicio). El diseño aprobado son 6 fotos (3 parejas antes/
// después). Cada foto cae como un meteorito (clases .foto.cae/.espera +
// @keyframes en index.css) y SOLO un gesto nuevo de scroll dispara la
// siguiente, con la página fijada mientras dura la secuencia.
//
// Reglas (ver el README, no repetidas acá en detalle):
// 1. La foto 1 arranca sola cuando su tarjeta se ve COMPLETA en pantalla.
// 2. Cuando la fila entera queda centrada, la página se fija (se bloquea
//    el scroll real — nunca overflow:hidden, que rompe el layout).
// 3. Fijada, cada gesto nuevo dispara una foto; un gesto a mitad de una
//    animación se consume sin hacer nada. Una foto que arrancó nunca se
//    corta.
// 4. Al terminar la última foto se libera el scroll para siempre (esta
//    instancia del hook no vuelve a fijar nada).
// 5. Scroll hacia arriba mientras está fijada libera sin animar — no deja
//    a la clienta atrapada.
// 6. Se repite en cada montaje de la ruta (sin sessionStorage): el estado
//    vive en memoria de React, así que un remontaje ya arranca de cero.
// 7. prefers-reduced-motion: todo visible, sin fijar nada.
//
// Historial de rediseños internos (no del comportamiento — del CÓMO se
// detecta cada paso — tras bugs reales, confirmados con Playwright
// instrumentando IntersectionObserver y los listeners de scroll, no a
// ciegas):
// - "Centrado" y bloqueo del scroll dependían de `contenedorRef` (el div
//   con overflow-y-auto de la página) — nunca se disparaban.
//   `contenedorRef` ya no es un parámetro del hook.
// - Un intento posterior usó un IntersectionObserver con `threshold` de
//   21 pasos (cada 5%) para el centrado, sin `root` (viewport). Se veía
//   razonable pero tenía una falla real: un IntersectionObserver solo
//   dispara su callback cuando el RATIO de intersección cambia — y como
//   el bloque de fotos es más chico que el viewport, apenas entra
//   completo (ratio=1.0) el ratio se queda CONSTANTE mientras el bloque
//   se mueve libremente dentro del viewport. Confirmado con Playwright:
//   el observer se disparaba en un punto, y el siguiente disparo ya
//   estaba del otro lado del centro — el momento exacto pasaba
//   inadvertido siempre. Un IntersectionObserver no sirve para medir
//   POSICIÓN continua, solo para detectar cruces de visibilidad.
// - Detección actual: `getBoundingClientRect()` directo sobre la fila en
//   cada evento de scroll real, escuchado en `document` con
//   `capture: true` (no en un contenedor puntual): el scroll de un
//   elemento con overflow interno no burbujea de forma normal, pero SÍ
//   pasa por la fase de CAPTURA de cualquier ancestro, así que no hace
//   falta acertar cuál es "el" elemento con scroll real en esta
//   jerarquía de componentes.
// - El bloqueo del scroll (wheel/touchmove con preventDefault) va en
//   `window` — esos eventos SÍ hacen bubble normal hasta ahí sin
//   importar el contenedor, confirmado con Playwright contando eventos
//   recibidos.
// - "Gesto nuevo" agrupaba eventos de rueda por PAUSA de tiempo (>220ms
//   sin eventos). Un scroll continuo no deja esas pausas — TODO el
//   scroll contaba como un solo gesto. Ahora se acumula la DISTANCIA
//   recorrida (deltaY de rueda/trackpad, o los px de cada touchmove) y
//   cada UMBRAL_GESTO_PX dispara un avance — funciona igual con scroll
//   continuo o a los saltos, y sigue respetando la regla 3 (un avance
//   bloqueado por animación en curso no hace nada, hay que volver a
//   scrollear).
const DURACION_CAIDA_MS = 900
const UMBRAL_GESTO_PX = 90
const UMBRAL_CENTRADO_PX = 100

export function useSecuenciaScroll({ activo, reducirMovimiento, totalFotos }) {
  // La secuencia completa exige las 3 parejas del diseño (6 fotos), ni
  // una menos: con una sección más corta (1-2 parejas) es fácil que
  // quede ENTERA visible en el viewport inicial (foto + fila centrada a
  // la vez), y entonces la página se fija sola apenas se carga, sin que
  // la clienta haya scrolleado nada. Con menos de 3 parejas se muestran
  // todas directo, sin animar ni fijar el scroll.
  const listo = activo && !reducirMovimiento && totalFotos >= 6
  // Seguro pese a fijarse una sola vez en el primer render (a diferencia
  // del bug real de `terminadoRef` más abajo): en el primer render de
  // InicioCliente `totalFotos` siempre vale 0 (la galería todavía no
  // cargó), así que este valor inicial ya es 0 sin importar el caso —
  // exactamente el mismo "empezar en 0" que hace falta cuando `listo`
  // pasa a true más tarde.
  const [visto, setVisto] = useState(listo ? 0 : totalFotos)
  const [fijado, setFijado] = useState(false)

  const primeraFotoRef = useRef(null)
  const filaRef = useRef(null)

  const vistoRef = useRef(visto)
  vistoRef.current = visto
  const totalRef = useRef(totalFotos)
  totalRef.current = totalFotos
  const fijadoRef = useRef(false)
  fijadoRef.current = fijado
  const animandoRef = useRef(false)
  // Tras liberar manualmente hacia arriba, ignora el chequeo de centrado
  // hasta que la fila salga del centro y vuelva a entrar — si no, el
  // siguiente chequeo (mismo scroll, apenas unos px después) volvería a
  // fijar la página de inmediato, dejando a la clienta atrapada de nuevo
  // pese a haber "soltado".
  const bloqueTrasLiberarRef = useRef(false)

  const avanzar = useCallback(() => {
    if (animandoRef.current || vistoRef.current >= totalRef.current) return
    animandoRef.current = true
    // El cálculo y el efecto secundario (setTimeout) viven acá, en el
    // handler del gesto, en vez de dentro del updater de setVisto: un
    // updater con side-effects se ejecuta dos veces bajo StrictMode
    // (activo en este proyecto, ver src/main.jsx), duplicando el
    // temporizador. vistoRef ya está sincronizado con el último render,
    // así que sirve como fuente de verdad síncrona acá.
    const siguiente = vistoRef.current + 1
    setVisto(siguiente)
    if (siguiente >= totalRef.current) {
      setTimeout(() => {
        setFijado(false)
      }, DURACION_CAIDA_MS)
    }
    setTimeout(() => {
      animandoRef.current = false
    }, DURACION_CAIDA_MS)
  }, [])

  // 1. Foto 1 sola, cuando su tarjeta se ve completa (viewport real).
  useEffect(() => {
    if (!listo) return undefined
    const el = primeraFotoRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas[0].intersectionRatio >= 0.99 && vistoRef.current === 0) {
          avanzar()
          obs.disconnect()
        }
      },
      { threshold: [1] },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [listo, avanzar])

  // 2 y 5. Fija la página cuando el CENTRO de la fila está cerca del
  // centro de la VENTANA (mismo criterio "viewport real" que el
  // observer de arriba — ver la nota de historial sobre por qué ya no
  // depende de un contenedor específico).
  useEffect(() => {
    if (!listo) return undefined
    const fila = filaRef.current
    if (!fila) return undefined

    let pendiente = false

    function chequear() {
      pendiente = false
      const rect = fila.getBoundingClientRect()
      const centroFila = rect.top + rect.height / 2
      const centroVentana = window.innerHeight / 2
      const cerca = Math.abs(centroFila - centroVentana) < UMBRAL_CENTRADO_PX

      if (!cerca) {
        bloqueTrasLiberarRef.current = false
        return
      }
      if (bloqueTrasLiberarRef.current || fijadoRef.current) return
      // "Terminada" (las 6 ya cayeron) se deriva de visto/total en el
      // momento del chequeo, no de un ref aparte: un `useRef(!listo)`
      // fija su valor en el PRIMER render y nunca se resincroniza si
      // `listo` cambia después (mismo bug real que useRevelarAntes tenía
      // con el hero) — acá directamente `visto < total` ya cubre "no
      // fijar si ya terminó", sin ese riesgo.
      if (vistoRef.current >= 1 && vistoRef.current < totalRef.current) {
        setFijado(true)
      }
    }

    function alScroll() {
      if (pendiente) return
      pendiente = true
      requestAnimationFrame(chequear)
    }

    chequear()
    // capture:true en document (no un listener en `contenedorRef`
    // puntual, ver la nota de historial de arriba): el scroll de un
    // elemento con overflow interno NO burbujea de forma normal, pero SÍ
    // pasa por la fase de CAPTURA de cualquier ancestro — así no hace
    // falta acertar cuál es "el" elemento real con scroll en esta
    // jerarquía de componentes.
    document.addEventListener('scroll', alScroll, { capture: true, passive: true })
    window.addEventListener('resize', chequear)
    return () => {
      document.removeEventListener('scroll', alScroll, { capture: true })
      window.removeEventListener('resize', chequear)
    }
  }, [listo])

  // 3 y 5. Mientras está fijada: bloquea el scroll real (listeners en
  // `window`, no en un contenedor puntual) y traduce la distancia
  // acumulada de cada gesto (rueda/trackpad/touch) en avances — uno por
  // cada UMBRAL_GESTO_PX recorrido, sin importar si el scroll fue
  // continuo o a los saltos.
  useEffect(() => {
    if (!listo) return undefined

    let acumulado = 0
    let touchY = null

    function liberar() {
      acumulado = 0
      bloqueTrasLiberarRef.current = true
      setFijado(false)
    }

    function registrarDistancia(delta) {
      acumulado += delta
      if (acumulado < UMBRAL_GESTO_PX) return
      acumulado = 0
      avanzar()
    }

    function alRueda(evento) {
      if (!fijadoRef.current) return
      // Sin preventDefault acá: el gesto de liberar hacia arriba debe
      // MOVER la página de inmediato (regla 5), no solo desbloquear
      // para el siguiente evento — antes se llamaba preventDefault()
      // incondicionalmente antes de mirar la dirección, así que ese
      // primer scroll hacia arriba quedaba cancelado igual, y recién el
      // segundo se veía (bug real, confirmado con Playwright).
      if (evento.deltaY < 0) {
        liberar()
        return
      }
      evento.preventDefault()
      if (evento.deltaY === 0) return
      registrarDistancia(evento.deltaY)
    }

    function alTouchStart(evento) {
      if (!fijadoRef.current) return
      touchY = evento.touches[0].clientY
    }

    function alTouchMove(evento) {
      if (!fijadoRef.current || touchY === null) return
      const y = evento.touches[0].clientY
      // El dedo sube (y disminuye) = quiere ver más abajo = "avanzar",
      // mismo signo que deltaY positivo de la rueda.
      const delta = touchY - y
      touchY = y
      if (delta < 0) {
        liberar()
        return
      }
      evento.preventDefault()
      registrarDistancia(delta)
    }

    window.addEventListener('wheel', alRueda, { passive: false })
    window.addEventListener('touchstart', alTouchStart, { passive: true })
    window.addEventListener('touchmove', alTouchMove, { passive: false })
    return () => {
      window.removeEventListener('wheel', alRueda)
      window.removeEventListener('touchstart', alTouchStart)
      window.removeEventListener('touchmove', alTouchMove)
    }
  }, [listo, avanzar])

  const estadoFoto = useCallback(
    (indice) => {
      if (!listo) return ''
      return indice < visto ? 'cae' : 'espera'
    },
    [listo, visto],
  )

  const claseSacudida = !listo || visto === 0 ? '' : visto % 2 ? 'sacA' : 'sacB'
  const enCurso = listo && visto >= 1 && visto < totalFotos
  const puntos = Array.from({ length: totalFotos }, (_, i) => i < visto)

  return { primeraFotoRef, filaRef, estadoFoto, claseSacudida, enCurso, puntos }
}
