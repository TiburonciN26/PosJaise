// Fase 6: bucle de animación (requestAnimationFrame) que SOLO corre cuando alguien puede verlo.
//   crearBucle(elemento, tick) → { querer(booleano), destruir() }
//   · tick(t, dt) recibe los segundos acumulados MIENTRAS corre (el tiempo no salta al reanudar) y el delta (acotado a 100 ms).
//     Si devuelve false, el bucle se duerme solo (p. ej. al llegar al reposo); `querer(true)` lo vuelve a despertar.
//   · corre únicamente si se «quiere» Y el elemento intersecta la ventana (IntersectionObserver) Y la pestaña del navegador está
//     visible. Fuera de eso no hay ningún rAF pendiente (sin trabajo de estilos ni de pintura).
//   · destruir() cancela el rAF y suelta los observadores.
export function crearBucle(elemento, tick) {
  let enPantalla = true
  let quiere = false
  let raf = 0
  let ultimo = 0
  let t = 0

  function paso(ahora) {
    raf = 0
    const dt = Math.min(0.1, (ahora - ultimo) / 1000)
    ultimo = ahora
    t += dt
    if (tick(t, dt) === false) {
      quiere = false
      return
    }
    raf = requestAnimationFrame(paso)
  }

  function evaluar() {
    const debeCorrer = quiere && enPantalla && !document.hidden
    if (debeCorrer && !raf) {
      ultimo = performance.now()
      raf = requestAnimationFrame(paso)
    } else if (!debeCorrer && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  const observador =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entradas) => {
          enPantalla = entradas[entradas.length - 1].isIntersecting
          evaluar()
        })
  observador?.observe(elemento)
  document.addEventListener('visibilitychange', evaluar)

  return {
    querer(valor) {
      quiere = valor
      evaluar()
    },
    destruir() {
      quiere = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      observador?.disconnect()
      document.removeEventListener('visibilitychange', evaluar)
    },
  }
}
