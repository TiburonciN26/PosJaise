// Pages Function: entrega pública de medios desde R2 (solo staging/Preview). Ver cloudflare/medios-pages/entrega.js.
// Cualquier método y cualquier subruta de /medios/ entra aquí; la lógica decide (404/405/200/304).
import { manejarMedios } from '../../cloudflare/medios-pages/entrega.js'

export const onRequest = ({ request, env, waitUntil }) =>
  manejarMedios(request, env, { waitUntil }, { cache: globalThis.caches?.default })
