import { useEffect, useState } from 'react'

// Devuelve `valor` recién después de que pase `esperaMs` sin que cambie —
// para no disparar una consulta a Supabase en cada tecla cuando la búsqueda
// pasa a ser server-side.
export function useDebounce(valor, esperaMs = 300) {
  const [valorDebounced, setValorDebounced] = useState(valor)

  useEffect(() => {
    const temporizador = setTimeout(() => setValorDebounced(valor), esperaMs)
    return () => clearTimeout(temporizador)
  }, [valor, esperaMs])

  return valorDebounced
}
