import { Eye, MessageCircle } from 'lucide-react'
import { enlaceWhatsapp } from '../lib/proveedores.js'
import BotonAccion from './BotonAccion.jsx'

// Contacto rápido de un proveedor: WhatsApp (siempre en verde, abre el chat) y «Ver detalles» (abre la ficha en un modal,
// sin salir de la pantalla). Cada uno aparece solo si hay con qué.
export default function ContactoProveedor({ celular, onVerDetalles }) {
  const whatsapp = enlaceWhatsapp(celular)
  if (!whatsapp && !onVerDetalles) return null

  return (
    <div className="flex shrink-0 items-center gap-1">
      {whatsapp && (
        <BotonAccion
          sinBorde
          icono={MessageCircle}
          texto="WhatsApp del proveedor"
          color="verde"
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
        />
      )}
      {onVerDetalles && (
        <BotonAccion plano sinBorde icono={Eye} texto="Ver detalles del proveedor" color="celeste" onClick={onVerDetalles} />
      )}
    </div>
  )
}
