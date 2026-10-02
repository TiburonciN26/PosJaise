import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, MapPin, MessageCircle, ShoppingBag, Store, Ticket, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { obtenerMiClienteId } from '../../lib/clienteWeb.js'
import { useToast } from '../../context/ToastContext.jsx'
import { useCerrarConEscape } from '../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../hooks/useModalA11y.js'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearFechaSoloDia } from '../../lib/fechas.js'
import { numeroWhatsapp } from '../../lib/contactoNegocio.js'

const NOMBRES_METODO_PAGO = { YAPE: 'Yape', PLIN: 'Plin', TRANSFERENCIA: 'Transferencia' }

const ETIQUETAS_ESTADO = {
  PENDIENTE: { texto: 'Pendiente de verificación', clase: 'bg-amber/15 text-amber' },
  LISTO: { texto: 'Pago confirmado — en preparación', clase: 'bg-blue/15 text-blue' },
  ENTREGADO: { texto: 'Entregado', clase: 'bg-green/15 text-green' },
  CANCELADO: { texto: 'Cancelado', clase: 'bg-white/10 text-white/50' },
}

const formatoFecha = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

function formatearHoraEntrega(horaSql) {
  if (!horaSql) return ''
  return horaSql.slice(0, 5)
}

// "Pedidos" (menú del avatar, anidada bajo Mi Perfil) — pedido del
// usuario: la clienta necesita ver el estado de sus pedidos de
// productos y poder cancelarlos. La regla de cancelación no es "antes
// de que el negocio lo entregue" sino "antes de que el admin verifique
// el pago" (`pago_verificado`, ver verificar_pago_pedido_web() en
// PedidosWeb.jsx / 100_pedidos_web_pago.sql): una vez verificado ya
// existe una venta real detrás (stock descontado, cupón redimido) que
// la app no puede revertir solo con un cambio de estado — de ahí en
// adelante hay que hablar con el negocio para pedir la devolución
// (cancelar_mi_pedido_web(), 103_cancelar_pedido_web.sql, aplica esa
// misma regla server-side — nunca solo en el botón).
export default function PedidosCliente() {
  const { mostrarToast } = useToast()

  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [telefonoNegocio, setTelefonoNegocio] = useState('')
  const [pedidoCancelando, setPedidoCancelando] = useState(null)
  const [cancelando, setCancelando] = useState(false)

  const panelCancelarRef = useRef(null)

  useCerrarConEscape(() => setPedidoCancelando(null), Boolean(pedidoCancelando))
  // QA-018: role=dialog, nombre accesible y foco contenido (como el modal de cancelar cita).
  useModalA11y(panelCancelarRef, Boolean(pedidoCancelando))

  async function cargar() {
    const miId = await obtenerMiClienteId()
    const [pedidosRes, contactoRes] = await Promise.all([
      miId
        ? supabase
            .from('pedidos_web')
            .select(
              'id, tipo_entrega, direccion_entrega, costo_delivery, subtotal, descuento_cupon, cupon_codigo, ' +
                'total, estado, metodo_pago, pago_verificado, fecha_entrega, hora_entrega, creado_en, ' +
                'zonas_delivery(nombre), pedidos_web_items(id, nombre_producto, cantidad, precio_unitario, subtotal)',
            )
            .eq('cliente_id', miId)
            .order('creado_en', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.rpc('datos_contacto'),
    ])
    setPedidos(pedidosRes.data ?? [])
    setTelefonoNegocio(contactoRes.data?.telefono ?? '')
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function confirmarCancelar() {
    if (!pedidoCancelando) return
    setCancelando(true)
    const { error } = await supabase.rpc('cancelar_mi_pedido_web', { p_pedido_id: pedidoCancelando.id })
    setCancelando(false)

    if (error) {
      mostrarToast(error.message || 'No se pudo cancelar el pedido.', 'error')
      setPedidoCancelando(null)
      return
    }

    mostrarToast('Pedido cancelado.', 'exito')
    setPedidoCancelando(null)
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-lg">
        {pedidos.length === 0 ? (
          <div className="liquid-glass flex flex-col items-center gap-2 rounded-none p-8 text-center">
            <ShoppingBag className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/60">Todavía no has hecho ningún pedido.</p>
            <Link to="/productos" className="mt-1 text-sm font-semibold text-[var(--lw-gold)]">
              Ver productos
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {pedidos.map((pedido) => {
              const etiqueta = ETIQUETAS_ESTADO[pedido.estado] ?? ETIQUETAS_ESTADO.PENDIENTE
              const puedeCancelar = pedido.estado === 'PENDIENTE' && !pedido.pago_verificado

              return (
                <div key={pedido.id} className="liquid-glass rounded-none p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70">
                        {pedido.tipo_entrega === 'DELIVERY' ? <Bike className="h-4 w-4" /> : <Store className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="font-mono text-xs text-white/50">{formatoFecha.format(new Date(pedido.creado_en))}</p>
                        <p className="text-sm font-semibold text-white">{formatearSoles(pedido.total)}</p>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${etiqueta.clase}`}>
                      {etiqueta.texto}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
                    {pedido.pedidos_web_items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="min-w-0 truncate text-white/80">
                          {item.cantidad}× {item.nombre_producto}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-white/60">{formatearSoles(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs text-white/60">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatearSoles(pedido.subtotal)}</span>
                    </div>
                    {pedido.cupon_codigo && (
                      <div className="flex items-center justify-between text-[var(--lw-gold)]">
                        <span className="flex items-center gap-1.5">
                          <Ticket className="h-3 w-3 shrink-0" />
                          Cupón {pedido.cupon_codigo}
                        </span>
                        <span className="font-mono">− {formatearSoles(pedido.descuento_cupon)}</span>
                      </div>
                    )}
                    {pedido.tipo_entrega === 'DELIVERY' ? (
                      <>
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="min-w-0">
                            {pedido.zonas_delivery?.nombre} — {pedido.direccion_entrega}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Delivery</span>
                          <span className="font-mono">{formatearSoles(pedido.costo_delivery)}</span>
                        </div>
                      </>
                    ) : (
                      <p>Recojo en tienda</p>
                    )}
                    <p>
                      {pedido.tipo_entrega === 'DELIVERY' ? 'Entrega' : 'Recojo'}: {formatearFechaSoloDia(pedido.fecha_entrega)} — {formatearHoraEntrega(pedido.hora_entrega)}
                    </p>
                    <p>Pago por {NOMBRES_METODO_PAGO[pedido.metodo_pago] ?? pedido.metodo_pago}</p>
                  </div>

                  <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
                    <span className="text-sm font-semibold text-white">Total</span>
                    <span className="text-base font-bold text-white">{formatearSoles(pedido.total)}</span>
                  </div>

                  {puedeCancelar && (
                    <button
                      type="button"
                      onClick={() => setPedidoCancelando(pedido)}
                      className="mt-3 w-full rounded-lg border border-red/40 py-2 text-xs font-semibold text-red transition-colors hover:bg-red/10"
                    >
                      Cancelar pedido
                    </button>
                  )}

                  {pedido.pago_verificado && pedido.estado !== 'ENTREGADO' && pedido.estado !== 'CANCELADO' && (
                    <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                      <p className="text-xs text-white/50">
                        Ya confirmamos tu pago y generamos la venta — si necesitas cancelar, habla directamente con
                        el negocio para solicitar la devolución.
                      </p>
                      {telefonoNegocio && (
                        <a
                          href={`https://wa.me/${numeroWhatsapp(telefonoNegocio)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs font-semibold text-green"
                        >
                          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                          Escribir por WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {pedidoCancelando && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelCancelarRef} className="lw-bar w-full max-w-sm rounded-lg border border-white/10 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">¿Cancelar este pedido?</h2>
              <button
                type="button"
                onClick={() => setPedidoCancelando(null)}
                aria-label="Cerrar"
                className="-m-2 rounded-lg p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-white/60">
              Esta acción no se puede deshacer. Vuelve a pedir cuando quieras.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPedidoCancelando(null)}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white transition-colors hover:border-[var(--lw-gold)] hover:text-[var(--lw-gold)] disabled:opacity-40"
              >
                No, mantener
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                disabled={cancelando}
                className="flex-1 rounded-lg bg-red py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
