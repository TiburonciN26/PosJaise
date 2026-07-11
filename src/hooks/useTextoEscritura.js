import { useEffect, useState } from 'react'

export function useTextoEscritura(textoCompleto, velocidadMs = 45, pausaMs = 5000) {
  const [texto, setTexto] = useState(textoCompleto.slice(0, 1))

  useEffect(() => {
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
  }, [textoCompleto, velocidadMs, pausaMs])

  return texto
}
