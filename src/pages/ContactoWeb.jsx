import { useEffect, useState } from 'react'
import { MapPin, Phone } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import Etiqueta from '../components/Etiqueta.jsx'

const formularioVacio = {
  direccion: '',
  telefono: '',
  instagramUrl: '',
  facebookUrl: '',
  tiktokUrl: '',
}

// Panel administrativo de "Contacto Web" (cuelga de /web, ver
// navegacion.js) — dirección, teléfono y redes sociales que se muestran
// en Nosotros > Contacto del portal cliente (87_contacto_negocio.sql).
// A diferencia de Promociones/Pedidos Web/Reseñas, "estado_negocio" es
// una fila singleton (id=1) de configuración, no una lista — por eso
// esta pantalla es un formulario simple, sin buscador ni tarjetas.
export default function ContactoWeb() {
  const { mostrarToast } = useToast()
  const [formulario, setFormulario] = useState(formularioVacio)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase
      .from('estado_negocio')
      .select('direccion, telefono, instagram_url, facebook_url, tiktok_url')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) {
          setFormulario({
            direccion: data.direccion ?? '',
            telefono: data.telefono ?? '',
            instagramUrl: data.instagram_url ?? '',
            facebookUrl: data.facebook_url ?? '',
            tiktokUrl: data.tiktok_url ?? '',
          })
        }
        setCargando(false)
      })
  }, [])

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()
    setGuardando(true)

    const { error } = await supabase
      .from('estado_negocio')
      .update({
        direccion: formulario.direccion.trim() || null,
        telefono: formulario.telefono.trim() || null,
        instagram_url: formulario.instagramUrl.trim() || null,
        facebook_url: formulario.facebookUrl.trim() || null,
        tiktok_url: formulario.tiktokUrl.trim() || null,
      })
      .eq('id', 1)

    setGuardando(false)

    if (error) {
      mostrarToast('No se pudo guardar. Intenta de nuevo.', 'error')
      return
    }

    mostrarToast('Datos de contacto actualizados.', 'exito')
  }

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </div>
    )
  }

  return (
    <div
      className="animate-entrada-pestana mx-auto w-full max-w-lg p-3 pb-6"
      style={{ '--color-foco': 'var(--color-red)' }}
    >
      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        <MapPin className="h-8 w-8 text-red" />
        <p className="text-base font-semibold text-red">Contacto Web</p>
        <p className="max-w-sm text-sm text-ink/60">
          Esto es lo que ven tus clientes en Nosotros &gt; Contacto — el horario ya está cargado
          (ver Citas), acá solo falta dirección, teléfono y redes.
        </p>
      </div>

      <form onSubmit={guardar} className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <Etiqueta htmlFor="contacto-direccion">Dirección</Etiqueta>
          <input
            id="contacto-direccion"
            type="text"
            value={formulario.direccion}
            onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
            placeholder="Ej. Av. Pardo 123, Nuevo Chimbote"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-telefono">Teléfono / WhatsApp</Etiqueta>
          <input
            id="contacto-telefono"
            type="text"
            inputMode="tel"
            value={formulario.telefono}
            onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
            placeholder="Ej. 987654321"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-instagram">Instagram (link completo)</Etiqueta>
          <input
            id="contacto-instagram"
            type="url"
            value={formulario.instagramUrl}
            onChange={(evento) => actualizarCampo('instagramUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-facebook">Facebook (link completo)</Etiqueta>
          <input
            id="contacto-facebook"
            type="url"
            value={formulario.facebookUrl}
            onChange={(evento) => actualizarCampo('facebookUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <div>
          <Etiqueta htmlFor="contacto-tiktok">TikTok (link completo)</Etiqueta>
          <input
            id="contacto-tiktok"
            type="url"
            value={formulario.tiktokUrl}
            onChange={(evento) => actualizarCampo('tiktokUrl', evento.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-red"
          />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Phone className="h-4 w-4" />
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
