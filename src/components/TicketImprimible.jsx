import { createPortal } from 'react-dom'
import { desglosarIGV, etiquetaDocumento, formatearCelular } from '../lib/comprobante.js'

// Va al pie de las boletas y facturas que imprime el POS. Aún no son comprobantes electrónicos: los emite la contadora.
// Para quitarla basta con dejar esta constante en '' (el pie no se dibuja si está vacía).
// El texto completo se arma en leyendaComprobante(): lleva el WhatsApp al que se enviará el PDF y el plazo de entrega.
const LEYENDA_COMPROBANTE = 'Documento de control interno.'
const PLAZO_ENTREGA_BOLETA = '1 a 3 días hábiles'
const PLAZO_ENTREGA_FACTURA = '1 día hábil'

function leyendaComprobante(detalle) {
  if (!LEYENDA_COMPROBANTE) return ''
  const plazo = detalle.comprobante_tipo === 'FACTURA' ? PLAZO_ENTREGA_FACTURA : PLAZO_ENTREGA_BOLETA
  const celular = formatearCelular(detalle.comprobante_celular)
  const destino = celular ? ` por WhatsApp al ${celular}` : ''
  return `${LEYENDA_COMPROBANTE} Su comprobante electrónico (PDF) se enviará${destino} en ${plazo}.`
}

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

  // El descuento general se aplica sobre el total ya sumado (no por línea),
  // así que el subtotal se reconstruye sumando los items — si no se muestra
  // aparte, las líneas del ticket no cuadrarían a simple vista con el TOTAL.
  const subtotal = items.reduce((acumulado, item) => acumulado + item.subtotal, 0)
  const hayDescuento = detalle.descuento_pct > 0 || detalle.descuento_monto > 0

  // Si la venta pidió boleta o factura, el ticket sale con ese encabezado, el
  // número interno (B-/F-), los datos del comprador y el desglose de IGV.
  const esFactura = detalle.comprobante_tipo === 'FACTURA'
  const llevaComprobante = Boolean(detalle.comprobante_tipo)
  const { base: opGravada, igv } = desglosarIGV(detalle.total)

  return createPortal(
    <div id="ticket-impresion" className="hidden print:block">
      <div style={estiloTicket}>
        <div style={{ textAlign: 'center' }}>
          {/* Espacio reservado para logo, si más adelante se agrega uno */}
          <p>.</p>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>POS JAISE</p>
          {llevaComprobante && (
            <>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 'bold' }}>
                {esFactura ? 'FACTURA' : 'BOLETA DE VENTA'}
              </p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>N° {detalle.comprobante_numero}</p>
            </>
          )}
          <p style={{ margin: 0 }}>{separador}</p>
        </div>

        <p style={{ margin: 0 }}>Venta: {detalle.codigo}</p>
        <p style={{ margin: 0 }}>{formatearFechaHora(detalle.fecha)}</p>
        {llevaComprobante ? (
          <>
            {detalle.comprobante_documento && (
              <p style={{ margin: 0 }}>
                {etiquetaDocumento(esFactura ? 'RUC' : (detalle.comprobante_tipo_doc ?? 'DNI'))}: {detalle.comprobante_documento}
              </p>
            )}
            {detalle.comprobante_nombre && (
              <p style={{ margin: 0 }}>
                {esFactura ? 'Razón social' : 'Cliente'}: {detalle.comprobante_nombre}
              </p>
            )}
            {detalle.comprobante_direccion && <p style={{ margin: 0 }}>Dirección: {detalle.comprobante_direccion}</p>}
            {!detalle.comprobante_nombre && detalle.clientes?.nombre && (
              <p style={{ margin: 0 }}>Cliente: {detalle.clientes.nombre}</p>
            )}
          </>
        ) : (
          detalle.clientes?.nombre && <p style={{ margin: 0 }}>Cliente: {detalle.clientes.nombre}</p>
        )}
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

        {hayDescuento && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span>{formatearMonto(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Descuento{detalle.descuento_pct > 0 ? ` (${detalle.descuento_pct}%)` : ''}</span>
              <span>-{formatearMonto(subtotal - detalle.total)}</span>
            </div>
          </>
        )}

        {llevaComprobante && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Op. gravada</span>
              <span>{formatearMonto(opGravada)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>IGV (18%)</span>
              <span>{formatearMonto(igv)}</span>
            </div>
          </>
        )}

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

        {detalle.monto_pos_tarjeta != null && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Digitado en POS</span>
              <span>{formatearMonto(detalle.monto_pos_tarjeta)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Comisión tarjeta</span>
              <span>{formatearMonto(detalle.monto_pos_tarjeta - detalle.total)}</span>
            </div>
          </>
        )}

        <p style={{ margin: '8px 0 0', textAlign: 'center' }}>{separador}</p>
        <p style={{ margin: '2px 0 0', textAlign: 'center' }}>¡Gracias por su compra!</p>
        {llevaComprobante && leyendaComprobante(detalle) && (
          <p style={{ margin: '4px 0 0', textAlign: 'center', fontSize: '8px', lineHeight: 1.3 }}>
            {leyendaComprobante(detalle)}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
