// Libro de Reclamaciones con Cloudflare Turnstile (auditoría global 2026-11-20, hallazgo 16.1).
//
// Flujo: el formulario (src/pages/cliente/LibroReclamacionesCliente.jsx) obtiene un token del widget de
// Turnstile y llama a esta función con { datos, token }. Aquí se verifica el token con Cloudflare y solo si
// pasa se registra el reclamo con registrar_reclamo_verificado() como service_role (migración
// 20261120000005: ni anon ni authenticated pueden ya escribir el libro directamente).
//
// Pública (verify_jwt = false en config.toml): el libro se puede llenar sin cuenta. Si llega el JWT de una
// clienta con sesión, se valida y su id queda enlazado al reclamo (lo que antes hacía auth.uid()).
//
// Secrets: TURNSTILE_SECRET_KEY (Supabase → Edge Functions → Secrets; nunca en el repo ni en VITE_*).
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Sin TURNSTILE_SECRET_KEY la función NO registra nada (falla cerrada) y dice cómo presentar el reclamo.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_CUERPO = 20_000 // bytes: el formulario más largo posible ronda los 4 KB
const SIN_SERVICIO =
  'El libro de reclamaciones no está disponible en este momento. Acércate al local o escríbenos por WhatsApp y te lo entregamos en físico.'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function responder(cuerpo: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function turnstileValido(secreto: string, token: string, ip: string | null) {
  const form = new FormData()
  form.append('secret', secreto)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  form.append('idempotency_key', crypto.randomUUID())
  try {
    const r = await fetch(SITEVERIFY, { method: 'POST', body: form })
    if (!r.ok) return false
    const resultado = await r.json()
    return resultado?.success === true
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)

  const secreto = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secreto) {
    console.error('registrar-reclamo: falta el secret TURNSTILE_SECRET_KEY')
    return responder({ error: SIN_SERVICIO }, 503)
  }

  // --- Entrada ---------------------------------------------------------
  const texto = await req.text()
  if (texto.length > MAX_CUERPO) return responder({ error: 'Solicitud demasiado grande.' }, 413)
  let datos: unknown
  let token: unknown
  try {
    ;({ datos, token } = JSON.parse(texto))
  } catch {
    return responder({ error: 'Solicitud inválida.' }, 400)
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return responder({ error: 'Completa la verificación de seguridad antes de enviar.', codigo: 'turnstile' }, 400)
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return responder({ error: 'Solicitud inválida.' }, 400)
  }

  // --- Turnstile -------------------------------------------------------
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  if (!(await turnstileValido(secreto, token, ip))) {
    return responder({ error: 'No pudimos verificar que eres una persona. Vuelve a intentarlo.', codigo: 'turnstile' }, 403)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!

  // --- ¿Clienta con sesión? (opcional) ----------------------------------
  // Con la anon key el encabezado trae un JWT de rol anon, no de usuaria: getUser() falla y se sigue sin enlace.
  let clienteUserId: string | null = null
  const authHeader = req.headers.get('Authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const comoUsuaria = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data } = await comoUsuaria.auth.getUser().catch(() => ({ data: null }))
    clienteUserId = data?.user?.id ?? null
  }

  // --- Registro --------------------------------------------------------
  const servicio = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await servicio.rpc('registrar_reclamo_verificado', {
    p_datos: datos,
    p_cliente_user_id: clienteUserId,
  })
  if (error) {
    // 22023 = validación de un campo; 54000 = tope de reclamos por documento y hora. Sus mensajes son para la persona.
    if (error.code === '22023' || error.code === '54000') return responder({ error: error.message }, 400)
    console.error('registrar-reclamo: fallo al registrar', error.code, error.message)
    return responder({ error: 'No se pudo registrar tu reclamo. Intenta de nuevo en unos minutos.' }, 500)
  }
  return responder({ reclamo: Array.isArray(data) ? (data[0] ?? null) : data })
})
