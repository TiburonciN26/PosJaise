import { Mic } from 'lucide-react'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import { useToast } from '../context/ToastContext.jsx'

// Micrófono para buscar hablando, al lado derecho de un buscador dentro de un
// modal (en las pantallas lo trae BarraBusqueda). `onTexto` recibe lo
// dictado y debe hacer lo mismo que el onChange del input. No se dibuja en
// navegadores sin reconocimiento de voz.
export default function BotonVoz({ onTexto }) {
  const { mostrarToast } = useToast()
  const {
    soportado,
    escuchando,
    alternar,
    onErrorRef,
  } = useReconocimientoVoz((texto) => onTexto(texto))
  onErrorRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  if (!soportado) return null
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
      className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
        escuchando
          ? 'animate-pulse border-red bg-red/10 text-red'
          : 'border-dashed border-border-strong text-ink/70 hover:border-amber hover:text-amber'
      }`}
    >
      <Mic className="h-4 w-4" />
    </button>
  )
}
