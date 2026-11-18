import { useRef, useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useProveedores } from '../hooks/useProveedores.js'
import BarraBusqueda from './BarraBusqueda.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import EstadoVacio from './EstadoVacio.jsx'
import ModalProveedor from './ModalProveedor.jsx'

function coincide(proveedor, termino) {
  return [proveedor.nombre, proveedor.rubro, proveedor.contacto_nombre, proveedor.ruc, proveedor.celular].some((valor) =>
    String(valor ?? '').toLowerCase().includes(termino),
  )
}

// Buscador de la tabla de proveedores (solo administradora) para vincular uno a un producto. No ofrece los inactivos ni
// los que ya están vinculados (`excluirIds`). «+ Nuevo proveedor» crea uno y lo devuelve ya elegido.
export default function ModalBuscarProveedor({ excluirIds = [], onSeleccionar, onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)
  const { lista, cargado } = useProveedores()
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)

  const excluidos = new Set(excluirIds)
  const termino = busqueda.trim().toLowerCase()
  const disponibles = lista.filter((p) => p.activo && !excluidos.has(p.id) && (!termino || coincide(p, termino)))

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <div ref={panelRef} className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <h2 className="text-base font-semibold text-ink">Agregar proveedor</h2>
          <BotonCerrarModal onClick={onCerrar} />
        </div>

        <div className="flex items-center gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <BarraBusqueda
            valor={busqueda}
            onCambiar={setBusqueda}
            placeholder="Buscar por nombre, rubro, RUC o celular..."
            tema="amber"
            sinBorde
            sinVoz
          />
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cargado ? (
            <p role="status" className="p-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : disponibles.length === 0 ? (
            <EstadoVacio
              icono={Truck}
              mensaje={termino ? 'Ningún proveedor coincide con la búsqueda.' : 'No hay más proveedores para agregar.'}
              accion={{ label: '+ Nuevo proveedor', onClick: () => setCreando(true) }}
            />
          ) : (
            <ul className="divide-y divide-border">
              {disponibles.map((proveedor) => (
                <li key={proveedor.id}>
                  <button
                    type="button"
                    onClick={() => onSeleccionar(proveedor)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{proveedor.nombre}</p>
                      <p className="truncate text-xs text-ink/50">
                        {[proveedor.rubro, proveedor.contacto_nombre, proveedor.celular].filter(Boolean).join(' · ') ||
                          'Sin datos adicionales'}
                      </p>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {creando && (
        <ModalProveedor
          nombreInicial={busqueda}
          onCerrar={() => setCreando(false)}
          onGuardado={(fila) => {
            setCreando(false)
            onSeleccionar(fila)
          }}
        />
      )}
    </div>
  )
}
