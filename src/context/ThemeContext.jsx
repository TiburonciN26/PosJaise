import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const ThemeContext = createContext(null)

// Misma clave que el script bloqueante en index.html (evita el parpadeo del
// tema incorrecto al cargar) — si se cambia acá, cambiar también allá.
const CLAVE_STORAGE = 'pos-jaise-tema'

const COLOR_BARRA_NAVEGADOR = { oscuro: '#0d0d0d', claro: '#f5f4f1' }

function temaDelSistema() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro'
}

// Sin preferencia guardada todavía, se deriva del sistema en cada carga (no
// se persiste acá) — así, mientras el usuario nunca haya elegido a mano,
// la app sigue al tema del SO aunque este cambie entre sesiones. Recién
// alternarTema() escribe en localStorage, y desde ahí esa elección manda
// siempre por sobre el sistema.
function temaInicial() {
  const guardado = localStorage.getItem(CLAVE_STORAGE)
  return guardado === 'claro' || guardado === 'oscuro' ? guardado : temaDelSistema()
}

export function ThemeProvider({ children }) {
  const [tema, setTema] = useState(temaInicial)
  const temporizadorTransicionRef = useRef(null)
  // Tema DESEADO: se actualiza en el mismo instante de cada activación (no
  // cuando React termina de pintar), para que dos activaciones seguidas partan
  // cada una del resultado de la anterior (QA-086). `pendientesRef` cuenta las
  // View Transitions aún sin terminar; mientras haya alguna, el efecto no pisa
  // el valor deseado con un estado intermedio.
  const temaRef = useRef(tema)
  const pendientesRef = useRef(0)

  useEffect(() => {
    if (pendientesRef.current === 0) temaRef.current = tema
    document.documentElement.dataset.tema = tema
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', COLOR_BARRA_NAVEGADOR[tema])
  }, [tema])

  useEffect(() => {
    return () => clearTimeout(temporizadorTransicionRef.current)
  }, [])

  const alternarTema = useCallback(() => {
    // Preferido: View Transitions (fundido de la página completa). Con el
    // fundido por elemento de abajo, Chrome anima background-color en el
    // compositor pero border-color/color en el hilo principal, que se atasca
    // al recalcular estilos de toda la pantalla: durante ~100 ms los fondos ya
    // van a medio camino y los bordes/textos siguen en el color viejo
    // (bordes negros o blancos). Con View Transitions no hay animación por
    // elemento: se cruza una captura del tema viejo con el nuevo ya aplicado.
    if (
      typeof document.startViewTransition === 'function' &&
      window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    ) {
      const siguiente = temaRef.current === 'oscuro' ? 'claro' : 'oscuro'
      temaRef.current = siguiente
      pendientesRef.current += 1
      const transicion = document.startViewTransition(() => {
        localStorage.setItem(CLAVE_STORAGE, siguiente)
        document.documentElement.dataset.tema = siguiente
        flushSync(() => setTema(siguiente))
      })
      // Una activación rápida salta la transición anterior (el navegador la
      // rechaza con «Transition was skipped»): el callback igual corre y el
      // tema final es el último pedido. Los rechazos se absorben para no
      // dejar promesas sin manejar.
      transicion.ready.catch(() => {})
      transicion.updateCallbackDone.catch(() => {})
      transicion.finished
        .catch(() => {})
        .finally(() => {
          pendientesRef.current -= 1
        })
      return
    }

    // Fundido suave al cambiar de tema: se agrega .cambiando-tema al
    // <html> AHORA, de forma síncrona en el handler, para que ya esté
    // pintada (con los colores viejos + la transición activa) cuando el
    // useEffect de arriba cambie data-tema y dispare el fundido de
    // TODAS las variables de color a la vez. Se quita a los 500ms
    // (> los 350ms de la transición) para no dejar una transición
    // global permanente — esa animaría por accidente cualquier otro
    // cambio de color de la app y hacía saltar/parpadear cosas. Se
    // respeta prefers-reduced-motion: si el usuario lo pide, no se
    // agrega la clase y el cambio es instantáneo.
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      const root = document.documentElement
      root.classList.add('cambiando-tema')
      clearTimeout(temporizadorTransicionRef.current)
      temporizadorTransicionRef.current = setTimeout(() => {
        root.classList.remove('cambiando-tema')
      }, 500)
    }

    temaRef.current = temaRef.current === 'oscuro' ? 'claro' : 'oscuro'
    setTema((anterior) => {
      const siguiente = anterior === 'oscuro' ? 'claro' : 'oscuro'
      localStorage.setItem(CLAVE_STORAGE, siguiente)
      return siguiente
    })
  }, [])

  const value = useMemo(() => ({ tema, alternarTema }), [tema, alternarTema])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme debe usarse dentro de un ThemeProvider')
  }
  return context
}
