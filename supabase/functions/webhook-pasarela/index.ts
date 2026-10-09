// Recibe los avisos (webhooks) de Culqi y concilia el pedido.
//
// Seguridad: NO se confía en el contenido del aviso (cualquiera puede hacer un
// POST a esta URL). El aviso solo dice "mira este cargo"; el estado real se
// consulta directo a Culqi con la llave privada (GET /v2/charges/{id}). Además
// la URL lleva una clave compartida (?clave=…, secret CULQI_WEBHOOK_SECRET)
// como primera barrera, y el monto del cargo debe coincidir con el pedido.
//
// Secrets: CULQI_SECRET_KEY, CULQI_WEBHOOK_SECRET. Esta función se despliega
// con verify_jwt = false (Culqi no manda un JWT de Supabase): ver config.toml.
//
// Idempotencia: cada evento se guarda en `pasarela_eventos` con su id UNIQUE;
// un reenvío del mismo evento responde 200 sin reprocesar. Si el
// procesamiento falla se borra el registro y se responde 500 para que Culqi
// reintente.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CULQI_API = 'https://api.culqi.com/v2'

const ok = (cuerpo: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } })
const fallo = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })

// Comparación en tiempo constante para la clave compartida.
function iguales(a: string, b: string) {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

// El campo `data` llega como objeto o como string JSON, según el evento.
function leerData(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') return data as Record<string, unknown>
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fallo(405, 'Método no permitido.')

  const claveCulqi = Deno.env.get('CULQI_SECRET_KEY')
  const claveWebhook = Deno.env.get('CULQI_WEBHOOK_SECRET')
  if (!claveCulqi || !claveWebhook) return fallo(500, 'La pasarela no está configurada.')

  const claveRecibida = new URL(req.url).searchParams.get('clave') ?? ''
  if (!iguales(claveRecibida, claveWebhook)) return fallo(401, 'No autorizado.')

  let evento: Record<string, unknown>
  try {
    evento = await req.json()
  } catch {
    return fallo(400, 'Cuerpo inválido.')
  }

  const eventoId = typeof evento.id === 'string' ? evento.id : null
  const tipo = typeof evento.type === 'string' ? evento.type : null
  const data = leerData(evento.data)
  if (!eventoId || !tipo || !data) return fallo(400, 'Evento inválido.')

  const servidor = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Para refund.* el id del cargo viene en data.charge_id; para charge.* es data.id.
  const chargeId = String(tipo.startsWith('refund') ? data.charge_id ?? '' : data.id ?? '') || null

  // --- Idempotencia: registrar el evento (id único) ----------------------
  const { error: errEvento } = await servidor.from('pasarela_eventos').insert({
    proveedor: 'culqi',
    evento_id: eventoId,
    tipo,
    charge_id: chargeId,
    payload: evento,
  })
  if (errEvento) {
    if (errEvento.code === '23505') return ok({ ok: true, repetido: true })
    return fallo(500, 'No se pudo registrar el evento.')
  }

  const deshacerRegistro = () =>
    servidor.from('pasarela_eventos').delete().eq('proveedor', 'culqi').eq('evento_id', eventoId)

  try {
    // --- Cobro exitoso -----------------------------------------------------
    if (tipo === 'charge.creation.succeeded' && chargeId) {
      // Fuente de verdad: preguntar a Culqi, no creer en el aviso.
      const resp = await fetch(`${CULQI_API}/charges/${encodeURIComponent(chargeId)}`, {
        headers: { Authorization: `Bearer ${claveCulqi}` },
      })
      const cargo = await resp.json().catch(() => null)
      if (!resp.ok || cargo?.object !== 'charge' || cargo?.id !== chargeId) {
        await deshacerRegistro()
        return fallo(502, 'No se pudo verificar el cargo con Culqi.')
      }
      if (cargo?.outcome?.type !== 'venta_exitosa') return ok({ ok: true, ignorado: 'cargo no exitoso' })

      const pedidoId = cargo?.metadata?.pedido_id
      if (typeof pedidoId !== 'string') return ok({ ok: true, ignorado: 'cargo sin pedido' })

      const { data: pedido } = await servidor
        .from('pedidos_web')
        .select('id, total')
        .eq('id', pedidoId)
        .maybeSingle()
      if (!pedido) return ok({ ok: true, ignorado: 'pedido inexistente' })

      // El monto cobrado debe ser exactamente el del pedido.
      if (cargo.amount !== Math.round(Number(pedido.total) * 100) || cargo.currency_code !== 'PEN') {
        console.error('Monto/moneda del cargo no coincide con el pedido', { chargeId, pedidoId })
        return ok({ ok: true, ignorado: 'monto no coincide' })
      }

      const { error: errConfirmar } = await servidor.rpc('confirmar_pago_pasarela_pedido', {
        p_pedido_id: pedido.id,
        p_charge_id: chargeId,
      })
      if (errConfirmar) {
        // CONFLICTO (cancelado, precios cambiaron…): no tiene sentido que Culqi
        // reintente; queda a la vista de la admin y en el log.
        if (errConfirmar.message?.startsWith('CONFLICTO')) {
          console.error('Conflicto al confirmar pago', { chargeId, pedidoId, mensaje: errConfirmar.message })
          return ok({ ok: true, conflicto: true })
        }
        await deshacerRegistro()
        return fallo(500, 'No se pudo confirmar el pago.')
      }
      return ok()
    }

    // --- Devolución --------------------------------------------------------
    if (tipo === 'refund.creation.succeeded' && chargeId) {
      await servidor.from('pedidos_web').update({ pasarela_estado: 'REEMBOLSADO' }).eq('pasarela_charge_id', chargeId)
      await servidor.from('citas').update({ pasarela_estado: 'REEMBOLSADO' }).eq('pasarela_charge_id', chargeId)
      return ok()
    }

    // Otros eventos: quedan registrados y se responde 200.
    return ok({ ok: true, ignorado: tipo })
  } catch (e) {
    console.error('Error procesando evento', eventoId, e)
    await deshacerRegistro()
    return fallo(500, 'Error interno.')
  }
})
