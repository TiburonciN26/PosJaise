import { useEffect, useEffectEvent, useRef } from 'react'

// Cloudflare Turnstile (verificación anti-bots sin acertijos), hoy solo en el Libro de Reclamaciones.
// El token que entrega el widget sirve UNA vez y vence a los 5 minutos: tras cada envío (bien o mal) el padre
// debe volver a montarlo (cambiando su `key`) para obtener uno nuevo. La verificación real del token la hace la
// Edge Function registrar-reclamo; el widget solo lo obtiene.
//
// Clave del sitio: VITE_TURNSTILE_SITE_KEY (pública). En Local se usa la de PRUEBA de Cloudflare,
// 1x00000000000000000000AA, que siempre pasa. Orígenes permitidos en la CSP: scripts/lib/csp.mjs (TURNSTILE).
export const CLAVE_SITIO_TURNSTILE = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let cargaScript = null
function cargarTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!cargaScript) {
    cargaScript = new Promise((resolve, reject) => {
      const etiqueta = document.createElement('script')
      etiqueta.src = SCRIPT
      etiqueta.async = true
      etiqueta.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
      etiqueta.onerror = () => {
        cargaScript = null // permitir reintentar al volver a montar
        etiqueta.remove()
        reject(new Error('turnstile'))
      }
      document.head.appendChild(etiqueta)
    })
  }
  return cargaScript
}

// `onToken(token | null)`: null cuando vence, falla o aún no hay token. `onError()` si el script no carga.
export default function WidgetTurnstile({ onToken, onError, tema = 'dark' }) {
  const contenedor = useRef(null)
  const avisarToken = useEffectEvent((token) => onToken(token))
  const avisarError = useEffectEvent(() => onError?.())

  useEffect(() => {
    let widgetId = null
    let vigente = true
    cargarTurnstile()
      .then((turnstile) => {
        if (!vigente || !contenedor.current) return
        widgetId = turnstile.render(contenedor.current, {
          sitekey: CLAVE_SITIO_TURNSTILE,
          theme: tema,
          language: 'es',
          callback: (token) => avisarToken(token),
          'expired-callback': () => avisarToken(null),
          'error-callback': () => avisarToken(null),
        })
      })
      .catch(() => {
        if (vigente) avisarError()
      })
    return () => {
      vigente = false
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [tema])

  return <div ref={contenedor} className="min-h-[65px]" />
}
