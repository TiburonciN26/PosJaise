import { useEffect, useState } from 'react'
import { MapPin, Pencil, Phone, Plus, Star, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import ModalDireccionCliente from '../../components/ModalDireccionCliente.jsx'

// "Direcciones" (menú del avatar, anidada bajo Mi Perfil — ver
// implementacionesWed.md §7.22) — el cliente guarda varias direcciones
// de delivery y elige cuál usar en cada compra desde el Carrito (§7.17).
// Cada una lleva su propio celular de contacto (§7.23, distinto del
// teléfono de Mi Perfil) para que el personal llame al momento de la
// entrega. CRUD completo por tarjeta: cada una tiene Editar/Eliminar/
// Hacer predeterminada; "Agregar" abre el mismo modal en modo creación.
// La tabla vive por cliente_web_id (dato de login, como favoritos), no
// por cliente_id — no hace falta que el personal la vea directo acá: el
// pedido ya congela la dirección y el celular elegidos como texto.
export default function DireccionesCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()

  const [direcciones, setDirecciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [direccionEditando, setDireccionEditando] = useState(null)
  const [direccionEliminando, setDireccionEliminando] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  useCerrarConEscape(() => setDireccionEliminando(null), Boolean(direccionEliminando))

  async function cargar() {
    const { data } = await supabase
      .from('direcciones_cliente')
      .select('id, etiqueta, direccion, celular, referencia, predeterminada')
      .order('predeterminada', { ascending: false })
      .order('creado_en', { ascending: true })
    setDirecciones(data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  function abrirNueva() {
    setDireccionEditando(null)
    setModalAbierto(true)
  }

  function abrirEdicion(direccion) {
    setDireccionEditando(direccion)
    setModalAbierto(true)
  }

  function alGuardar() {
    setModalAbierto(false)
    mostrarToast('Dirección guardada.', 'exito')
    cargar()
  }

  async function marcarPredeterminada(direccion) {
    if (direccion.predeterminada) return
    await supabase.from('direcciones_cliente').update({ predeterminada: true }).eq('id', direccion.id)
    cargar()
  }

  async function confirmarEliminar() {
    if (!direccionEliminando) return
    setEliminando(true)
    await supabase
      .from('direcciones_cliente')
      .delete()
      .eq('id', direccionEliminando.id)
      .eq('cliente_web_id', usuario.id)
    setEliminando(false)
    setDireccionEliminando(null)
    mostrarToast('Dirección eliminada.', 'exito')
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={abrirNueva}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--lw-gold)] px-3 py-2 text-sm font-semibold text-black"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>

        {direcciones.length === 0 ? (
          <div className="liquid-glass mt-6 flex flex-col items-center gap-2 rounded-none p-8 text-center">
            <MapPin className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/60">Todavía no tienes direcciones guardadas.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {direcciones.map((direccion) => (
              <div key={direccion.id} className="liquid-glass rounded-none p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{direccion.etiqueta}</p>
                      {direccion.predeterminada && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--lw-gold)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--lw-gold)]">
                          <Star className="h-2.5 w-2.5 fill-current" />
                          Predeterminada
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                      <p className="text-sm text-white/70">{direccion.direccion}</p>
                    </div>
                    {direccion.celular && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-white/40" />
                        <p className="font-mono text-xs text-white/50">{direccion.celular}</p>
                      </div>
                    )}
                    {direccion.referencia && (
                      <p className="mt-1 text-xs text-white/50">{direccion.referencia}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => abrirEdicion(direccion)}
                      aria-label="Editar dirección"
                      className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDireccionEliminando(direccion)}
                      aria-label="Eliminar dirección"
                      className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-red"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {!direccion.predeterminada && (
                  <button
                    type="button"
                    onClick={() => marcarPredeterminada(direccion)}
                    className="mt-3 text-xs font-medium text-white/50 transition-colors hover:text-[var(--lw-gold)]"
                  >
                    Usar como predeterminada
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalAbierto && (
        <ModalDireccionCliente
          direccion={direccionEditando}
          onCerrar={() => setModalAbierto(false)}
          onGuardada={alGuardar}
        />
      )}

      {direccionEliminando && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="lw-bar w-full max-w-sm rounded-lg border border-white/10 p-5">
            <h2 className="text-base font-semibold text-white">¿Eliminar dirección?</h2>
            <p className="mt-1 text-sm text-white/60">
              Se eliminará "{direccionEliminando.etiqueta}". Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDireccionEliminando(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
