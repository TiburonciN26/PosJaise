import { REGLAS, RUTAS_LEGALES } from '../../config/legal.js'
import DocumentoLegal from './DocumentoLegal.jsx'
import { descripcionProveedor, useDatosNegocioLegal } from '../../hooks/useDatosNegocioLegal.js'

// Términos y condiciones — requisito de Culqi para afiliar la pasarela.
// Las reglas numéricas viven en config/legal.js. Redacción base sujeta a revisión
// del negocio (y, idealmente, de un abogado) antes de publicarse en producción.
export default function TerminosCliente() {
  const datos = useDatosNegocioLegal()

  const secciones = [
    {
      titulo: 'Quiénes somos',
      bloques: [
        `Este sitio web es administrado por ${descripcionProveedor(datos)} (en adelante, «Jaise Beauty Academy», «nosotros»). Aquí puedes comprar productos, reservar servicios de belleza y administrar tu cuenta de clienta.`,
      ],
    },
    {
      titulo: 'Aceptación de los términos',
      bloques: [
        'Al crear una cuenta, reservar una cita o realizar una compra declaras que eres mayor de edad (o que actúas con autorización de tu apoderado), que leíste estos términos y que los aceptas. Si no estás de acuerdo, por favor no uses el sitio para comprar o reservar.',
      ],
    },
    {
      titulo: 'Tu cuenta',
      bloques: [
        'Debes dar datos verdaderos y mantener tu contraseña en reserva. Eres responsable de lo que se haga con tu cuenta. Podemos suspenderla ante uso fraudulento o abusivo.',
      ],
    },
    {
      titulo: 'Precios y medios de pago',
      bloques: [
        'Los precios se muestran en soles (S/). El precio válido es el que ves al confirmar tu compra o reserva, junto con el costo de delivery si lo eliges. Podemos actualizar los precios; los cambios no afectan pedidos ya confirmados.',
        'Medios de pago disponibles: Yape, Plin, transferencia bancaria (con la captura de tu pago) y tarjeta de débito o crédito. Los pagos con tarjeta los procesa Culqi, una pasarela de pagos; nosotros no recibimos ni almacenamos los datos de tu tarjeta.',
        'Emitimos boleta o factura según tu elección al comprar.',
      ],
    },
    {
      titulo: 'Compra de productos',
      bloques: [
        'Tu pedido queda confirmado cuando validamos tu pago. Los productos están sujetos a stock: si alguno no estuviera disponible, te avisaremos y te devolveremos lo pagado por ese producto.',
        'Puedes elegir delivery (en las zonas y con el costo indicado al comprar) o recojo en tienda, en el día y la hora que reserves en el carrito.',
      ],
    },
    {
      titulo: 'Reserva de servicios',
      bloques: [
        'Puedes reservar fecha y hora desde el sitio. Para confirmar la reserva puede requerirse un adelanto, cuyo monto verás antes de pagar; el saldo se paga en el local.',
        [
          `Tolerancia de llegada: ${REGLAS.minutosTolerancia} minutos. Pasado ese tiempo podemos reprogramar tu cita según la agenda.`,
          `Puedes cancelar o reprogramar sin perder tu adelanto hasta ${REGLAS.horasCancelarSinCosto} horas antes de la cita.`,
          'Si cancelas fuera de ese plazo o no asistes, el adelanto no se devuelve.',
          'Si cancelamos nosotros, te ofrecemos otra fecha o la devolución íntegra de lo pagado, como prefieras.',
        ],
      ],
    },
    {
      titulo: 'Cupones, promociones y puntos',
      bloques: [
        'Se rigen por las condiciones indicadas en cada uno (vigencia, productos o servicios a los que aplican, combinabilidad). No son canjeables por dinero. Podemos anularlos ante fraude o uso indebido.',
      ],
    },
    {
      titulo: 'Reseñas',
      bloques: [
        'Solo puedes reseñar servicios que realmente recibiste. Podemos moderar o retirar contenido ofensivo, falso o ilegal, y mostrar tus reseñas en el sitio.',
      ],
    },
    {
      titulo: 'Cambios, devoluciones y reembolsos',
      bloques: [
        `Se rigen por nuestra Política de cambios y devoluciones (${RUTAS_LEGALES.cambios}), que forma parte de estos términos.`,
      ],
    },
    {
      titulo: 'Datos personales',
      bloques: [
        `Tratamos tus datos conforme a nuestra Política de privacidad (${RUTAS_LEGALES.privacidad}).`,
      ],
    },
    {
      titulo: 'Propiedad intelectual',
      bloques: [
        'La marca, los logos, las fotos y los textos de este sitio pertenecen a Jaise Beauty Academy. No puedes usarlos sin autorización escrita.',
      ],
    },
    {
      titulo: 'Responsabilidad',
      bloques: [
        'Respondemos conforme a la ley. No somos responsables por interrupciones del sitio ajenas a nuestro control, ni por el uso que hagas de la información publicada.',
      ],
    },
    {
      titulo: 'Reclamos',
      bloques: [
        `Contamos con un Libro de Reclamaciones virtual (${RUTAS_LEGALES.reclamos}). También puedes acudir a INDECOPI.`,
      ],
    },
    {
      titulo: 'Cambios a estos términos',
      bloques: [
        'Podemos actualizar estos términos; publicaremos la nueva versión con su fecha. Tus compras y reservas ya realizadas se rigen por la versión vigente al momento de hacerlas.',
      ],
    },
    {
      titulo: 'Ley aplicable',
      bloques: [
        'Estos términos se rigen por las leyes de la República del Perú. Ante cualquier controversia puedes acudir a los tribunales competentes de tu domicilio y a INDECOPI.',
      ],
    },
  ]

  return (
    <DocumentoLegal
      titulo="Términos y condiciones"
      introduccion="Lee estas condiciones antes de comprar o reservar en nuestra web."
      secciones={secciones}
      rutaActual={RUTAS_LEGALES.terminos}
    />
  )
}
