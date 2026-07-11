import { useEffect, useState } from 'react'

// activo=false pausa el ciclo por completo (ej. cuando el placeholder no se
// ve porque el campo ya tiene texto) — evita un setState cada 45ms sin
// ningún efecto visual, que en un componente grande sale caro re-renderizar.
export function useTextoEscritura(textoCompleto, velocidadMs = 45, pausaMs = 5000, activo = true) {
  const [texto, setTexto] = useState(textoCompleto.slice(0, 1))

  useEffect(() => {
    if (!activo) return undefined

    let indice = 1
    let cancelado = false
    let temporizador

    function escribir() {
      if (cancelado) return
      if (indice <= textoCompleto.length) {
        setTexto(textoCompleto.slice(0, indice))
        indice += 1
        temporizador = setTimeout(escribir, velocidadMs)
      } else {
        temporizador = setTimeout(() => {
          indice = 1
          setTexto(textoCompleto.slice(0, 1))
          temporizador = setTimeout(escribir, velocidadMs)
        }, pausaMs)
      }
    }

    temporizador = setTimeout(escribir, velocidadMs)
    return () => {
      cancelado = true
      clearTimeout(temporizador)
    }
  }, [textoCompleto, velocidadMs, pausaMs, activo])

  return texto
}
