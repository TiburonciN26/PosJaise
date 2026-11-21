import { Plus, Star, X } from 'lucide-react'
import DatosProveedor from './DatosProveedor.jsx'

// Proveedores de un producto dentro de su modal (modo POS). Ya no se escribe un nombre: «Agregar proveedor» abre el
// buscador de la tabla de proveedores. Cada vinculado muestra solo los datos que tiene escritos, con la estrella para
// marcar el principal y la X para quitarlo. `vinculos` = [{ proveedor, principal }]; los cambios se guardan junto con el
// producto (vincular_proveedores_producto). El buscador («Agregar proveedor», con «+ Nuevo proveedor» dentro) NO se monta aquí:
// esta sección está dentro del <form> del producto y un <form> dentro de otro no es válido — el envío de «Nuevo proveedor»
// lo hacía el navegador (recargaba la página y se perdía todo). ModalProducto lo monta FUERA del form; aquí solo se pide abrirlo.
export default function SeccionProveedoresProducto({ vinculos, onCambiar, onAgregar, onQuitar, estado = 'listo' }) {

  function marcarPrincipal(id) {
    onCambiar(vinculos.map((v) => ({ ...v, principal: v.proveedor.id === id })))
  }

  return (
    <div>
      <p className="mb-1 block text-xs text-ink/60">Proveedores</p>

      {estado === 'cargando' ? (
        <p className="font-mono text-xs text-ink/50">Cargando proveedores...</p>
      ) : estado === 'error' ? (
        <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          No se pudieron cargar los proveedores de este producto. Puedes guardar el resto sin tocarlos.
        </p>
      ) : (
        <div className="space-y-2">
          {vinculos.map(({ proveedor, principal }) => (
            <div key={proveedor.id} className="rounded-lg border border-border bg-surface-2/50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-ink">
                  {proveedor.nombre}
                  {!proveedor.activo && <span className="ml-1.5 text-[11px] font-normal text-ink/50">(inactivo)</span>}
                </p>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => marcarPrincipal(proveedor.id)}
                    aria-pressed={principal}
                    aria-label={principal ? 'Proveedor principal' : 'Marcar como proveedor principal'}
                    title={principal ? 'Proveedor principal' : 'Marcar como principal'}
                    className={`rounded-lg p-1.5 transition-colors ${principal ? 'text-amber' : 'text-ink/40 hover:text-amber'}`}
                  >
                    <Star className="h-4 w-4" fill={principal ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuitar(proveedor)}
                    aria-label={`Quitar a ${proveedor.nombre} de este producto`}
                    className="rounded-lg p-1.5 text-ink/50 transition-colors hover:text-red"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-1">
                <DatosProveedor proveedor={proveedor} compacto />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={onAgregar}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-2 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber"
          >
            <Plus className="h-4 w-4" />
            Agregar proveedor
          </button>
        </div>
      )}
    </div>
  )
}
