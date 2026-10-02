import { supabase } from './supabase.js'

// QA-007: el texto de entrega del detalle de producto tenía marcadores sin
// completar ("[ZONA]", "[S/ X]"). El costo real vive en zonas_delivery
// (lectura abierta a cuentas autenticadas para las zonas activas): se muestra
// "desde" el costo más bajo, sin inventar una zona. null = sin zonas activas.
export async function obtenerCostoDeliveryDesde() {
  const { data } = await supabase.from('zonas_delivery').select('costo').eq('activo', true)
  const costos = (data ?? []).map((zona) => Number(zona.costo)).filter((costo) => !Number.isNaN(costo))
  return costos.length > 0 ? Math.min(...costos) : null
}
