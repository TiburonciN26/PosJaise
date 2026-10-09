import { useSyncExternalStore } from 'react'

// Registro GLOBAL de trabajo sin terminar que se perdería al recargar la página (Fase 2B, B4).
//
// El aviso de versión nueva (AvisoActualizacionPWA) vive fuera de los providers de la app y su botón
// «Actualizar» recarga la página: el carrito de la caja y los formularios abiertos viven en memoria de
// React y se perderían. Quien tenga trabajo así lo registra con `marcarPendiente(clave, texto)` y lo
// quita con `limpiarPendiente(clave)`; el aviso consulta `usePendientes()`. Sin dependencias de UI ni de
// reglas de negocio: solo informa.
const pendientes = new Map() // clave -> texto visible
let instantanea = []
const oyentes = new Set()

function notificar() {
  instantanea = [...pendientes.values()]
  oyentes.forEach((o) => o())
}

export function marcarPendiente(clave, texto) {
  if (pendientes.get(clave) === texto) return
  pendientes.set(clave, texto)
  notificar()
}

export function limpiarPendiente(clave) {
  if (pendientes.delete(clave)) notificar()
}

const suscribir = (oyente) => {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

/** Lista (estable entre renders sin cambios) de los textos de trabajo pendiente. */
export function usePendientes() {
  return useSyncExternalStore(suscribir, () => instantanea, () => instantanea)
}
