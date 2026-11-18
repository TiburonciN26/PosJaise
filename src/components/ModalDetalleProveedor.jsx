import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useToast } from '../context/ToastContext.jsx'
import { COLUMNAS_PROVEEDOR, enlaceWhatsapp } from '../lib/proveedores.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import DatosProveedor from './DatosProveedor.jsx'
import ModalProveedor from './ModalProveedor.jsx'
import ModalEliminarProveedor from './ModalEliminarProveedor.jsx'

// Ficha de un proveedor en un modal (se abre desde el historial de stock y el desplegable del producto, sin salir de la
// pantalla). Editar / Eliminar / Cancelar. `onCambio` avisa a quien lo abrió que el proveedor cambió (para refrescar).
export default function ModalDetalleProveedor({ proveedorId, onCerrar, onCambio }) {
  const panelRef = useRef(null)
  const { mostrarToast } = useToast()
  const [proveedor, setProveedor] = useState(null)
  const [estado, setEstado] = useState('cargando') // 'cargando' | 'listo' | 'error'
  const [intento, setIntento] = useState(0)
  const [editando, setEditando] = useState(false)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)

  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  useEffect(() => {
    let vigente = true
    supabase
      .from('proveedores')
      .select(COLUMNAS_PROVEEDOR)
      .eq('id', proveedorId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vigente) return
        if (error || !data) {
          setEstado('error')
          return
        }
        setProveedor(data)
        setEstado('listo')
      })
    return () => {
      vigente = false
    }
  }, [proveedorId, intento])

  const whatsapp = enlaceWhatsapp(proveedor?.celular)

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <div ref={panelRef} className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-border bg-surface">
        <div className="flex items-start justify-between gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{proveedor?.nombre ?? 'Proveedor'}</h2>
            {proveedor && !proveedor.activo && (
              <span className="mt-0.5 inline-block rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-ink/60">
                Inactivo
              </span>
            )}
          </div>
          <BotonCerrarModal onClick={onCerrar} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          {estado === 'cargando' ? (
            <p role="status" className="py-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : estado === 'error' ? (
            <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm text-red">No se pudo cargar el proveedor.</p>
              <button
                type="button"
                onClick={() => {
                  setEstado('cargando')
                  setIntento((n) => n + 1)
                }}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <>
              {whatsapp && (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-green/50 py-2 text-sm font-medium text-green transition-colors hover:bg-green/10"
                >
                  <MessageCircle className="h-4 w-4" />
                  Escribir por WhatsApp
                </a>
              )}
              <DatosProveedor proveedor={proveedor} />
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <button
            type="button"
            onClick={() => setEditando(true)}
            disabled={estado !== 'listo'}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong py-2 text-sm text-blue transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
          <button
            type="button"
            onClick={() => setConfirmandoEliminar(true)}
            disabled={estado !== 'listo'}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong py-2 text-sm text-red transition-colors hover:bg-red/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </button>
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Cancelar
          </button>
        </div>
      </div>

      {editando && proveedor && (
        <ModalProveedor
          proveedor={proveedor}
          onCerrar={() => setEditando(false)}
          onGuardado={(fila) => {
            setEditando(false)
            setProveedor(fila)
            mostrarToast('Proveedor actualizado.', 'exito')
            onCambio?.()
          }}
        />
      )}

      {confirmandoEliminar && proveedor && (
        <ModalEliminarProveedor
          proveedor={proveedor}
          onCerrar={() => setConfirmandoEliminar(false)}
          onEliminado={() => {
            setConfirmandoEliminar(false)
            onCambio?.()
            onCerrar()
          }}
        />
      )}
    </div>
  )
}
