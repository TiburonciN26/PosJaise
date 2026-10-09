import { REGLAS, RUTAS_LEGALES } from '../../config/legal.js'
import DocumentoLegal from './DocumentoLegal.jsx'
import { useDatosNegocioLegal } from '../../hooks/useDatosNegocioLegal.js'

// Política de cambios y devoluciones — requisito de Culqi. Reglas numéricas en
// config/legal.js. Redacción base sujeta a revisión del negocio antes de producción.
export default function PoliticaCambiosCliente() {
  const datos = useDatosNegocioLegal()
  const contacto = datos.telefono ? `escríbenos por WhatsApp al ${datos.telefono}` : 'escríbenos por los medios de contacto de nuestra web'

  const secciones = [
    {
      titulo: 'Productos',
      bloques: [
        [
          `Puedes solicitar un cambio o devolución dentro de ${REGLAS.plazoDevolucionProductosDias} días calendario desde que recibes el producto.`,
          'El producto debe estar sin uso, sellado y en su empaque original, y debes presentar tu comprobante o número de pedido.',
          'Por higiene y seguridad, no aceptamos devoluciones de productos abiertos, usados o de uso personal, salvo que tengan un defecto de fábrica.',
          'Si el producto llegó defectuoso, dañado o es distinto al que pediste, lo cambiamos o te devolvemos tu dinero, y asumimos el costo del recojo o envío.',
        ],
        `Para solicitarlo, ${contacto}, indicando tu número de pedido y, si hay daño, adjuntando fotos.`,
      ],
    },
    {
      titulo: 'Servicios y citas',
      bloques: [
        [
          'Un servicio ya realizado no es reembolsable.',
          `Si no quedaste conforme, avísanos dentro de ${REGLAS.plazoReclamoServicioDias} días: evaluaremos repetir el servicio o una compensación.`,
          `Puedes cancelar o reprogramar tu cita sin perder el adelanto hasta ${REGLAS.horasCancelarSinCosto} horas antes. Si lo haces con esa anticipación, tu adelanto se devuelve o se abona a la nueva cita, como prefieras.`,
          'Si cancelas fuera de ese plazo o no asistes, el adelanto no se devuelve.',
          'Si cancelamos nosotros la cita, te devolvemos el adelanto completo o lo abonamos a la nueva fecha.',
        ],
      ],
    },
    {
      titulo: 'Reembolsos',
      bloques: [
        [
          `Una vez aprobada la devolución, procesamos el reembolso en un máximo de ${REGLAS.diasProcesarReembolso} días hábiles.`,
          'Pagos con tarjeta: el reembolso se hace a la misma tarjeta con que pagaste, a través de Culqi. El tiempo en que tu banco refleja el abono depende de tu entidad financiera y puede tomar días adicionales.',
          'Pagos con Yape, Plin o transferencia: devolvemos por el mismo medio o a la cuenta que nos indiques.',
          'Si en el pedido usaste un cupón o ganaste puntos, se ajustan al devolverlo: el cupón se restituye cuando corresponda y los puntos ganados por ese pedido se descuentan.',
        ],
      ],
    },
    {
      titulo: 'Contacto y reclamos',
      bloques: [
        `Si tienes dudas sobre un cambio, devolución o reembolso, ${contacto}. También puedes presentar un reclamo en nuestro Libro de Reclamaciones (${RUTAS_LEGALES.reclamos}).`,
        'Esta política no limita los derechos que la ley peruana te reconoce como consumidor.',
      ],
    },
  ]

  return (
    <DocumentoLegal
      titulo="Política de cambios y devoluciones"
      introduccion="Así funcionan los cambios, devoluciones y reembolsos de tus compras y reservas."
      secciones={secciones}
      rutaActual={RUTAS_LEGALES.cambios}
    />
  )
}
