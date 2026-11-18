// «¿Quién del personal está conectada ahora?» con Supabase Realtime Presence: cada sesión del POS (Layout) entra a un
// canal y se anuncia con su id de usuario; la pestaña Personal lee ese estado para marcar «En línea».
//
// - No usa tablas ni migraciones: Presence vive en memoria del servidor de Realtime y se limpia sola cuando la pestaña del
//   navegador se cierra o pierde la conexión (unos segundos después).
// - Clave de presencia = id de usuario: varias pestañas o dispositivos de la misma persona cuentan como una sola.
// - Un solo canal por cliente, manejado aquí (supabase-js no debe unirse dos veces al mismo tema desde la misma conexión):
//   Layout lo abre/cierra y Personal solo se suscribe al estado con usePersonalEnLinea().
// - Solo se publica el id (sin nombre ni correo). El canal es público de Realtime: cualquier cliente con la clave anon
//   podría ver qué ids están conectados, nada más.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase.js'

const TEMA = 'presencia-personal'

let canal = null
let usuarioCanal = null
let enLinea = new Set()
const suscriptores = new Set()

function avisar(siguiente) {
  enLinea = siguiente
  suscriptores.forEach((aviso) => aviso())
}

export function iniciarPresencia(usuarioId) {
  if (!usuarioId) return
  if (canal && usuarioCanal === usuarioId) return
  detenerPresencia()
  usuarioCanal = usuarioId
  canal = supabase.channel(TEMA, { config: { presence: { key: usuarioId } } })
  const propio = canal
  propio
    .on('presence', { event: 'sync' }, () => {
      if (canal !== propio) return
      avisar(new Set(Object.keys(propio.presenceState())))
    })
    .subscribe((estado) => {
      if (estado === 'SUBSCRIBED' && canal === propio) {
        propio.track({ desde: new Date().toISOString() })
      }
    })
}

export function detenerPresencia() {
  if (!canal) return
  const anterior = canal
  canal = null
  usuarioCanal = null
  supabase.removeChannel(anterior)
  avisar(new Set())
}

function suscribir(aviso) {
  suscriptores.add(aviso)
  return () => suscriptores.delete(aviso)
}

// Set de ids de usuario conectados en este momento (se actualiza solo).
export function usePersonalEnLinea() {
  return useSyncExternalStore(suscribir, () => enLinea)
}
