import { Truck, Store } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { fechaHora, soles, ESTADOS_PEDIDO, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { Capsula, EstadoLista } from './PiezasPerfil.jsx'

const SELECT_PEDIDOS_PERFIL =
  'id, creado_en, estado, tipo_entrega, direccion_entrega, total, costo_delivery, metodo_pago, pago_verificado, ' +
  'cupon_codigo, pedidos_web_items(id, nombre_producto, cantidad, subtotal)'

// Pedidos de la tienda web de la clienta. Gestionarlos se sigue haciendo en Web → Pedidos.
export default function SeccionPedidos({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase
        .from('pedidos_web')
        .select(SELECT_PEDIDOS_PERFIL)
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .order('id')
        .range(desde, desde + cantidad - 1),
  })

  return (
    <EstadoLista lista={lista} vacio="No ha hecho pedidos por la web.">
      <ul className="space-y-2">
        {lista.filas.map((pedido) => {
          const delivery = pedido.tipo_entrega === 'DELIVERY'
          const Icono = delivery ? Truck : Store
          return (
            <li key={pedido.id} className="rounded-lg border border-border bg-bg/40 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Icono className="mt-0.5 h-4 w-4 shrink-0 text-ink/50" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{fechaHora(pedido.creado_en)}</p>
                  <p className="truncate text-xs text-ink/60">
                    {delivery ? `Delivery · ${pedido.direccion_entrega || 'sin dirección'}` : 'Recojo en tienda'}
                    {pedido.metodo_pago && ` · ${pedido.metodo_pago}`}
                    {' · '}
                    <span className={pedido.pago_verificado ? 'text-green' : 'text-amber'}>
                      {pedido.pago_verificado ? 'pago verificado' : 'pago sin verificar'}
                    </span>
                    {pedido.cupon_codigo && ` · Cupón ${pedido.cupon_codigo}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Capsula estado={ESTADOS_PEDIDO[pedido.estado] ?? { label: pedido.estado, clase: 'border-border-strong text-ink/60' }} />
                  <span className="font-mono text-sm text-ink">{soles(pedido.total)}</span>
                </div>
              </div>
              {(pedido.pedidos_web_items ?? []).length > 0 && (
                <ul className="ml-6 mt-1.5 space-y-0.5">
                  {pedido.pedidos_web_items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-xs text-ink/70">
                      <span className="min-w-0 flex-1 truncate">
                        {item.cantidad} × {item.nombre_producto}
                      </span>
                      <span className="shrink-0 font-mono">{soles(item.subtotal)}</span>
                    </li>
                  ))}
                  {Number(pedido.costo_delivery) > 0 && (
                    <li className="flex items-center gap-2 text-xs text-ink/50">
                      <span className="min-w-0 flex-1">Delivery</span>
                      <span className="shrink-0 font-mono">{soles(pedido.costo_delivery)}</span>
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </EstadoLista>
  )
}
