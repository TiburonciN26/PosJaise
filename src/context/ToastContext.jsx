import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

const DURACION_VISIBLE = 3000
const DURACION_TRANSICION = 300

const CLASES_TIPO = {
  exito: 'border-green/40 bg-surface text-green',
  info: 'border-amber/40 bg-surface text-amber',
  error: 'border-red/40 bg-surface text-red',
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const [visible, setVisible] = useState(false)
  const temporizadorOcultarRef = useRef(null)
  const temporizadorQuitarRef = useRef(null)

  const mostrarToast = useCallback((texto, tipo = 'exito') => {
    clearTimeout(temporizadorOcultarRef.current)
    clearTimeout(temporizadorQuitarRef.current)

    setToast({ texto, tipo })
    setVisible(false)
    // Doble rAF: garantiza que el navegador pinte el estado oculto
    // antes de pasar a visible, para que la transición sí se vea.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })

    temporizadorOcultarRef.current = setTimeout(() => {
      setVisible(false)
      temporizadorQuitarRef.current = setTimeout(() => setToast(null), DURACION_TRANSICION)
    }, DURACION_VISIBLE)
  }, [])

  // Memoizado: sin esto, cada toast que se muestra/oculta (setToast/setVisible
  // dispara un re-render del provider) crearía un value nuevo y re-renderizaría
  // a TODOS los consumidores de useToast — que con el keep-alive de pestañas
  // son casi todas las páginas montadas. mostrarToast ya es estable (useCallback),
  // así que el value no cambia entre esos re-renders (M5 de la 3ª auditoría).
  const value = useMemo(() => ({ mostrarToast }), [mostrarToast])

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* C4 de la auditoría frontend (WCAG 4.1.3): el contenedor con
          role="status" vive SIEMPRE montado (no junto con el toast) —
          una región aria-live anuncia CAMBIOS de contenido, así que si
          se monta recién cuando aparece el toast, el lector de pantalla
          se pierde el primer mensaje. aria-live="polite": anuncia sin
          interrumpir lo que el lector esté leyendo. */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-300 ease-in-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {toast && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-sm shadow-lg ${CLASES_TIPO[toast.tipo]}`}
          >
            {toast.texto}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast debe usarse dentro de un ToastProvider')
  }
  return context
}
