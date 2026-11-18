// Perfil de clienta en el POS (pestaña Clientes → ?cliente=<id>). Formatos y etiquetas que comparten el encabezado y las
// secciones desplegables de src/components/clientes/. Los datos agregados salen de las funciones de la migración
// 20261118000001_perfil_cliente.sql; lo demás se lee directo de cada tabla (RLS ya deja leer a la administración).

import { formatearSoles } from './moneda.js'

const FECHA = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Lima' })
const FECHA_HORA = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})
const HORA = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Lima' })
const DIA_LARGO = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const NUMERO = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })

// Instante (timestamptz) → fecha en hora de Lima.
export function fechaCorta(instante) {
  return instante ? FECHA.format(new Date(instante)) : '—'
}

export function fechaHora(instante) {
  return instante ? FECHA_HORA.format(new Date(instante)) : '—'
}

export function hora(instante) {
  return instante ? HORA.format(new Date(instante)) : ''
}

// Día de calendario ('YYYY-MM-DD', columna date): se lee como UTC para no correrlo un día (ver fechas.js).
export function diaLargo(diaIso) {
  if (!diaIso) return '—'
  const texto = DIA_LARGO.format(new Date(`${diaIso}T00:00:00Z`))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function diaCorto(diaIso) {
  if (!diaIso) return '—'
  const [anio, mes, dia] = diaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

export function soles(monto) {
  return formatearSoles(Number(monto ?? 0))
}

export function numero(valor) {
  return NUMERO.format(Number(valor ?? 0))
}

// Edad cumplida a hoy (hora de Lima): vive en edad.js porque también la usan el formulario y el filtro de Clientes.
export { edad } from './edad.js'

export function haceDias(dias) {
  if (dias == null) return null
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} días`
}

export const NIVELES = {
  BASICO: { label: 'Básico', clase: 'border-ink/20 bg-surface-2 text-ink/70' },
  PREMIUM: { label: 'Premium', clase: 'border-amber/50 bg-amber/15 text-amber' },
  VIP: { label: 'VIP', clase: 'border-purple-300/50 bg-purple-300/15 text-purple-300' },
}

// Mismos colores que la pestaña Citas.
export const ESTADOS_CITA = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  CONFIRMADA: { label: 'Confirmada', clase: 'border-blue/50 bg-blue/15 text-blue' },
  COMPLETADA: { label: 'Completada', clase: 'border-green/50 bg-green/15 text-green' },
  CANCELADA: { label: 'Cancelada', clase: 'border-border-strong bg-surface-2 text-ink/50' },
  NO_ASISTIO: { label: 'No asistió', clase: 'border-red/50 bg-red/15 text-red' },
}

export const ESTADOS_PEDIDO = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  LISTO: { label: 'Listo', clase: 'border-blue/50 bg-blue/15 text-blue' },
  ENTREGADO: { label: 'Entregado', clase: 'border-green/50 bg-green/15 text-green' },
  CANCELADO: { label: 'Cancelado', clase: 'border-border-strong bg-surface-2 text-ink/50' },
}

export const ESTADOS_RESENA = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  APROBADA: { label: 'Aprobada', clase: 'border-green/50 bg-green/15 text-green' },
  RECHAZADA: { label: 'Rechazada', clase: 'border-red/50 bg-red/15 text-red' },
}

export const ESTADOS_DEUDA = {
  PENDIENTE: { label: 'Pendiente', clase: 'border-amber/50 bg-amber/15 text-amber' },
  COBRADA: { label: 'Cobrada', clase: 'border-green/50 bg-green/15 text-green' },
}

export const ESTADOS_CUPON = {
  DISPONIBLE: { label: 'Vigente', clase: 'border-green/50 bg-green/15 text-green' },
  VENCIDO: { label: 'Vencido', clase: 'border-red/50 bg-red/15 text-red' },
  CANJEADO: { label: 'Usado', clase: 'border-blue/50 bg-blue/15 text-blue' },
  ANULADO: { label: 'Anulado', clase: 'border-border-strong bg-surface-2 text-ink/50' },
  DESCONOCIDO: { label: '—', clase: 'border-border-strong bg-surface-2 text-ink/50' },
}

export const TIPOS_MOVIMIENTO_PUNTOS = {
  VENTA: 'Compra',
  VENTA_REVERSION: 'Compra anulada',
  CANJE: 'Canje',
  AJUSTE: 'Ajuste',
  APERTURA: 'Saldo de apertura',
  SELLO: 'Sello ganado',
  SELLO_RETIRO: 'Sello retirado',
  CANJE_SELLOS: 'Canje de sellos',
}

export const ESTADOS_SERVICIO = {
  ACTIVO: null,
  PENDIENTE_PORCENTAJE: { label: 'Sin % asignado', clase: 'border-amber/50 bg-amber/15 text-amber' },
  CANCELADO: { label: 'Cancelado', clase: 'border-border-strong bg-surface-2 text-ink/50' },
}

export const TAMANO_PAGINA_PERFIL = 15
