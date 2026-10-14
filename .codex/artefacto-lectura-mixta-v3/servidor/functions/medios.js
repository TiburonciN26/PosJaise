// Pages Function para la ruta exacta /medios (sin barra): el patrón [[ruta]] no se asume que cubra una ruta sin
// segmentos, así que se atiende explícitamente. Siempre 404 (o 405 si no es GET/HEAD), nunca el fallback de la SPA.
import { manejarMedios } from '../cloudflare/medios-pages/entrega.js'

export const onRequest = ({ request, env, waitUntil }) =>
  manejarMedios(request, env, { waitUntil }, { cache: globalThis.caches?.default })
