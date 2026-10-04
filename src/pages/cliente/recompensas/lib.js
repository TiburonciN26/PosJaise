import { Crown, Percent, Sparkles, Ticket } from 'lucide-react'
import { formatearSoles } from '../../../lib/moneda.js'

// Utilidades de la Fase 2 de Recompensas (monedas, sellos, canje real).

const NUMERO = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
export const formatearMonedas = (n) => NUMERO.format(Number(n))

// Todas las fechas se muestran en hora de Perú (el servidor cuenta el día de Lima).
const OPC_DIA = { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }
const OPC_HORA = { ...OPC_DIA, hour: '2-digit', minute: '2-digit' }
export const fechaLima = (iso) => (iso ? new Date(iso).toLocaleDateString('es-PE', OPC_DIA) : '')
export const fechaHoraLima = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', OPC_HORA) : '')

export const REGLA_CUPONES =
  'Solo puedes usar un cupón por compra, y su valor no puede superar el importe de los productos o servicios a los que se aplica.'
export const REGLA_SERVICIOS =
  'En servicios sin protección configurada, los cupones pueden descontar hasta el 50 % del precio. En los servicios con protección, el descuento debe respetar el importe mínimo protegido.'
export const REGLA_MONEDAS = 'Las monedas no vencen. El canje es definitivo.'
export const REGLA_SELLOS =
  'Un sello por día de Perú cuando tu compra confirmada incluye servicios, venga o no de una cita web. Los productos solos no dan sello. Acumulas hasta 20 sellos y cada premio cuesta 5.'

export function describirBeneficio(p) {
  if (p.tipo === 'MONTO') return `${formatearSoles(p.valor)} de descuento en una compra posterior`
  if (p.tipo === 'PORCENTAJE') {
    return `${Number(p.valor)}% de descuento${p.tope ? ` (máximo ${formatearSoles(p.tope)})` : ''} en una compra posterior`
  }
  return `Descuento en ${p.servicio_nombre ?? 'un servicio'}`
}

export function textoAlcance(p) {
  if (p.tipo === 'SERVICIO') return p.servicio_nombre ?? 'Un servicio concreto'
  if (p.alcance === 'SERVICIOS') return 'Solo servicios'
  if (p.alcance === 'PRODUCTOS') return 'Solo productos'
  return 'Productos y servicios'
}

export function textoMinimo(p) {
  return p.minimo_compra ? `${formatearSoles(p.minimo_compra)} en los productos o servicios elegibles` : 'Sin compra mínima'
}

export function textoVigenciaCupon(p) {
  const dias = p.cupon_vigencia_dias
  const fecha = p.cupon_vence_el
  if (!dias && !fecha) return 'El cupón no vence'
  const partes = []
  if (dias) partes.push(`${dias} días desde que lo obtienes`)
  if (fecha) partes.push(`hasta el ${fechaLima(fecha)}`)
  return partes.join(' o antes, ')
}

export function textoReclamo(p) {
  if (!p.reclamo_desde && !p.reclamo_hasta) return 'Se puede reclamar en cualquier momento'
  if (p.reclamo_desde && p.reclamo_hasta) return `Del ${fechaLima(p.reclamo_desde)} al ${fechaLima(p.reclamo_hasta)}`
  return p.reclamo_hasta ? `Hasta el ${fechaLima(p.reclamo_hasta)}` : `Desde el ${fechaLima(p.reclamo_desde)}`
}

// Pago mínimo que deberá cubrir la clienta en un premio de servicio. NUNCA se
// anuncia como «gratis» si es mayor que cero.
export function textoPagoMinimo(p) {
  if (p.tipo !== 'SERVICIO' || p.pago_minimo === null || p.pago_minimo === undefined) return null
  const pago = Number(p.pago_minimo)
  return pago > 0
    ? `Pagarás al menos ${formatearSoles(pago)} por este servicio: el premio no lo cubre por completo.`
    : 'Este servicio puede quedar cubierto por completo.'
}

// Convierte una fila de mi_catalogo_recompensas() / catalogo_recompensas_publico()
// a la forma que ya consume la tarjeta del catálogo (Fila de SeccionCanje).
export function premioAItem(p, { publico = false } = {}) {
  const exclusivo = p.nivel_minimo !== 'BASICO'
  const cat = exclusivo ? 'exclusivo' : p.tipo === 'MONTO' ? 'fijo' : p.tipo === 'PORCENTAJE' ? 'porc' : 'servicio'
  const nivelMin = { BASICO: 0, PREMIUM: 1, VIP: 2 }[p.nivel_minimo] ?? 0
  const precio = publico ? Number(p.costo_basico) : Number(p.costo)
  return {
    id: p.id,
    real: true,
    publico,
    premio: p,
    cat,
    icono: exclusivo ? Crown : p.tipo === 'PORCENTAJE' ? Percent : p.tipo === 'SERVICIO' ? Sparkles : Ticket,
    nombre: p.nombre,
    desc: p.descripcion ?? describirBeneficio(p),
    precio,
    beneficio: describirBeneficio(p),
    aplica: textoAlcance(p),
    minimo: textoMinimo(p),
    nivelMin,
    stock: publico ? null : (p.cupo_restante ?? null),
    vigencia: textoVigenciaCupon(p),
    reclamo: textoReclamo(p),
    comb: 'Un cupón por compra · no se combina con otro descuento',
    pagoMinimo: publico ? null : textoPagoMinimo(p),
    canjeable: publico ? false : p.canjeable,
    motivo: publico ? 'Inicia sesión para canjear' : p.motivo,
  }
}
