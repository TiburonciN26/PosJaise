import { supabase } from '../../lib/supabase.js'
import { useListaAcumulada } from '../../hooks/useListaAcumulada.js'
import { fechaCorta, soles, TAMANO_PAGINA_PERFIL } from '../../lib/perfilCliente.js'
import { EstadoLista, TablaSeccion } from './PiezasPerfil.jsx'

// «Servicios» y «Productos comprados»: una fila por servicio / producto (lo más frecuente primero). No repiten el
// detalle de cada día, que ya está en «Visitas». Salen de servicios_cliente_resumen() y productos_cliente_resumen().

export function SeccionServicios({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase.rpc('servicios_cliente_resumen', { p_cliente_id: clienteId }).range(desde, desde + cantidad - 1),
  })

  return (
    <EstadoLista lista={lista} vacio="Todavía no se ha hecho ningún servicio.">
      <TablaSeccion
        columnas={[
          { titulo: 'Servicio' },
          { titulo: 'Veces', derecha: true },
          { titulo: 'Última vez' },
          { titulo: 'Asistente habitual' },
          { titulo: 'Precio prom.', derecha: true },
          { titulo: 'Total', derecha: true },
        ]}
      >
        {lista.filas.map((fila) => (
          <tr key={fila.servicio_id}>
            <td className="px-2 py-2 text-ink">{fila.nombre}</td>
            <td className="px-2 py-2 text-right font-mono text-purple-300">{fila.veces}</td>
            <td className="px-2 py-2 text-ink/70">{fechaCorta(fila.ultima)}</td>
            <td className="px-2 py-2 text-ink/70">{fila.asistente_frecuente || '—'}</td>
            <td className="px-2 py-2 text-right font-mono text-ink/70">{soles(fila.precio_promedio)}</td>
            <td className="px-2 py-2 text-right font-mono text-ink">{soles(fila.total)}</td>
          </tr>
        ))}
      </TablaSeccion>
    </EstadoLista>
  )
}

export function SeccionProductos({ clienteId }) {
  const lista = useListaAcumulada({
    clave: clienteId,
    tam: TAMANO_PAGINA_PERFIL,
    cargar: (desde, cantidad) =>
      supabase.rpc('productos_cliente_resumen', { p_cliente_id: clienteId }).range(desde, desde + cantidad - 1),
  })

  return (
    <EstadoLista lista={lista} vacio="No ha comprado productos.">
      <TablaSeccion
        columnas={[
          { titulo: 'Producto' },
          { titulo: 'Compras', derecha: true },
          { titulo: 'Unidades', derecha: true },
          { titulo: 'Última compra' },
          { titulo: 'Total', derecha: true },
        ]}
      >
        {lista.filas.map((fila) => (
          <tr key={fila.producto_id ?? fila.nombre}>
            <td className="px-2 py-2 text-ink">{fila.nombre}</td>
            <td className="px-2 py-2 text-right font-mono text-purple-300">{fila.veces}</td>
            <td className="px-2 py-2 text-right font-mono text-ink/70">{fila.unidades}</td>
            <td className="px-2 py-2 text-ink/70">{fechaCorta(fila.ultima)}</td>
            <td className="px-2 py-2 text-right font-mono text-ink">{soles(fila.total)}</td>
          </tr>
        ))}
      </TablaSeccion>
    </EstadoLista>
  )
}
