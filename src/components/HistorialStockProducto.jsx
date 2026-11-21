import { useEffect, useState } from 'react'
import { Star, StickyNote, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { guardarCacheDesplegable, leerCacheDesplegable } from '../lib/cacheDesplegable.js'
import ContactoProveedor from './ContactoProveedor.jsx'

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

// Historial de cargas de stock de un producto (quién, cuándo, cuánto). Solo ADMINISTRADOR: la RPC
// `historial_stock_producto` lo exige, así que para otros roles no se renderiza ni se consulta nada.
// Lo usa el detalle desplegable de Inventario (tarjeta móvil y fila de la tabla). Cada ingreso dice de qué proveedor llegó,
// con su WhatsApp; la ficha del proveedor («Ver detalles», el ojo) vive solo en el bloque de Proveedores del producto, no aquí.
export default function HistorialStockProducto({ productoId, esAdmin, proveedorHabitualId = null }) {
  const claveCache = `historial:${productoId}`
  const previo = esAdmin ? leerCacheDesplegable(claveCache) : undefined
  // Con una lectura previa se muestra al instante y se refresca en silencio (ver lib/cacheDesplegable.js).
  const [historial, setHistorial] = useState(previo ?? [])
  const [cargando, setCargando] = useState(esAdmin && previo === undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!esAdmin) return undefined

    let vigente = true
    setError(null)

    supabase.rpc('historial_stock_producto', { p_producto_id: productoId }).then(({ data, error: errorRpc }) => {
      if (!vigente) return
      if (errorRpc) {
        setError('No se pudo cargar el historial de stock.')
      } else {
        setHistorial(data ?? [])
        guardarCacheDesplegable(claveCache, data ?? [])
      }
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [productoId, esAdmin, claveCache])

  if (!esAdmin) return null

  const esPrincipal = (mov) => Boolean(proveedorHabitualId) && mov.proveedor_id === proveedorHabitualId

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Historial de stock</h3>

      {cargando ? (
        <p className="mt-2 text-center font-mono text-xs text-ink/60">Cargando...</p>
      ) : error ? (
        <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
      ) : historial.length === 0 ? (
        <p className="mt-2 text-center font-mono text-xs text-ink/60">Sin movimientos de stock todavía.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {historial.map((mov, indice) => (
            <li key={`${mov.fecha}-${indice}`} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
              {/* Cuánto se agregó y cuándo, sin el cálculo (stock anterior → +cantidad → stock nuevo). */}
              <div className="flex items-center justify-between gap-2 font-mono text-sm">
                <span className="text-green">+{mov.cantidad_agregada}</span>
                <span className="shrink-0 text-[11px] text-ink/50">{formatearFechaHoraCorta(mov.fecha)}</span>
              </div>
              <p className="truncate text-[11px] text-ink/50">{mov.usuario_nombre || 'Usuario eliminado'}</p>
              {/* Nota del ingreso (si la tiene), con su ícono a la izquierda. */}
              {mov.nota && (
                <p className="mt-0.5 flex items-start gap-1 text-[11px] text-ink/50">
                  <StickyNote className="mt-px h-3 w-3 shrink-0" aria-label="Nota" role="img" />
                  <span className="min-w-0 break-words">{mov.nota}</span>
                </p>
              )}
              {/* De qué proveedor llegó ESTE ingreso: el principal del producto va en amarillo (ícono, nombre y estrella); los
                  demás, sin color (ya no se rotulan «otro proveedor»: se deduce por la estrella). */}
              {mov.proveedor_nombre && (
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p
                    className={`flex min-w-0 items-center gap-1 text-[11px] ${
                      esPrincipal(mov) ? 'font-medium text-yellow-400' : 'text-ink/60'
                    }`}
                  >
                    <Truck className="h-3 w-3 shrink-0" />
                    <span className="truncate">{mov.proveedor_nombre}</span>
                    {esPrincipal(mov) && <Star className="h-3 w-3 shrink-0 fill-yellow-400" aria-label="Proveedor principal" role="img" />}
                  </p>
                  <ContactoProveedor celular={mov.proveedor_celular} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
