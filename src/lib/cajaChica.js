// Caja chica (migración 20261112000012_caja_chica): fondo fijo en efectivo para gastos menores.

// Las funciones del servidor escriben con errcode P0001 / 42501 mensajes pensados para la usuaria (saldo insuficiente,
// negocio cerrado, sin permiso…); cualquier otro error muestra uno genérico.
export function mensajeErrorCajaChica(error, generico) {
  return error?.code === 'P0001' || error?.code === '42501' ? error.message : generico
}

// Por debajo de este porcentaje del fondo, el saldo se pinta naranja: toca reponer.
export const PORCENTAJE_SALDO_BAJO = 0.2

export function claseColorSaldo(saldo, fondo) {
  if (saldo <= 0) return 'text-red'
  if (fondo > 0 && saldo < fondo * PORCENTAJE_SALDO_BAJO) return 'text-orange-400'
  return 'text-green'
}

// Cómo se lee cada movimiento en el historial (solo cuánto entró o salió, sin sumas; el saldo se ve arriba).
export const TIPOS_MOVIMIENTO = {
  SALIDA: { texto: 'Salió', clase: 'text-red' },
  REPOSICION: { texto: 'Repuesto', clase: 'text-green' },
  FALTANTE: { texto: 'Faltante', clase: 'text-orange-400' },
  SOBRANTE: { texto: 'Sobrante', clase: 'text-blue' },
  CONTEO: { texto: 'Conteo: cuadra', clase: 'text-ink/70' },
}

export const PERIODOS = [
  { id: 'HOY', label: 'Hoy' },
  { id: 'SEMANA', label: 'Semana' },
  { id: 'MES', label: 'Mes' },
]
