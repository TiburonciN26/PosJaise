import { useEffect, useState } from 'react'
import { MessageCircle, Star, StickyNote, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { guardarCacheDesplegable, leerCacheDesplegable } from '../lib/cacheDesplegable.js'
import { enlaceWhatsapp } from '../lib/proveedores.js'
import { useMediaQuery } from '../hooks/useMediaQuery.js'

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

// Proveedor de UN ingreso: [camión] nombre [estrella si es el principal del producto] [WhatsApp]. El principal va en
// amarillo (ícono, nombre y estrella); los demás, sin color. El WhatsApp es un ícono compacto (no el botón de 38 px de
// ContactoProveedor) para que el registro siga ocupando una sola línea. La ficha del proveedor («Ver detalles», el ojo)
// vive solo en el bloque de Proveedores del producto, no aquí.
function ProveedorDelIngreso({ movimiento, principal }) {
  if (!movimiento.proveedor_nombre) return <span className="text-ink/40">—</span>
  const whatsapp = enlaceWhatsapp(movimiento.proveedor_celular)
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`flex min-w-0 items-center gap-1 ${principal ? 'font-medium text-yellow-400' : 'text-ink/60'}`}>
        <Truck className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{movimiento.proveedor_nombre}</span>
        {principal && <Star className="h-3 w-3 shrink-0 fill-yellow-400" aria-label="Proveedor principal" role="img" />}
      </span>
      {whatsapp && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          title="WhatsApp del proveedor"
          aria-label="WhatsApp del proveedor"
          className="flex shrink-0 items-center justify-center rounded-lg p-1 text-green transition-colors hover:bg-surface-3"
        >
          <MessageCircle className="h-4 w-4" />
        </a>
      )}
    </span>
  )
}

// Historial de cargas de stock de un producto (quién, cuándo, cuánto, de qué proveedor). Solo ADMINISTRADOR: la RPC
// `historial_stock_producto` lo exige, así que para otros roles no se renderiza ni se consulta nada.
// Lo usa el detalle desplegable de Inventario, a todo el ancho. Escritorio: tabla, un registro por fila y un dato por
// columna (Agregado · Proveedor · Fecha · Registró · Nota). Móvil: tarjetas, con el proveedor a la derecha de la cantidad.
export default function HistorialStockProducto({ productoId, esAdmin, proveedorHabitualId = null }) {
  const esEscritorio = useMediaQuery('(min-width: 1024px)')
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

  const claveFila = (mov, indice) => `${mov.fecha}-${indice}`

  return (
    <div className="mt-4 pb-4 lg:pb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Historial de stock</h3>

      {cargando ? (
        <p className="mt-2 text-center font-mono text-xs text-ink/60">Cargando...</p>
      ) : error ? (
        <p className="mt-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
      ) : historial.length === 0 ? (
        <p className="mt-2 text-center font-mono text-xs text-ink/60">Sin movimientos de stock todavía.</p>
      ) : esEscritorio ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="font-mono uppercase tracking-wider text-ink/60">
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Agregado</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Proveedor</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Fecha</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Registró</th>
                <th className="w-full px-3 py-2 font-semibold">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {historial.map((mov, indice) => (
                <tr key={claveFila(mov, indice)} className="bg-tabla">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-sm text-green">+{mov.cantidad_agregada}</td>
                  <td className="max-w-64 px-3 py-1.5">
                    <ProveedorDelIngreso movimiento={mov} principal={esPrincipal(mov)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink/60">{formatearFechaHoraCorta(mov.fecha)}</td>
                  <td className="max-w-48 truncate px-3 py-1.5 text-ink/60">{mov.usuario_nombre || 'Usuario eliminado'}</td>
                  {/* max-w-0 + w-full: la nota ocupa lo que sobra y se corta con «…» (el registro sigue en una línea). */}
                  <td className="max-w-0 truncate px-3 py-1.5 text-ink/60" title={mov.nota || undefined}>
                    {mov.nota || <span className="text-ink/40">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {historial.map((mov, indice) => (
            <li key={claveFila(mov, indice)} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
              {/* Cuánto se agregó, de qué proveedor llegó (con su WhatsApp) y cuándo, sin el cálculo de stock. */}
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="shrink-0 text-green">+{mov.cantidad_agregada}</span>
                <span className="min-w-0 flex-1 font-sans text-[11px]">
                  <ProveedorDelIngreso movimiento={mov} principal={esPrincipal(mov)} />
                </span>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
