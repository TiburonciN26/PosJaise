import { supabase } from './supabase.js'

// QA-011: el personal que entra a "Mi perfil de clienta" conserva sus
// permisos de personal (la RLS de citas/registro_servicios/pedidos_web les
// deja leer todo, a propósito, para el POS). Las pantallas del portal
// cliente no deben depender solo de la RLS para acotar a "lo mío": se
// filtra explícitamente por la clienta vinculada a la sesión. null = sin
// perfil vinculado todavía → la pantalla debe mostrarse vacía, nunca sin filtro.
export async function obtenerMiClienteId() {
  const { data } = await supabase.rpc('mi_cliente_id')
  return data ?? null
}

// QA-006: el perfil aceptaba cualquier texto como teléfono (incluso solo
// letras). Se admiten los separadores habituales (espacios, guiones,
// paréntesis, "+" inicial) y entre 7 y 15 dígitos.
export function telefonoValido(texto) {
  const limpio = texto.trim()
  if (!/^\+?[\d\s\-()]+$/.test(limpio)) return false
  const digitos = limpio.replace(/\D/g, '').length
  return digitos >= 7 && digitos <= 15
}
