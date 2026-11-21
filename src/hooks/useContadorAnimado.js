import { useEffect, useRef, useState } from 'react'

// Número que «rueda» hasta su nuevo valor (Total de Ventas). Respeta prefers-reduced-motion: salta directo al valor.
// Movido sin cambios desde pages/Ventas.jsx (auditoría 2026-11-20, hallazgo 1.1).
export function useContadorAnimado(valorObjetivo, duracionMs = 350) {
  const [valorMostrado, setValorMostrado] = useState(valorObjetivo)
  const valorAnteriorRef = useRef(valorObjetivo)

  useEffect(() => {
    const inicio = valorAnteriorRef.current
    const fin = valorObjetivo

    if (inicio === fin) return undefined

    const prefiereMovimientoReducido = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (prefiereMovimientoReducido) {
      valorAnteriorRef.current = fin
      setValorMostrado(fin)
      return undefined
    }

    const inicioTiempo = performance.now()
    let frame

    function animar(ahora) {
      const progreso = Math.min((ahora - inicioTiempo) / duracionMs, 1)
      setValorMostrado(inicio + (fin - inicio) * progreso)
      if (progreso < 1) {
        frame = requestAnimationFrame(animar)
      } else {
        valorAnteriorRef.current = fin
      }
    }

    frame = requestAnimationFrame(animar)
    return () => cancelAnimationFrame(frame)
  }, [valorObjetivo, duracionMs])

  return valorMostrado
}
