import { Barcode, ImagePlus, Pencil, Printer, Trash2, ZoomIn } from 'lucide-react'
import BotonAccion from './BotonAccion.jsx'
import HistorialStockProducto from './HistorialStockProducto.jsx'
import ProveedoresDelProducto from './ProveedoresDelProducto.jsx'

// Detalle de un producto de Inventario dentro de su fila/tarjeta desplegable (reemplaza al modal de detalle). Lo comparten
// las tarjetas del móvil y la fila desplegable de la tabla de escritorio.
//   · Columna izquierda: la foto (miniatura en móvil) y, centrados debajo, [código de barras][código][impresora].
//   · Columna derecha: PROVEEDORES. En escritorio también el historial de stock, debajo; en móvil el historial pasa abajo, a
//     todo el ancho de la tarjeta (la columna derecha es angosta).
// La «Venta» no se repite (está en el encabezado); costo y ganancia tampoco en escritorio (columnas de la tabla). En móvil el
// encabezado no los trae, así que ahí sí se muestran (solo admin).
const formatearNumero = (monto) => monto.toFixed(2)

export default function DetalleDesplegableProducto({
  producto,
  esAdmin,
  urlFoto,
  versionProveedores,
  onVerFoto,
  onImprimir,
  onCambioProveedor,
  onEditar,
  onEliminar,
  onCambiarFoto,
  subiendoFoto = false,
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-4">
      {/* Solo móvil y solo admin: fila completa arriba de la foto y los proveedores — costo y ganancia en el extremo izquierdo,
          Editar/Eliminar en el derecho. En escritorio costo/ganancia son columnas de la tabla y Editar/Eliminar están en Acciones. */}
      {esAdmin && (
        <div className="col-span-2 flex items-center justify-between gap-3 lg:hidden">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-sm text-ink/70">
            <span>
              Costo <span className="text-ink/60">{formatearNumero(producto.costo ?? 0)}</span>
            </span>
            <span>
              Gananc. <span className="text-green">{formatearNumero(producto.precio - (producto.costo ?? 0))}</span>
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={() => onEditar(producto)} />
            <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={() => onEliminar(producto)} />
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5 lg:row-span-2">
        {/* Foto: tocarla la amplía; el lápiz (solo admin) abre el selector para CAMBIARLA. Es la misma foto que se edita en
            Web → Catálogo (productos.foto_url), así que el cambio se ve en los dos sitios. */}
        <div className="relative h-24 w-24 shrink-0 lg:h-40 lg:w-full">
          {urlFoto ? (
            <button
              type="button"
              onClick={() => onVerFoto(urlFoto, producto.nombre)}
              aria-label={`Ver foto de ${producto.nombre}`}
              className="relative block h-full w-full rounded-lg"
            >
              <div className="foto-borde-luz h-full w-full rounded-lg">
                <div className="h-full w-full overflow-hidden rounded-[6px] bg-surface-2">
                  <img src={urlFoto} alt={producto.nombre} className="h-full w-full object-cover" />
                </div>
              </div>
              <span className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-white lg:bottom-1.5 lg:right-1.5 lg:p-1.5">
                <ZoomIn className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
              <ImagePlus className="h-6 w-6 text-ink/40 lg:h-8 lg:w-8" aria-hidden="true" />
            </div>
          )}

          {esAdmin && onCambiarFoto && (
            <label
              title={urlFoto ? 'Cambiar foto' : 'Agregar foto'}
              className={`absolute right-1 top-1 flex cursor-pointer items-center justify-center rounded-full bg-black/60 p-1.5 text-white transition-colors hover:bg-amber hover:text-bg lg:right-1.5 lg:top-1.5 ${
                subiendoFoto ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <Pencil className="h-3 w-3 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
              <span className="sr-only">{urlFoto ? 'Cambiar foto' : 'Agregar foto'}</span>
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                disabled={subiendoFoto}
                className="hidden"
                onChange={(evento) => {
                  const archivo = evento.target.files?.[0]
                  evento.target.value = ''
                  if (archivo) onCambiarFoto(producto, archivo)
                }}
              />
            </label>
          )}

          {subiendoFoto && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-[11px] font-medium text-white" role="status">
              Subiendo...
            </div>
          )}
        </div>

        {/* [ícono] código [impresora], centrado bajo la foto */}
        <div className="flex max-w-full items-center justify-center gap-1.5">
          <Barcode className="h-4 w-4 shrink-0 text-ink/60" aria-hidden="true" />
          <span className="break-all font-mono text-xs text-ink/60">{producto.codigo_barras || 'Sin código'}</span>
          {producto.codigo_barras && (
            <BotonAccion
              plano
              sinBorde
              icono={Printer}
              texto="Imprimir etiqueta"
              color="celeste"
              onClick={() => onImprimir(producto)}
            />
          )}
        </div>

        {/* En escritorio la categoría ya está en la cabecera de la tabla. */}
        {producto.categoria && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/60 lg:hidden">{producto.categoria}</span>
        )}
      </div>

      <div className="min-w-0">
        <ProveedoresDelProducto
          key={`prov-${producto.id}-${versionProveedores}`}
          producto={producto}
          esAdmin={esAdmin}
          onCambio={onCambioProveedor}
        />
      </div>

      <div className="col-span-2 min-w-0 lg:col-span-1 lg:col-start-2">
        <HistorialStockProducto
          key={`${producto.id}-${producto.stock_actual}-${versionProveedores}`}
          productoId={producto.id}
          esAdmin={esAdmin}
          proveedorHabitualId={producto.proveedor_id}
        />
      </div>
    </div>
  )
}
