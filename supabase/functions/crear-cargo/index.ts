// Cobra con tarjeta (Culqi) un pedido web ya creado.
//
// Flujo: el navegador tokeniza la tarjeta con el checkout de Culqi (los datos
// de la tarjeta nunca llegan aquí) y llama a esta función con { pedido_id,
// token_id }. El MONTO NO viene del navegador: se lee de `pedidos_web.total`,
// que ya calculó el servidor al crear el pedido (precios, cupón, delivery).
//
// Secrets (nunca en el repo ni en VITE_*): CULQI_SECRET_KEY. SUPABASE_URL,
// SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CULQI_CHARGES_URL = 'https://api.culqi.com/v2/charges'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)

  const claveCulqi = Deno.env.get('CULQI_SECRET_KEY')
  if (!claveCulqi) return responder({ error: 'La pasarela no está configurada.' }, 500)

  // --- Entrada ---------------------------------------------------------
  let pedidoId: unknown
  let tokenId: unknown
  try {
    ;({ pedido_id: pedidoId, token_id: tokenId } = await req.json())
  } catch {
    return responder({ error: 'Solicitud inválida.' }, 400)
  }
  if (typeof pedidoId !== 'string' || typeof tokenId !== 'string' || !tokenId.startsWith('tkn_')) {
    return responder({ error: 'Faltan datos del pago.' }, 400)
  }

  // --- Quién llama -----------------------------------------------------
  // Cliente con el JWT de la usuaria: el SELECT pasa por RLS, así que solo
  // ve el pedido si es suyo (o si es admin).
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const comoUsuaria = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: dataUsuaria, error: errUsuaria } = await comoUsuaria.auth.getUser()
  if (errUsuaria || !dataUsuaria.user) return responder({ error: 'Sesión no válida.' }, 401)

  const { data: pedido, error: errPedido } = await comoUsuaria
    .from('pedidos_web')
    .select('id, total, estado, metodo_pago, pago_verificado, pasarela_estado')
    .eq('id', pedidoId)
    .maybeSingle()
  if (errPedido || !pedido) return responder({ error: 'Pedido no encontrado.' }, 404)

  if (pedido.estado !== 'PENDIENTE' || pedido.pago_verificado) {
    return responder({ error: 'Este pedido ya no admite pago.' }, 409)
  }
  if (pedido.metodo_pago !== 'TARJETA') {
    return responder({ error: 'El pedido no es de pago con tarjeta.' }, 409)
  }

  // --- Reservar el intento (anti doble cobro) ---------------------------
  // Pasa a PENDIENTE solo si aún no hay un intento en curso o cobrado. Dos
  // clics o dos pestañas a la vez: solo uno actualiza la fila.
  const servidor = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: reservado, error: errReserva } = await servidor
    .from('pedidos_web')
    .update({ pasarela_estado: 'PENDIENTE' })
    .eq('id', pedido.id)
    .or('pasarela_estado.is.null,pasarela_estado.eq.RECHAZADO')
    .select('id')
    .maybeSingle()
  if (errReserva) return responder({ error: 'No se pudo iniciar el pago.' }, 500)
  if (!reservado) return responder({ error: 'Ya hay un pago en curso para este pedido.' }, 409)

  // --- Cargo en Culqi ----------------------------------------------------
  // Culqi trabaja en céntimos enteros.
  const monto = Math.round(Number(pedido.total) * 100)
  let respuesta: Response
  try {
    respuesta = await fetch(CULQI_CHARGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${claveCulqi}` },
      body: JSON.stringify({
        amount: monto,
        currency_code: 'PEN',
        email: dataUsuaria.user.email,
        source_id: tokenId,
        description: `Pedido web ${pedido.id.slice(0, 8)}`,
        metadata: { pedido_id: pedido.id },
      }),
    })
  } catch {
    // Sin respuesta no sabemos si cobró: se deja en PENDIENTE (no se permite
    // reintentar a ciegas) y el webhook de Culqi lo concilia.
    return responder({ error: 'No pudimos confirmar el pago. No se reintentará automáticamente.' }, 502)
  }

  const cargo = await respuesta.json().catch(() => null)

  if (respuesta.ok && cargo?.object === 'charge' && cargo?.id) {
    await servidor
      .from('pedidos_web')
      .update({ pasarela_charge_id: cargo.id, pasarela_estado: 'PAGADO' })
      .eq('id', pedido.id)

    // Confirma el pago y crea la venta de inmediato (no depende de que llegue
    // el webhook). Es idempotente: si el webhook llega después, no duplica.
    // Si falla (p. ej. un CONFLICTO), el cobro ya se hizo: se responde ok y el
    // pedido queda PAGADO sin verificar, a la vista de la admin.
    const { error: errConfirmar } = await servidor.rpc('confirmar_pago_pasarela_pedido', {
      p_pedido_id: pedido.id,
      p_charge_id: cargo.id,
    })
    if (errConfirmar) console.error('Pago cobrado pero no confirmado', cargo.id, errConfirmar.message)
    return responder({ ok: true, charge_id: cargo.id, verificado: !errConfirmar })
  }

  // Rechazo claro (tarjeta sin fondos, datos inválidos, etc.): se puede reintentar.
  await servidor.from('pedidos_web').update({ pasarela_estado: 'RECHAZADO' }).eq('id', pedido.id)
  return responder(
    { ok: false, error: cargo?.user_message ?? 'El pago fue rechazado.' },
    respuesta.status >= 400 && respuesta.status < 500 ? 402 : 502,
  )
})
