import { useEffect, useRef, useState } from 'react'

export function useReconocimientoVoz(onResultado) {
  const [soportado] = useState(
    () => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  )
  const [escuchando, setEscuchando] = useState(false)
  const reconocimientoRef = useRef(null)
  const onResultadoRef = useRef(onResultado)
  const onErrorRef = useRef(null)

  useEffect(() => {
    onResultadoRef.current = onResultado
  }, [onResultado])

  useEffect(() => {
    if (!soportado) return undefined

    const ConstructorReconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition
    const reconocimiento = new ConstructorReconocimiento()
    reconocimiento.lang = 'es-PE'
    reconocimiento.continuous = false
    reconocimiento.interimResults = true

    reconocimiento.onstart = () => setEscuchando(true)
    reconocimiento.onend = () => setEscuchando(false)
    reconocimiento.onerror = (evento) => {
      setEscuchando(false)
      onErrorRef.current?.(evento.error)
    }
    reconocimiento.onresult = (evento) => {
      onResultadoRef.current(evento.results[0][0].transcript)
    }

    reconocimientoRef.current = reconocimiento
    return () => {
      reconocimiento.onstart = null
      reconocimiento.onend = null
      reconocimiento.onerror = null
      reconocimiento.onresult = null
      reconocimiento.abort()
    }
  }, [soportado])

  function alternar() {
    if (!reconocimientoRef.current) return
    if (escuchando) {
      reconocimientoRef.current.stop()
      return
    }
    try {
      reconocimientoRef.current.start()
    } catch {
      // start() lanza si ya hay un reconocimiento en curso; se ignora.
    }
  }

  return { soportado, escuchando, alternar, onErrorRef }
}
