// Clasificación de claves y entornos de Supabase COMPARTIDA por scripts/build-cloudflare.mjs y
// scripts/build-preview-staging.mjs. Se ejecuta ANTES de iniciar Vite. Nunca imprime claves.
//
// Reglas (Fase 2B, B1/B2):
//  · `sb_secret_…` se rechaza primero (sin parsear nada más).
//  · Solo se aceptan: (a) publishable `sb_publishable_<token>` con formato válido, o (b) JWT legacy bien
//    formado (3 segmentos base64url, JSON válido) con `role` EXACTAMENTE `anon` y, si trae `ref`, igual al
//    del entorno. Todo lo demás (vacío, roto, desconocido, authenticated, service_role, sin role) aborta.
//  · La URL debe ser https://<ref>.supabase.co con el ref EXACTO aprobado para el entorno.
//  · Decodificar no valida la firma: detecta errores de configuración, no autenticidad.

// Backends aprobados (refs públicos). Modificarlos exige revisión de código a propósito: NO hay override por env.
export const REF_PRODUCCION = 'cmkelllerzjqjbsqsylc' // Supabase del negocio (WedJaiseReact)
export const REF_STAGING = 'tqkdtojnhgykmcbvwdmz' // pos-jaise-staging (datos ficticios)

const B64URL = /^[A-Za-z0-9_-]+$/
const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]{20,}$/

/** Devuelve { ok:true, tipo, ref? } o { ok:false, motivo } — el motivo nunca contiene la clave. */
export function clasificarClave(clave, refEsperado) {
  if (typeof clave !== 'string' || clave.trim() === '') return { ok: false, motivo: 'clave vacía' }
  const c = clave.trim()
  if (c.startsWith('sb_secret_')) return { ok: false, motivo: 'es una clave sb_secret_ (privilegiada)' }
  if (c.startsWith('sb_publishable_')) {
    return PUBLISHABLE.test(c) ? { ok: true, tipo: 'publishable' } : { ok: false, motivo: 'sb_publishable_ con formato inválido' }
  }
  const partes = c.split('.')
  if (partes.length !== 3 || !partes.every((p) => p.length > 0 && B64URL.test(p))) return { ok: false, motivo: 'formato desconocido (ni publishable ni JWT legacy bien formado)' }
  let payload
  try {
    const cab = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'))
    if (!cab || typeof cab !== 'object' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('forma')
  } catch {
    return { ok: false, motivo: 'JWT con cabecera o payload ilegibles' }
  }
  if (payload.role !== 'anon') return { ok: false, motivo: `JWT con role "${typeof payload.role === 'string' ? payload.role : 'ausente'}" (se exige exactamente anon)` }
  if (payload.ref !== undefined) {
    if (payload.ref !== refEsperado) return { ok: false, motivo: 'el ref del JWT no coincide con el proyecto del entorno' }
  }
  return { ok: true, tipo: 'jwt-anon', ref: payload.ref }
}

/** Valida URL + clave contra el entorno aprobado. entorno: 'preview' | 'produccion' | 'staging-manual'. */
export function validarSupabase({ url, clave, entorno }) {
  const refEsperado = entorno === 'produccion' ? REF_PRODUCCION : REF_STAGING
  if (!REF_PRODUCCION || !REF_STAGING || REF_PRODUCCION === REF_STAGING) return { ok: false, motivo: 'refs aprobados vacíos o iguales (configuración del repositorio)' }
  let u
  try { u = new URL(String(url ?? '')) } catch { return { ok: false, motivo: 'URL de Supabase inválida o vacía' } }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    return { ok: false, motivo: 'la URL debe ser exactamente https://<ref>.supabase.co' }
  }
  if (u.hostname !== `${refEsperado}.supabase.co`) {
    const otro = u.hostname === `${REF_PRODUCCION}.supabase.co` ? 'PRODUCCIÓN' : u.hostname === `${REF_STAGING}.supabase.co` ? 'STAGING' : 'un proyecto NO aprobado'
    return { ok: false, motivo: `el entorno «${entorno}» exige el backend ${entorno === 'produccion' ? 'de PRODUCCIÓN' : 'de STAGING'} y la URL apunta a ${otro}` }
  }
  const k = clasificarClave(clave, refEsperado)
  if (!k.ok) return { ok: false, motivo: 'VITE_SUPABASE_ANON_KEY rechazada: ' + k.motivo }
  return { ok: true, refEsperado, tipoClave: k.tipo }
}

/**
 * Entorno de un build en Cloudflare Pages. Exige RAMA_PRODUCCION explícita (la misma que la rama de producción
 * configurada en Pages) y CF_PAGES_BRANCH no vacía; sin defaults por descarte.
 */
export function entornoDeCloudflare(env) {
  const rama = (env.CF_PAGES_BRANCH ?? '').trim()
  const prod = (env.RAMA_PRODUCCION ?? '').trim()
  if (!rama) return { ok: false, motivo: 'CF_PAGES_BRANCH ausente o vacío' }
  if (!prod) return { ok: false, motivo: 'RAMA_PRODUCCION no está definida (debe ser la rama de producción configurada en Pages, en Production Y Preview)' }
  return { ok: true, entorno: rama === prod ? 'produccion' : 'preview', rama }
}

/** Escanea texto de la SALIDA compilada: ninguna clave privilegiada ni JWT que no sea anon del ref esperado. */
export function escanearTextoSalida(texto, refEsperado) {
  const hallazgos = []
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(texto)) hallazgos.push('sb_secret_')
  for (const m of texto.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const k = clasificarClave(m[0], refEsperado)
    if (!k.ok) hallazgos.push('JWT no permitido: ' + k.motivo)
  }
  return hallazgos
}
