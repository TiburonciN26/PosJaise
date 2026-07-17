import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

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

  useEffect(() => {
    document.documentElement.dataset.tema = tema
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', COLOR_BARRA_NAVEGADOR[tema])
  }, [tema])

  useEffect(() => {
    return () => clearTimeout(temporizadorTransicionRef.current)
  }, [])

  const alternarTema = useCallback(() => {
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
