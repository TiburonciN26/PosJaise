import { useEffect, useState } from 'react'
import { Clock, Globe, MapPin, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'

// Pie de página del portal cliente — solo en Inicio y las pestañas
// principales de la barra (Servicios/Productos/Citas/Nosotros), a
// pedido del usuario; las subpáginas de cuenta (Mi Perfil, Carrito,
// etc.) no lo llevan. Mismas fuentes que SeccionContacto
// (NosotrosCliente.jsx): datos_contacto()/horario_atencion(). Si el
// admin todavía no cargó dirección/teléfono/redes desde ContactoWeb.jsx
// (POS), esas líneas simplemente no aparecen — nada se inventa ni se
// deja como placeholder tipo "Próximamente".
export default function PieClienteWeb() {
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)

  useEffect(() => {
    let vigente = true

    Promise.all([supabase.rpc('datos_contacto'), supabase.rpc('horario_atencion')]).then(
      ([contactoRes, horarioRes]) => {
        if (!vigente) return
        setContacto(contactoRes.data?.[0] ?? null)
        setHorario(horarioRes.data?.[0] ?? null)
      },
    )

    return () => {
      vigente = false
    }
  }, [])

  const redes = [
    { url: contacto?.instagram_url, label: 'Instagram' },
    { url: contacto?.facebook_url, label: 'Facebook' },
    { url: contacto?.tiktok_url, label: 'TikTok' },
  ].filter((red) => red.url)

  return (
    <footer className="mt-10 border-t border-white/10 px-4 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 text-center">
        <p className="text-sm font-semibold text-white">Jaise Beauty Academy</p>

        {(contacto?.direccion || horario || contacto?.telefono) && (
          <div className="flex flex-col items-center gap-1.5 text-xs text-white/50">
            {contacto?.direccion && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--lw-gold)]" />
                {contacto.direccion}
              </span>
            )}
            {horario && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--lw-gold)]" />
                {formatearDias(horario.dias_atencion)} · {formatearHora(horario.bloque1_inicio)} -{' '}
                {formatearHora(horario.bloque1_fin)}
                {horario.bloque2_inicio && (
                  <>
                    {' '}
                    y {formatearHora(horario.bloque2_inicio)} - {formatearHora(horario.bloque2_fin)}
                  </>
                )}
              </span>
            )}
            {contacto?.telefono && (
              <a
                href={`https://wa.me/${numeroWhatsapp(contacto.telefono)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 transition-colors hover:text-white"
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-[var(--lw-gold)]" />
                {contacto.telefono}
              </a>
            )}
          </div>
        )}

        {redes.length > 0 && (
          <div className="flex items-center gap-4">
            {redes.map((red) => (
              <a
                key={red.label}
                href={red.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-white/50 transition-colors hover:text-white"
              >
                <Globe className="h-3 w-3" />
                {red.label}
              </a>
            ))}
          </div>
        )}

        <p className="text-[11px] text-white/30">
          © {new Date().getFullYear()} Jaise Beauty Academy
        </p>
      </div>
    </footer>
  )
}
