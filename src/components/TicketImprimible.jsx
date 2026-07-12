import { createPortal } from 'react-dom'

function formatearMonto(monto) {
  return `S/ ${monto.toFixed(2)}`
}

function formatearFechaHora(fechaIso) {
  const fecha = new Date(fechaIso)
  const fechaStr = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
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

const estiloTicket = {
  width: '58mm',
  padding: '3mm',
  fontFamily: 'ui-monospace, "Space Mono", Consolas, monospace',
  fontSize: '10px',
  lineHeight: 1.4,
  color: '#000',
  background: '#fff',
}

const separador = '-'.repeat(32)

export default function TicketImprimible({ detalle, items }) {
  if (!detalle) return null

  const vuelto =
    detalle.monto_recibido != null ? detalle.monto_recibido - detalle.total : null

  return createPortal(
    <div id="ticket-impresion" className="hidden print:block">
      <div style={estiloTicket}>
        <div style={{ textAlign: 'center' }}>
          {/* Espacio reservado para logo, si más adelante se agrega uno */}
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>POS JAISE</p>
          <p style={{ margin: 0 }}>{separador}</p>
        </div>

        <p style={{ margin: 0 }}>Venta: {detalle.codigo}</p>
        <p style={{ margin: 0 }}>{formatearFechaHora(detalle.fecha)}</p>
        {detalle.clientes?.nombre && <p style={{ margin: 0 }}>Cliente: {detalle.clientes.nombre}</p>}
        {detalle.estado === 'ANULADA' && (
          <p style={{ margin: 0, fontWeight: 'bold' }}>*** VENTA ANULADA ***</p>
        )}
        <p style={{ margin: '2px 0' }}>{separador}</p>

        {items.map((item) => (
          <div key={item.id} style={{ marginBottom: '3px' }}>
            <p style={{ margin: 0 }}>
              {item.nombre}
              {item.tipo === 'SERVICIO' ? ' (Servicio)' : ''}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {item.cantidad} x {formatearMonto(item.precio_unitario)}
              </span>
              <span>{formatearMonto(item.subtotal)}</span>
            </div>
          </div>
        ))}

        <p style={{ margin: '2px 0' }}>{separador}</p>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
          <span>TOTAL</span>
          <span>{formatearMonto(detalle.total)}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
          <span>Método de pago</span>
          <span>{detalle.metodo_pago}</span>
        </div>

        {detalle.monto_recibido != null && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Recibido</span>
              <span>{formatearMonto(detalle.monto_recibido)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Vuelto</span>
              <span>{formatearMonto(vuelto)}</span>
            </div>
          </>
        )}

        <p style={{ margin: '8px 0 0', textAlign: 'center' }}>{separador}</p>
        <p style={{ margin: '2px 0 0', textAlign: 'center' }}>¡Gracias por su compra!</p>
      </div>
    </div>,
    document.body,
  )
}
