import { useEffect, useState } from 'react'
import { Star, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { guardarCacheDesplegable, leerCacheDesplegable } from '../lib/cacheDesplegable.js'
import ContactoProveedor from './ContactoProveedor.jsx'
import ModalDetalleProveedor from './ModalDetalleProveedor.jsx'
import CampoColapsable from './CampoColapsable.jsx'
import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'

// Proveedores de un producto en su registro desplegable (Inventario). La administradora ve todos los vinculados (el
// principal primero) con WhatsApp y «Ver detalles»; los demás roles solo el nombre del principal (no leen los vínculos
// ni los contactos). Se monta al desplegar, así que no hace una consulta por cada tarjeta cerrada.
// Con muchos proveedores solo se muestran los primeros (el principal va primero); el resto, tras «Ver más».
const MAX_VISIBLES = 3

export default function ProveedoresDelProducto({ producto, esAdmin, onCambio }) {
  const claveCache = `proveedores:${producto.id}`
  // null = cargando. Si ya se leyó antes, se parte de eso (sin parpadeo al reabrir) y se refresca en silencio.
  const [vinculos, setVinculos] = useState(() => (esAdmin ? (leerCacheDesplegable(claveCache) ?? null) : null))
  const [detalle, setDetalle] = useState(null) // id | null
  const [intento, setIntento] = useState(0)
  const [verTodos, setVerTodos] = useState(false)

  useEffect(() => {
    if (!esAdmin) return undefined
    let vigente = true
    supabase
      .from('producto_proveedores')
      .select('principal, creado_en, proveedores(id, nombre, celular, activo)')
      .eq('producto_id', producto.id)
      .then(({ data, error }) => {
        if (!vigente) return
        const lectura = error
          ? []
          : (data ?? [])
              .filter((fila) => fila.proveedores)
              .sort((a, b) => Number(b.principal) - Number(a.principal) || new Date(a.creado_en) - new Date(b.creado_en))
        if (!error) guardarCacheDesplegable(claveCache, lectura)
        setVinculos(lectura)
      })
    return () => {
      vigente = false
    }
  }, [esAdmin, producto.id, intento, claveCache])

  if (!esAdmin) {
    if (!producto.proveedor) return null
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Proveedores</h3>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink/70">
          <Truck className="h-3.5 w-3.5 shrink-0 text-ink/60" aria-hidden="true" />
          <span className="truncate">{producto.proveedor}</span>
        </p>
      </div>
    )
  }

  if (!vinculos || vinculos.length === 0) return null

  const primeros = vinculos.slice(0, MAX_VISIBLES)
  const resto = vinculos.slice(MAX_VISIBLES)

  // El principal va en amarillo (ícono y nombre) junto a su estrella; los demás, sin color.
  const filaProveedor = ({ principal, proveedores: proveedor }) => (
    <div key={proveedor.id} className="flex items-center justify-between gap-2">
      <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs ${principal ? 'font-medium text-yellow-400' : 'text-ink/70'}`}>
        <Truck className={`h-3.5 w-3.5 shrink-0 ${principal ? '' : 'text-ink/60'}`} aria-hidden="true" />
        <span className="truncate">{proveedor.nombre}</span>
        {principal && <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400" aria-label="Proveedor principal" role="img" />}
        {!proveedor.activo && <span className="shrink-0 text-[11px] text-ink/40">· inactivo</span>}
      </p>
      <ContactoProveedor celular={proveedor.celular} onVerDetalles={() => setDetalle(proveedor.id)} whatsappSoloEscritorio />
    </div>
  )

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">Proveedores</h3>
      <div className="mt-1 space-y-0.5">
        {primeros.map(filaProveedor)}

        {/* Los que pasan de 3 se despliegan con una animación de deslizamiento (alto 0 ↔ auto) bajo el enlace. */}
        {resto.length > 0 && (
          <>
            <CampoColapsable abierto={verTodos}>
              <div className="space-y-0.5" inert={!verTodos}>
                {resto.map(filaProveedor)}
              </div>
            </CampoColapsable>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setVerTodos((anterior) => !anterior)}
                aria-expanded={verTodos}
                className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium text-amber transition-colors hover:bg-amber/10"
              >
                {verTodos ? 'Ver menos' : `Ver ${resto.length} más`}
                <IconoFlechaDesplegable
                  className={`h-2 w-2 transition-transform duration-300 ${verTodos ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </>
        )}

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
    </div>
  )
}
