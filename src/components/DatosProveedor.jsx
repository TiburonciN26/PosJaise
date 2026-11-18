import {
  Banknote,
  Building2,
  CalendarClock,
  FileText,
  Globe,
  Hash,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShoppingBag,
  StickyNote,
  Tag,
  User,
  Wallet,
  AtSign,
} from 'lucide-react'
import { CAMPOS_PROVEEDOR, GRUPOS_PROVEEDOR, enlaceTelefono, enlaceWhatsapp } from '../lib/proveedores.js'

const ICONOS = {
  rubro: Tag,
  contacto_nombre: User,
  celular: MessageCircle,
  telefono: Phone,
  email: Mail,
  web: Globe,
  redes: AtSign,
  direccion: MapPin,
  ciudad: MapPin,
  razon_social: Building2,
  ruc: Hash,
  condiciones_pago: Wallet,
  dias_entrega: CalendarClock,
  pedido_minimo: ShoppingBag,
  datos_pago: Banknote,
  notas: StickyNote,
}

function enlaceDe(clave, valor) {
  if (clave === 'celular') return enlaceWhatsapp(valor)
  if (clave === 'telefono') return enlaceTelefono(valor)
  if (clave === 'email') return `mailto:${valor}`
  if (clave === 'web') return valor
  return null
}

// Datos de un proveedor mostrando SOLO los campos que tienen algo escrito (el nombre lo pone quien lo usa). `compacto`:
// sin títulos de grupo, para tarjetas dentro de otros modales.
export default function DatosProveedor({ proveedor, compacto = false }) {
  const grupos = GRUPOS_PROVEEDOR.map((grupo) => ({
    ...grupo,
    campos: CAMPOS_PROVEEDOR.filter(
      (campo) => campo.grupo === grupo.id && campo.clave !== 'nombre' && String(proveedor?.[campo.clave] ?? '').trim(),
    ),
  })).filter((grupo) => grupo.campos.length > 0)

  if (grupos.length === 0) {
    return <p className="text-xs text-ink/50">Sin datos adicionales.</p>
  }

  return (
    <div className={compacto ? 'space-y-1' : 'space-y-3'}>
      {grupos.map((grupo) => (
        <div key={grupo.id} className="space-y-1">
          {!compacto && grupo.titulo && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink/50">{grupo.titulo}</p>
          )}
          {grupo.campos.map(({ clave, etiqueta, mono }) => {
            const Icono = ICONOS[clave] ?? FileText
            const valor = String(proveedor[clave]).trim()
            const enlace = enlaceDe(clave, valor)
            const externo = clave === 'web' || clave === 'celular'
            return (
              <div key={clave} className="flex min-w-0 items-start gap-1.5 text-sm text-ink/70">
                <Icono className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/50" aria-hidden="true" />
                <span className="sr-only">{etiqueta}: </span>
                {enlace ? (
                  <a
                    href={enlace}
                    {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={`min-w-0 break-words text-ink underline-offset-2 hover:text-amber hover:underline ${mono ? 'font-mono' : ''}`}
                  >
                    {valor}
                  </a>
                ) : (
                  <span className={`min-w-0 whitespace-pre-line break-words ${mono ? 'font-mono' : ''}`} title={etiqueta}>
                    {valor}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
