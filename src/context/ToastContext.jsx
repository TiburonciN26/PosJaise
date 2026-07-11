import { createContext, useCallback, useContext, useRef, useState } from 'react'

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

  return (
    <ToastContext.Provider value={{ mostrarToast }}>
      {children}

      {toast && (
        <div
          className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-300 ease-in-out ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className={`rounded-lg border px-4 py-2.5 text-sm shadow-lg ${CLASES_TIPO[toast.tipo]}`}
          >
            {toast.texto}
          </div>
        </div>
      )}
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
