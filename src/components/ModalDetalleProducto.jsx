import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ImageOff, Pencil, Plus, Trash2, ZoomIn } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { formatearSoles } from '../lib/moneda.js'
import BotonAccion from './BotonAccion.jsx'
import ModalVisorFoto from './ModalVisorFoto.jsx'

const BUCKET_FOTOS = 'fotos-productos'

function formatearFechaHoraCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'America/Lima',
  }).format(fecha)
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
}

// En móvil, este modal reemplaza los botones de Editar/Eliminar que la
// tarjeta de producto tenía inline (quedan acá para no saturar la
// tarjeta) — "Agregar stock" en cambio sigue disponible en la tarjeta Y
// acá, porque cualquier rol lo usa seguido. En escritorio la tabla
// conserva su columna de Acciones tal cual, y este modal se abre además
// como vista de solo lectura (foto; el historial de stock es admin-only,
// igual que Editar/Eliminar) al hacer clic en la fila.
export default function ModalDetalleProducto({
  producto,
  esAdmin,
  mostrarAcciones,
  onCerrar,
  onEditar,
  onEliminar,
  onAgregarStock,
}) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(esAdmin)
  const [error, setError] = useState(null)
  const [fotoExpandida, setFotoExpandida] = useState(false)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    if (!esAdmin) return

    let vigente = true
    setCargando(true)
    setError(null)

    supabase
      .rpc('historial_stock_producto', { p_producto_id: producto.id })
      .then(({ data, error: errorRpc }) => {
        if (!vigente) return
        if (errorRpc) {
          setError('No se pudo cargar el historial de stock.')
        } else {
          setHistorial(data ?? [])
        }
        setCargando(false)
      })

    return () => {
      vigente = false
    }
  }, [producto.id, esAdmin])

  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)

  return (
    <div onClick={onCerrar} className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      {/* flex-col + footer shrink-0: con muchos movimientos de stock, el
          contenido del medio scrollea pero las acciones y "Cerrar" quedan
          siempre visibles abajo, en vez de que la lista los empuje fuera
          de la pantalla. */}
      <div
        ref={panelRef}
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-lg border border-border bg-surface"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {urlFoto ? (
            <button
              type="button"
              onClick={() => setFotoExpandida(true)}
              className="relative block h-48 w-full rounded-lg"
            >
              <div className="foto-borde-luz h-full w-full rounded-lg">
                <div className="h-full w-full overflow-hidden rounded-[6px] bg-surface-2">
                  <img
                    src={urlFoto}
                    alt={producto.nombre}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white">
                <ZoomIn className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
              <ImageOff className="h-10 w-10 text-ink/40" />
            </div>
          )}

          <h2 className="mt-4 text-base font-semibold text-ink">{producto.nombre}</h2>
          <p className="font-mono text-xs text-ink/60">
            {producto.codigo_barras || 'Sin código'}
            {producto.categoria ? ` · ${producto.categoria}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-ink/70">
            <span>
              Venta <span className="text-amber">{formatearSoles(producto.precio)}</span>
            </span>
            <span>
              Stock <span className="text-ink">{producto.stock_actual}</span>
            </span>
          </div>

          {esAdmin && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">
                Historial de stock
              </h3>

              {cargando ? (
                <p className="mt-2 text-center font-mono text-xs text-ink/60">Cargando...</p>
              ) : error ? (
                <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                  {error}
                </p>
              ) : historial.length === 0 ? (
                <p className="mt-2 text-center font-mono text-xs text-ink/60">
                  Sin movimientos de stock todavía.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {historial.map((mov, indice) => (
                    <li
                      key={`${mov.fecha}-${indice}`}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-sm">
                        <span className="flex items-center gap-1 text-ink/60">
                          {mov.stock_anterior}
                          <ArrowRight className="h-3 w-3 shrink-0 text-ink/30" />
                          <span className="text-green">+{mov.cantidad_agregada}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-ink/30" />
                          {mov.stock_nuevo}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink/50">
                          {formatearFechaHoraCorta(mov.fecha)}
                        </span>
                      </div>
                      {(mov.nota || mov.usuario_nombre) && (
                        <p className="truncate text-[11px] text-ink/50">
                          {[mov.usuario_nombre || 'Usuario eliminado', mov.nota]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Sin bg/border propio: los botones quedan "flotando" sobre el
            mismo fondo del modal, no en una barra separada. */}
        <div className="flex shrink-0 items-center justify-between gap-1 p-3">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-11 rounded-lg border border-border-strong px-3 text-xs text-ink transition-colors hover:border-amber hover:text-amber"
          >
            Cerrar
          </button>

          {mostrarAcciones && (
            <>
              <BotonAccion icono={Plus} texto="Agregar stock" color="morado" onClick={onAgregarStock} />
              {esAdmin && (
                <>
                  <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={onEditar} />
                  <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={onEliminar} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {fotoExpandida && urlFoto && (
        <ModalVisorFoto
          url={urlFoto}
          alt={producto.nombre}
          onCerrar={() => setFotoExpandida(false)}
        />
      )}
    </div>
  )
}
