import { useId, useRef, useState } from 'react'
import { MessageSquareWarning } from 'lucide-react'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import Etiqueta from './Etiqueta.jsx'

// «Iniciar discrepancia» (Mis atenciones, solo la administradora): antes de abrirla escribe el MOTIVO. La persona que atendió ve
// esa nota en su atención para llegar a la conversación sabiendo de qué se trata (migración 20261124000008: motivo, máx. 300).
// `onConfirmar(motivo)` devuelve una promesa (true si se guardó): mientras tanto el modal queda bloqueado.
export const MAX_MOTIVO_DISCREPANCIA = 300

export default function ModalMotivoDiscrepancia({ nombreDuena, onConfirmar, onCerrar }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  const cambios = motivo.trim() ? ['Motivo escrito'] : []
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: enviando })

  async function enviar(evento) {
    evento.preventDefault()
    if (!motivo.trim()) {
      setError('Escribe el motivo para que la otra persona sepa de qué se trata.')
      return
    }
    setEnviando(true)
    setError(null)
    const guardado = await onConfirmar(motivo.trim())
    // Si se guardó, el padre desmonta el modal; si falló, el aviso ya salió como toast y se puede reintentar.
    if (!guardado) setEnviando(false)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        ref={panelRef}
        onSubmit={enviar}
        autoComplete="off"
        style={{ '--color-foco': 'var(--color-blue)' }}
        className="w-full max-w-md rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <MessageSquareWarning className="h-4 w-4 text-blue" />
            Iniciar discrepancia
          </h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={enviando} />
        </div>

        <p className="mt-2 text-sm text-ink/70">
          {nombreDuena ? `${nombreDuena} verá` : 'Quien atendió verá'} esta nota en su atención y en el aviso de su panel. No bloquea
          nada: se cierra cuando las dos partes confirman el acuerdo.
        </p>

        <div className="mt-3">
          <Etiqueta obligatorio htmlFor={`${idBase}-motivo`}>¿Por qué se inicia la discrepancia?</Etiqueta>
          <textarea
            id={`${idBase}-motivo`}
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value.slice(0, MAX_MOTIVO_DISCREPANCIA))
              setError(null)
            }}
            rows={4}
            autoFocus
            placeholder="Ej. El precio no coincide con lo que se cobró, o la clienta es otra."
            className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-blue"
          />
          <p className="mt-0.5 text-right font-mono text-[11px] text-ink/50">
            {motivo.length}/{MAX_MOTIVO_DISCREPANCIA}
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={enviando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-blue hover:text-blue disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="flex-1 rounded-lg bg-blue py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {enviando ? 'Iniciando...' : 'Iniciar discrepancia'}
          </button>
        </div>
      </form>
      {aviso}
    </div>
  )
}
