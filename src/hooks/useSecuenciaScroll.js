import { useCallback, useEffect, useRef, useState } from 'react'

// Resultados reales: el scroll solo inicia la secuencia. La primera foto cae
// al verse completa; cuando llega al centro, las demás siguen por tiempo.
// Nunca se fija la página ni se interceptan gestos de rueda, teclado o touch.
const INTERVALO_DENTRO_PAR_MS = 500
const INTERVALO_ENTRE_PARES_MS = 1000
// Cantidad impar: falta el después de ese par. Cantidad par: empieza otro par.
const intervaloSiguiente = (reveladas) => reveladas % 2 === 1 ? INTERVALO_DENTRO_PAR_MS : INTERVALO_ENTRE_PARES_MS

export function useSecuenciaScroll({ activo, reducirMovimiento, totalFotos }) {
  // Con menos de las tres parejas del diseño, o con movimiento reducido,
  // se mantienen todas las fotos visibles como antes.
  const listo = activo && !reducirMovimiento && totalFotos >= 6
  const [visto, setVisto] = useState(listo ? 0 : totalFotos)
  const primeraFotoRef = useRef(null)
  const filaRef = useRef(null)

  useEffect(() => {
    if (!listo) {
      setVisto(totalFotos)
      return undefined
    }
    const foto = primeraFotoRef.current
    const fila = filaRef.current
    if (!foto || !fila) return undefined

    // La foto se transforma al caer. Medir su contenedor mantiene el disparo
    // ligado a la posición de la tarjeta, sin que lo altere la animación.
    const tarjeta = foto.parentElement ?? foto
    let reveladas = 0
    let iniciada = false
    let primeraCaidaEn = null
    let temporizador = null
    let cuadro = null
    setVisto(0)

    function mostrar(cantidad) {
      reveladas = cantidad
      setVisto(cantidad)
      if (cantidad === 1) primeraCaidaEn = performance.now()
    }

    function programar(espera = intervaloSiguiente(reveladas)) {
      if (temporizador !== null || document.hidden || reveladas >= totalFotos) return
      temporizador = setTimeout(() => {
        temporizador = null
        if (document.hidden) return
        mostrar(reveladas + 1)
        programar()
      }, espera)
    }

    function chequear() {
      if (iniciada || document.hidden) return
      const rect = tarjeta.getBoundingClientRect()
      const rectFila = fila.getBoundingClientRect()
      const altoVentana = window.innerHeight

      // Un scroll rápido puede saltarse todo el bloque. No dejar fotos ocultas
      // ni arrancar una cola de animaciones fuera de pantalla en ese caso.
      if (rectFila.bottom <= 0) {
        iniciada = true
        mostrar(totalFotos)
        return
      }
      if (rectFila.top >= altoVentana) return

      const completa = rect.top >= 0 && rect.bottom <= altoVentana
      if (reveladas === 0 && completa) mostrar(1)

      // Detectar también el cruce del centro entre dos eventos de scroll.
      // Importa la primera pareja, no el centro de una grilla alta en móvil.
      if (rect.top + rect.height / 2 <= altoVentana / 2) {
        iniciada = true
        if (reveladas === 0) mostrar(1)
        const transcurrido = performance.now() - primeraCaidaEn
        programar(Math.max(0, intervaloSiguiente(reveladas) - transcurrido))
      }
    }

    function alScroll() {
      if (!iniciada && cuadro === null) {
        cuadro = requestAnimationFrame(() => {
          cuadro = null
          chequear()
        })
      }
    }

    function alVisibilidad() {
      if (document.hidden) {
        clearTimeout(temporizador)
        temporizador = null
      } else if (iniciada) {
        programar()
      } else {
        chequear()
      }
    }

    chequear()
    // Captura los scrolls de contenedores internos del portal. Todos los
    // listeners son pasivos: observar la posición nunca detiene la página.
    document.addEventListener('scroll', alScroll, { capture: true, passive: true })
    window.addEventListener('resize', alScroll, { passive: true })
    document.addEventListener('visibilitychange', alVisibilidad)
    return () => {
      clearTimeout(temporizador)
      if (cuadro !== null) cancelAnimationFrame(cuadro)
      document.removeEventListener('scroll', alScroll, { capture: true })
      window.removeEventListener('resize', alScroll)
      document.removeEventListener('visibilitychange', alVisibilidad)
    }
  }, [listo, totalFotos])

  const estadoFoto = useCallback(
    (indice) => !listo ? '' : indice < visto ? 'cae' : 'espera',
    [listo, visto],
  )
  const claseSacudida = !listo || visto === 0 ? '' : visto % 2 ? 'sacA' : 'sacB'
  const enCurso = listo && visto >= 1 && visto < totalFotos
  const puntos = Array.from({ length: totalFotos }, (_, i) => i < visto)

  return { primeraFotoRef, filaRef, estadoFoto, claseSacudida, enCurso, puntos }
}
