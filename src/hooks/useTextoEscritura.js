import { useEffect, useState } from 'react'
import { usePaginaActiva } from '../context/PaginaActivaContext.jsx'
import { useDocumentoVisible, useMovimientoReducido } from './usePreferenciasMovimiento.js'

// activo=false pausa el ciclo por completo (ej. cuando el placeholder no se
// ve porque el campo ya tiene texto) — evita un setState cada 45ms sin
// ningún efecto visual, que en un componente grande sale caro re-renderizar.
//
// Fase 6: además se pausa cuando NADIE lo ve: la pantalla está oculta en la caché de pestañas (cada pantalla montada con un
// buscador sumaba ~2,5 temporizadores por segundo), la pestaña del navegador está en segundo plano, o la persona pidió
// movimiento reducido (en ese caso se muestra el texto completo, sin escribirlo letra a letra). Al volver, retoma el ciclo.
export function useTextoEscritura(textoCompleto, velocidadMs = 45, pausaMs = 5000, activo = true) {
  const [texto, setTexto] = useState(textoCompleto.slice(0, 1))
  const paginaActiva = usePaginaActiva()
  const documentoVisible = useDocumentoVisible()
  const reducido = useMovimientoReducido()
  const corre = activo && paginaActiva && documentoVisible && !reducido

  useEffect(() => {
    if (!corre) return undefined

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
  }, [textoCompleto, velocidadMs, pausaMs, corre])

  return reducido ? textoCompleto : texto
}
