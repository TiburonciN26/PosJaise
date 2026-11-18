import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatearSoles } from '../lib/moneda.js'

// Historial de movimientos de un artículo del Almacén: quién sacó / ingresó qué, cuándo y, en los ingresos, a qué costo
// (total y por unidad). Sale de historial_almacen_articulo(), que solo le responde a la administradora. Lo usan el
// desplegable de la tabla de PC (Almacen.jsx) y el modal de detalle del celular (ModalDetalleArticuloAlmacen.jsx).

function formatearFechaHoraCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'numeric', timeZone: 'America/Lima' }).format(
    fecha,
  )
  const horaStr = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${fechaStr} ${horaStr}`
}

// stockActual se recibe solo para recargar: tras un ingreso o una salida el stock cambia y el historial se vuelve a pedir.
export default function HistorialArticuloAlmacen({ articuloId, stockActual }) {
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    supabase.rpc('historial_almacen_articulo', { p_articulo_id: articuloId }).then(({ data, error: errorRpc }) => {
      if (!vigente) return
      if (errorRpc) setError('No se pudo cargar el historial del artículo.')
      else setHistorial(data ?? [])
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [articuloId, stockActual])

  if (cargando) return <p className="text-center font-mono text-xs text-ink/60">Cargando...</p>
  if (error) return <p className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</p>
  if (historial.length === 0) return <p className="text-center font-mono text-xs text-ink/60">Sin movimientos todavía.</p>

  return (
    <ul className="space-y-1.5">
      {historial.map((mov, indice) => {
        const esIngreso = mov.tipo === 'INGRESO'
        const costo = esIngreso && mov.costo_total != null ? Number(mov.costo_total) : null
        const costoTexto =
          costo == null
            ? null
            : mov.cantidad > 1
              ? `${formatearSoles(costo)} (${formatearSoles(costo / mov.cantidad)} c/u)`
              : formatearSoles(costo)
        return (
          <li key={`${mov.fecha}-${indice}`} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
            <div className="flex items-center justify-between gap-2 font-mono text-sm">
              {/* Solo cuánto entró o salió (pedido de la dueña); el stock que quedó se ve en la fila / arriba. */}
              <span className={esIngreso ? 'text-green' : 'text-red'}>
                {esIngreso ? 'Ingresó' : 'Salió'} {mov.cantidad}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-ink/50">{formatearFechaHoraCorta(mov.fecha)}</span>
            </div>
            <p className="truncate text-[11px] text-ink/50">
              {[mov.usuario_nombre || 'Usuario eliminado', costoTexto, mov.nota].filter(Boolean).join(' · ')}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
