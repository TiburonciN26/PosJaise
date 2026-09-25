import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePerfilCliente } from '../context/PerfilClienteContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'

// Etiqueta propia (no la Etiqueta.jsx compartida con el POS, que usa
// text-ink/60 — un token atado al switch claro/oscuro global; acá el
// fondo es siempre negro), mismo patrón que el resto de modales de
// cliente (ver ModalReprogramarCitaCliente.jsx).
function EtiquetaCampo({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-white/50">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

// Crear/editar una dirección de delivery (CRUD por tarjeta, ver
// DireccionesCliente.jsx e implementacionesWed.md §7.17/§7.23). CRUD
// directo contra `direcciones_cliente` (sin RPC dedicada, mismo criterio
// que favoritos_servicios) — el trigger unicidad_direccion_predeterminada()
// ya garantiza server-side que solo una quede marcada como
// predeterminada, así que el frontend no necesita coordinar eso a mano.
// "Celular" es del repartidor que llama al llegar, no del login — puede
// ser distinto por dirección (ej. alguien más recibe en la casa de los
// padres), por eso vive en esta tabla y no en el teléfono de Mi Perfil.
export default function ModalDireccionCliente({ direccion, onCerrar, onGuardada }) {
  const { usuario } = useAuth()
  const { perfil } = usePerfilCliente()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const esEdicion = Boolean(direccion)

  const [etiqueta, setEtiqueta] = useState(direccion?.etiqueta ?? '')
  const [direccionTexto, setDireccionTexto] = useState(direccion?.direccion ?? '')
  // Distinto del teléfono de Mi Perfil a propósito (confirmado por el
  // usuario): cada dirección puede tener su propio celular de contacto
  // para la llamada de entrega — por defecto se precarga con el de
  // perfil (nunca lo pisa: solo es el valor inicial de una dirección
  // NUEVA, editar una existente parte de lo que ya tenía guardado esa
  // dirección).
  const [celular, setCelular] = useState(direccion?.celular ?? perfil?.telefono ?? '')
  const [referencia, setReferencia] = useState(direccion?.referencia ?? '')
  const [predeterminada, setPredeterminada] = useState(direccion?.predeterminada ?? false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar(evento) {
    evento.preventDefault()
    setError('')

    if (!etiqueta.trim() || !direccionTexto.trim()) {
      setError('Completa la etiqueta y la dirección.')
      return
    }

    setGuardando(true)
    const datos = {
      etiqueta: etiqueta.trim(),
      direccion: direccionTexto.trim(),
      celular: celular.trim() || null,
      referencia: referencia.trim() || null,
      predeterminada,
    }

    const { error: errorGuardar } = esEdicion
      ? await supabase.from('direcciones_cliente').update(datos).eq('id', direccion.id)
      : await supabase.from('direcciones_cliente').insert({ ...datos, cliente_web_id: usuario.id })

    setGuardando(false)

    if (errorGuardar) {
      setError(errorGuardar.message || 'No se pudo guardar la dirección. Intenta de nuevo.')
      return
    }

    onGuardada()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={panelRef}
        className="lw-bar max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-lg border border-white/10 p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">
            {esEdicion ? 'Editar dirección' : 'Nueva dirección'}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-2 rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={guardar} className="mt-4 space-y-4">
          <div>
            <EtiquetaCampo obligatorio htmlFor="direccion-etiqueta">
              Etiqueta
            </EtiquetaCampo>
            <input
              id="direccion-etiqueta"
              type="text"
              value={etiqueta}
              onChange={(evento) => setEtiqueta(evento.target.value)}
              placeholder="Ej. Casa, Trabajo"
              maxLength={40}
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
            />
          </div>

          <div>
            <EtiquetaCampo obligatorio htmlFor="direccion-texto">
              Dirección
            </EtiquetaCampo>
            <input
              id="direccion-texto"
              type="text"
              value={direccionTexto}
              onChange={(evento) => setDireccionTexto(evento.target.value)}
              placeholder="Calle, número, urbanización"
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
            />
          </div>

          <div>
            <EtiquetaCampo htmlFor="direccion-celular">Celular de contacto</EtiquetaCampo>
            <input
              id="direccion-celular"
              type="text"
              inputMode="tel"
              value={celular}
              onChange={(evento) => setCelular(evento.target.value)}
              placeholder="Para coordinar la entrega"
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
            />
          </div>

          <div>
            <EtiquetaCampo htmlFor="direccion-referencia">Referencia (opcional)</EtiquetaCampo>
            <input
              id="direccion-referencia"
              type="text"
              value={referencia}
              onChange={(evento) => setReferencia(evento.target.value)}
              placeholder="Ej. Frente al parque, puerta verde"
              className="w-full rounded-lg border border-transparent bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white">
            <input
              type="checkbox"
              checked={predeterminada}
              onChange={(evento) => setPredeterminada(evento.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--lw-gold)]"
            />
            Usar como predeterminada
          </label>

          {error && (
            <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
          )}

          <div className="flex gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 rounded-lg border border-[var(--lw-gold)] bg-transparent py-2 text-sm font-semibold text-[var(--lw-gold)] disabled:opacity-40"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
