import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const TemaWebContext = createContext(null)

// Preferencia PROPIA del portal cliente, independiente del tema del POS
// (ThemeContext.jsx, clave 'pos-jaise-tema'): el portal es oscuro por
// defecto y solo pasa a claro si la clienta lo elige a mano.
const CLAVE_STORAGE = 'jaise-tema-web'

function temaInicial() {
  try {
    return localStorage.getItem(CLAVE_STORAGE) === 'claro' ? 'claro' : 'oscuro'
  } catch {
    return 'oscuro'
  }
}

export function TemaWebProvider({ children }) {
  const [tema, setTema] = useState(temaInicial)

  const alternarTema = useCallback(() => {
    setTema((anterior) => {
      const siguiente = anterior === 'oscuro' ? 'claro' : 'oscuro'
      try {
        localStorage.setItem(CLAVE_STORAGE, siguiente)
      } catch {
        // sin storage: el cambio vale solo para esta sesión
      }
      return siguiente
    })
  }, [])

  const value = useMemo(() => ({ tema, alternarTema }), [tema, alternarTema])

  return <TemaWebContext.Provider value={value}>{children}</TemaWebContext.Provider>
}

export function useTemaWeb() {
  const context = useContext(TemaWebContext)
  if (!context) {
    throw new Error('useTemaWeb debe usarse dentro de un TemaWebProvider')
  }
  return context
}
