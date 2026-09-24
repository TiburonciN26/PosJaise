import { useEffect, useRef, useState } from 'react'
import { ArrowBigDown, Bike, MapPin, Phone, ShoppingBag, Store } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const ETIQUETAS_ESTADO = {
  PENDIENTE: { texto: 'Pendiente', clase: 'bg-amber/15 text-amber' },
  LISTO: { texto: 'Listo', clase: 'bg-blue/15 text-blue' },
  ENTREGADO: { texto: 'Entregado', clase: 'bg-green/15 text-green' },
  CANCELADO: { texto: 'Cancelado', clase: 'bg-ink/10 text-ink/50' },
}

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

function numeroWhatsapp(telefono) {
  const digitos = telefono.replace(/\D/g, '')
  return digitos.length === 9 ? `51${digitos}` : digitos
}

// Panel administrativo de "Pedidos Web" (cuelga de /web, ver
// navegacion.js) — pedidos de productos que un cliente confirmó desde
// su carrito (confirmar_pedido_productos(), 85_carrito_pedidos_web.sql).
// Solo lectura + cambio de estado: el pedido lo crea el cliente, acá
// el personal lo va pasando de Pendiente → Listo → Entregado (o
// Cancelado en cualquier punto antes de Entregado). Sin pago online:
// el cobro/coordinación de entrega se resuelve por fuera del sistema
// (llamada, WhatsApp) — por eso el botón de WhatsApp directo al cliente.
export default function PedidosWeb({ activo = true }) {
  const { mostrarToast } = useToast()

  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [actualizando, setActualizando] = useState(null)
  const primeraCargaHecha = useRef(false)

  async function cargarPedidos(silencioso = false) {
    if (!silencioso) setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('pedidos_web')
      .select(
        'id, tipo_entrega, direccion_entrega, celular_entrega, costo_delivery, subtotal, total, estado, creado_en, ' +
          'clientes(nombre, telefono), zonas_delivery(nombre), ' +
          'pedidos_web_items(id, nombre_producto, cantidad, precio_unitario, subtotal)',
      )
      .order('creado_en', { ascending: false })

    if (errorConsulta) {
      setError('No se pudo cargar los pedidos.')
    } else {
      setError(null)
      setPedidos(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarPedidos(silencioso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function cambiarEstado(pedido, estado) {
    setActualizando(pedido.id)
    const { error: errorActualizar } = await supabase
      .from('pedidos_web')
      .update({ estado, actualizado_en: new Date().toISOString() })
      .eq('id', pedido.id)
    setActualizando(null)

    if (errorActualizar) {
      mostrarToast('No se pudo actualizar el pedido.', 'error')
      return
    }

    mostrarToast('Pedido actualizado.', 'exito')
    cargarPedidos(true)
  }

  const filtrados = busqueda.trim()
    ? pedidos.filter((p) =>
        (p.clientes?.nombre ?? '').toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : pedidos

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6 lg:mx-auto lg:w-full lg:max-w-5xl"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por clienta..."
          tema="red"
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : filtrados.length === 0 ? (
        <EstadoVacio icono={ShoppingBag} mensaje="No hay pedidos todavía." />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((pedido) => {
            const abierto = abiertos.has(pedido.id)
            const etiqueta = ETIQUETAS_ESTADO[pedido.estado] ?? ETIQUETAS_ESTADO.PENDIENTE

            return (
              <div key={pedido.id} className="rounded-lg border border-border bg-surface">
                <div
                  onClick={() => alternarAbierto(pedido.id)}
                  onKeyDown={manejarActivacionTeclado(() => alternarAbierto(pedido.id))}
                  role="button"
                  tabIndex={0}
                  aria-expanded={abierto}
                  className="flex cursor-pointer items-center gap-3 p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red/30 bg-red/15 text-red">
                    {pedido.tipo_entrega === 'DELIVERY' ? (
                      <Bike className="h-4 w-4" />
                    ) : (
                      <Store className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {pedido.clientes?.nombre ?? 'Cliente'}
                    </p>
                    <p className="font-mono text-sm text-red">{formatearSoles(pedido.total)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${etiqueta.clase}`}>
                    {etiqueta.texto}
                  </span>
                  <ArrowBigDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
                      abierto ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <CampoColapsable abierto={abierto}>
                  <div className="border-t border-border p-3">
                    <p className="font-mono text-xs text-ink/50">
                      {formatoFecha.format(new Date(pedido.creado_en))}
                    </p>

                    <div className="mt-2 space-y-1">
                      {pedido.pedidos_web_items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span className="min-w-0 truncate text-ink/80">
                            {item.cantidad}× {item.nombre_producto}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-ink/60">
                            {formatearSoles(item.subtotal)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-ink/60">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span className="font-mono">{formatearSoles(pedido.subtotal)}</span>
                      </div>
                      {pedido.tipo_entrega === 'DELIVERY' && (
                        <>
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 truncate">
                              {pedido.zonas_delivery?.nombre} — {pedido.direccion_entrega}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Delivery</span>
                            <span className="font-mono">{formatearSoles(pedido.costo_delivery)}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {pedido.clientes?.telefono && (
                      <a
                        href={`https://wa.me/${numeroWhatsapp(pedido.clientes.telefono)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-1.5 text-xs text-green"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Escribir por WhatsApp
                      </a>
                    )}

                    {/* Distinto del WhatsApp de arriba a propósito: quien recibe en
                        esa dirección puede no ser la titular de la cuenta. */}
                    {pedido.celular_entrega && (
                      <a
                        href={`https://wa.me/${numeroWhatsapp(pedido.celular_entrega)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5 text-xs text-green"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        WhatsApp al celular de entrega
                      </a>
                    )}

                    {(pedido.estado === 'PENDIENTE' || pedido.estado === 'LISTO') && (
                      <div className="mt-3 flex gap-2">
                        {pedido.estado === 'PENDIENTE' && (
                          <button
                            type="button"
                            onClick={() => cambiarEstado(pedido, 'LISTO')}
                            disabled={actualizando === pedido.id}
                            className="flex-1 rounded-lg bg-blue py-2 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Marcar listo
                          </button>
                        )}
                        {pedido.estado === 'LISTO' && (
                          <button
                            type="button"
                            onClick={() => cambiarEstado(pedido, 'ENTREGADO')}
                            disabled={actualizando === pedido.id}
                            className="flex-1 rounded-lg bg-green py-2 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Marcar entregado
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => cambiarEstado(pedido, 'CANCELADO')}
                          disabled={actualizando === pedido.id}
                          className="flex-1 rounded-lg border border-red py-2 text-xs font-semibold text-red disabled:opacity-40"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </CampoColapsable>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
