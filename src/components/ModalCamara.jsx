import { useEffect, useRef, useState } from 'react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'

// Cámara integrada en la propia página (getUserMedia + <video> en vivo),
// en vez de <input type="file" capture>. El input con "capture" abre la
// app de cámara nativa del sistema, lo que manda la pestaña a segundo
// plano — en varios celulares Android, el sistema operativo aprovecha
// para liberar memoria y descarta la pestaña, así que al volver de la
// cámara el navegador la recarga entera desde cero (se pierde el modal,
// el formulario, todo). Con getUserMedia la app nunca pierde el foco: la
// cámara se ve dentro de este mismo modal.
export default function ModalCamara({ onCapturar, onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef, true, 'Tomar foto con la cámara')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [listo, setListo] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no soporta la cámara integrada. Usa "Elegir foto".')
      return undefined
    }

    let cancelado = false

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((pista) => pista.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setListo(true)
      })
      .catch(() => {
        if (!cancelado) {
          setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.')
        }
      })

    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((pista) => pista.stop())
    }
  }, [])

  function capturar() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapturar(blob)
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <div ref={panelRef} className="fixed inset-0 z-40 flex flex-col bg-black">
      <div className="flex shrink-0 items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={onCerrar}
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-xs text-ink transition-colors hover:border-amber hover:text-amber"
        >
          Cancelar
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {error ? (
          <p className="px-6 text-center text-sm text-ink/70">{error}</p>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
        )}
      </div>

      {!error && (
        <div className="flex shrink-0 items-center justify-center p-6">
          <button
            type="button"
            onClick={capturar}
            disabled={!listo}
            aria-label="Tomar foto"
            title="Tomar foto"
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 disabled:opacity-40"
          >
            <span className="h-12 w-12 rounded-full bg-white" />
          </button>
        </div>
      )}
    </div>
  )
}
