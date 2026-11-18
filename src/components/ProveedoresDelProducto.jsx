import { useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import ContactoProveedor from './ContactoProveedor.jsx'
import ModalDetalleProveedor from './ModalDetalleProveedor.jsx'

// Proveedores de un producto en su registro desplegable (Inventario). La administradora ve todos los vinculados (el
// principal primero) con WhatsApp y «Ver detalles»; los demás roles solo el nombre del principal (no leen los vínculos
// ni los contactos). Se monta al desplegar, así que no hace una consulta por cada tarjeta cerrada.
export default function ProveedoresDelProducto({ producto, esAdmin, onCambio }) {
  const [vinculos, setVinculos] = useState(null) // null = cargando
  const [detalle, setDetalle] = useState(null) // id | null
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!esAdmin) return undefined
    let vigente = true
    supabase
      .from('producto_proveedores')
      .select('principal, creado_en, proveedores(id, nombre, celular, activo)')
      .eq('producto_id', producto.id)
      .then(({ data, error }) => {
        if (!vigente) return
        setVinculos(
          error
            ? []
            : (data ?? [])
                .filter((fila) => fila.proveedores)
                .sort((a, b) => Number(b.principal) - Number(a.principal) || new Date(a.creado_en) - new Date(b.creado_en)),
        )
      })
    return () => {
      vigente = false
    }
  }, [esAdmin, producto.id, intento])

  if (!esAdmin) {
    if (!producto.proveedor) return null
    return (
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-ink/70">
        <Truck className="h-3.5 w-3.5 shrink-0 text-ink/60" aria-hidden="true" />
        <span className="truncate">{producto.proveedor}</span>
      </p>
    )
  }

  if (!vinculos || vinculos.length === 0) return null

  return (
    <div className="mt-2 space-y-0.5">
      {vinculos.map(({ principal, proveedores: proveedor }) => (
        <div key={proveedor.id} className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink/70">
            <Truck className="h-3.5 w-3.5 shrink-0 text-ink/60" aria-hidden="true" />
            <span className="truncate">{proveedor.nombre}</span>
            {principal && <span className="shrink-0 text-[11px] text-amber">· principal</span>}
            {!proveedor.activo && <span className="shrink-0 text-[11px] text-ink/40">· inactivo</span>}
          </p>
          <ContactoProveedor celular={proveedor.celular} onVerDetalles={() => setDetalle(proveedor.id)} />
        </div>
      ))}

      {detalle && (
        <ModalDetalleProveedor
          proveedorId={detalle}
          onCerrar={() => setDetalle(null)}
          onCambio={() => {
            setIntento((n) => n + 1)
            onCambio?.()
          }}
        />
      )}
    </div>
  )
}
