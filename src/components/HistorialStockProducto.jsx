import { useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import ContactoProveedor from './ContactoProveedor.jsx'
import ModalDetalleProveedor from './ModalDetalleProveedor.jsx'

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
// Lo usan el modal de detalle (escritorio) y el registro desplegable de Inventario (móvil). Cada ingreso dice de qué
// proveedor llegó, con WhatsApp y «Ver detalles» (ficha en un modal con Editar/Eliminar). `onProveedorCambio` avisa al
// padre si se editó o eliminó un proveedor desde aquí.
export default function HistorialStockProducto({ productoId, esAdmin, proveedorHabitualId = null, onProveedorCambio }) {
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(esAdmin)
  const [error, setError] = useState(null)
  const [intento, setIntento] = useState(0)
  const [proveedorDetalle, setProveedorDetalle] = useState(null) // id | null

  useEffect(() => {
    if (!esAdmin) return undefined

    let vigente = true
    setCargando(true)
    setError(null)

    supabase.rpc('historial_stock_producto', { p_producto_id: productoId }).then(({ data, error: errorRpc }) => {
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
  }, [productoId, esAdmin, intento])

  if (!esAdmin) return null

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
              {(mov.nota || mov.usuario_nombre) && (
                <p className="truncate text-[11px] text-ink/50">
                  {[mov.usuario_nombre || 'Usuario eliminado', mov.nota].filter(Boolean).join(' · ')}
                </p>
              )}
              {/* De qué proveedor llegó ESTE ingreso; si no es el habitual del producto se resalta como «otro proveedor». */}
              {mov.proveedor_nombre && (
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p
                    className={`flex min-w-0 items-center gap-1 text-[11px] ${
                      proveedorHabitualId && mov.proveedor_id !== proveedorHabitualId ? 'text-amber' : 'text-ink/60'
                    }`}
                  >
                    <Truck className="h-3 w-3 shrink-0" />
                    <span className="truncate">{mov.proveedor_nombre}</span>
                    {proveedorHabitualId && mov.proveedor_id !== proveedorHabitualId && (
                      <span className="shrink-0">· otro proveedor</span>
                    )}
                  </p>
                  <ContactoProveedor
                    celular={mov.proveedor_celular}
                    onVerDetalles={() => setProveedorDetalle(mov.proveedor_id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {proveedorDetalle && (
        <ModalDetalleProveedor
          proveedorId={proveedorDetalle}
          onCerrar={() => setProveedorDetalle(null)}
          onCambio={() => {
            setIntento((n) => n + 1) // nombre / celular nuevos en el historial
            onProveedorCambio?.()
          }}
        />
      )}
    </div>
  )
}
