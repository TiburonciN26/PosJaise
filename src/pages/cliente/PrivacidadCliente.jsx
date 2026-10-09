import { RUTAS_LEGALES } from '../../config/legal.js'
import DocumentoLegal from './DocumentoLegal.jsx'
import { descripcionProveedor, useDatosNegocioLegal } from '../../hooks/useDatosNegocioLegal.js'

// Política de privacidad (Ley N.º 29733). Culqi no la lista entre sus requisitos,
// pero la web recoge datos personales (cuenta, direcciones, citas, pagos), así que
// conviene tenerla; los Términos y el registro de cuenta la enlazan.
export default function PrivacidadCliente() {
  const datos = useDatosNegocioLegal()

  const secciones = [
    {
      titulo: 'Responsable del tratamiento',
      bloques: [`${descripcionProveedor(datos)}.`],
    },
    {
      titulo: 'Datos que recopilamos',
      bloques: [
        [
          'Datos de tu cuenta: correo, nombre, celular y, si los registras, fecha de cumpleaños y foto de perfil.',
          'Direcciones de entrega que guardes para tus pedidos.',
          'Historial de citas, pedidos, reseñas, cupones y puntos.',
          'Capturas de pago (Yape, Plin, transferencia) y datos de facturación (RUC y razón social) si pides factura.',
        ],
      ],
    },
    {
      titulo: 'Para qué los usamos',
      bloques: [
        'Gestionar tus compras y citas, emitir comprobantes, avisarte sobre el estado de tu cuenta, pedidos y reservas, administrar puntos y cupones, y atender tus consultas y reclamos.',
      ],
    },
    {
      titulo: 'Con quién los compartimos',
      bloques: [
        [
          'Culqi, para procesar los pagos con tarjeta. Los datos de tu tarjeta los captura Culqi directamente; nosotros no los recibimos ni los guardamos.',
          'Proveedores tecnológicos que alojan el sitio y la base de datos.',
          'Autoridades, cuando la ley lo exija.',
        ],
        'No vendemos tus datos personales.',
      ],
    },
    {
      titulo: 'Cuánto tiempo los conservamos',
      bloques: [
        'Mientras mantengas tu cuenta y durante el tiempo que exijan las normas tributarias y contables sobre comprobantes y operaciones.',
      ],
    },
    {
      titulo: 'Tus derechos',
      bloques: [
        `Puedes pedir acceso, rectificación, cancelación u oposición sobre tus datos escribiéndonos${datos.telefono ? ` por WhatsApp al ${datos.telefono}` : ' por los medios de contacto de nuestra web'}. Si consideras que tus derechos no fueron atendidos, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.`,
      ],
    },
    {
      titulo: 'Almacenamiento en tu navegador',
      bloques: [
        'Usamos el almacenamiento de tu navegador para mantener tu sesión y recordar preferencias de uso del sitio.',
      ],
    },
    {
      titulo: 'Cambios a esta política',
      bloques: ['Publicaremos cualquier cambio en esta página, con su fecha de actualización.'],
    },
  ]

  return (
    <DocumentoLegal
      titulo="Política de privacidad"
      introduccion="Cómo cuidamos y usamos tus datos personales."
      secciones={secciones}
      rutaActual={RUTAS_LEGALES.privacidad}
    />
  )
}
